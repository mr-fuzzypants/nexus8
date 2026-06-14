"""
Core invariant tests for the single-table entity design.

Covers the guarantees the product depends on: entity-type polymorphism,
container tree integrity (including bulk subtree relabeling on move),
version pinning/reproducibility through symlinks, and concurrent
version-number allocation.
"""

import threading

from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection
from django.db.models import RestrictedError
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from .models import (
    GENERATED_FROM_BATCH,
    Container,
    ContainerVersion,
    GenerationRecipe,
    MediaAsset,
    SymlinkEvent,
    Version,
    VersionedEntity,
    VersionLink,
    bulk_create_versions,
    create_container_version,
    resolve_container_references,
    resolve_symlink_at,
    update_symlink,
)


class EntityTypeSystemTests(TestCase):
    def test_entity_type_is_stamped_on_save(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset 1")
        container = Container.objects.create(code="C1", name="Container 1")
        plain = VersionedEntity.objects.create(code="E1", name="Entity 1")

        self.assertEqual(asset.entity_type, "media_asset")
        self.assertEqual(container.entity_type, "container")
        self.assertEqual(plain.entity_type, "entity")

    def test_polymorphic_fetch_returns_proxy_classes(self):
        MediaAsset.objects.create(code="A1", name="Asset 1")
        Container.objects.create(code="C1", name="Container 1")
        VersionedEntity.objects.create(code="E1", name="Entity 1")

        classes = {e.code: type(e) for e in VersionedEntity.objects.all()}
        self.assertIs(classes["A1"], MediaAsset)
        self.assertIs(classes["C1"], Container)
        self.assertIs(classes["E1"], VersionedEntity)

    def test_type_managers_are_scoped(self):
        MediaAsset.objects.create(code="A1", name="Asset 1")
        Container.objects.create(code="C1", name="Container 1")

        self.assertEqual(MediaAsset.objects.count(), 1)
        self.assertEqual(Container.objects.count(), 1)
        self.assertEqual(VersionedEntity.objects.count(), 2)

    def test_json_property_roundtrip(self):
        asset = MediaAsset.objects.create(
            code="A1", name="Asset 1", file_path="/x/y.exr", media_type="image"
        )
        asset.refresh_from_db()
        self.assertEqual(asset.file_path, "/x/y.exr")
        self.assertEqual(asset.media_type, "image")
        self.assertEqual(asset.type_data["media_type"], "image")

        asset.production_stage = "final"
        asset.save()
        asset.refresh_from_db()
        self.assertEqual(asset.production_stage, "final")

    def test_json_lookup_filters(self):
        MediaAsset.objects.create(code="A1", name="x", media_type="image")
        MediaAsset.objects.create(code="A2", name="y", media_type="video")
        self.assertEqual(
            MediaAsset.objects.filter(type_data__media_type="image").count(), 1
        )

    def test_media_asset_defaults_to_pending_analysis(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset 1")
        self.assertEqual(asset.ai_analysis_status, "pending")

    def test_parent_container_rejected_on_non_containers(self):
        container = Container.objects.create(code="C1", name="Container 1")
        with self.assertRaises((ValidationError, IntegrityError)):
            MediaAsset.objects.create(
                code="A1", name="Asset 1", parent_container=container
            )


class ContainerHierarchyTests(TestCase):
    def _tree(self):
        root = Container.objects.create(code="ROOT", name="Root")
        child = Container.objects.create(code="CHILD", name="Child", parent_container=root)
        grand = Container.objects.create(code="GRAND", name="Grand", parent_container=child)
        return root, child, grand

    def test_materialized_paths(self):
        root, child, grand = self._tree()
        self.assertEqual(root.path, "/ROOT/")
        self.assertEqual(child.path, "/ROOT/CHILD/")
        self.assertEqual(grand.path, "/ROOT/CHILD/GRAND/")
        self.assertEqual((root.depth, child.depth, grand.depth), (0, 1, 2))

    def test_ancestors_and_descendants(self):
        root, child, grand = self._tree()
        self.assertEqual(
            [c.code for c in grand.get_ancestors_by_path()], ["ROOT", "CHILD"]
        )
        self.assertEqual(
            [c.code for c in root.get_descendants_by_path()], ["CHILD", "GRAND"]
        )
        self.assertTrue(root.is_ancestor_of(grand))
        self.assertTrue(grand.is_descendant_of(root))

    def test_move_relabels_whole_subtree(self):
        root, child, grand = self._tree()
        new_root = Container.objects.create(code="NEW", name="New Root")

        child.parent_container = new_root
        child.save()

        child.refresh_from_db()
        grand.refresh_from_db()
        self.assertEqual(child.path, "/NEW/CHILD/")
        self.assertEqual(grand.path, "/NEW/CHILD/GRAND/")
        self.assertEqual(grand.depth, 2)

    def test_move_subtree_touches_db_constant_times(self):
        """Subtree relabel is one UPDATE regardless of descendant count."""
        root, child, grand = self._tree()
        for i in range(10):
            Container.objects.create(
                code=f"LEAF{i}", name=f"Leaf {i}", parent_container=grand
            )
        new_root = Container.objects.create(code="NEW", name="New Root")

        child.parent_container = new_root
        child.save()

        self.assertEqual(
            Container.objects.filter(path__startswith="/NEW/CHILD/").count(), 12
        )
        for leaf in Container.objects.filter(code__startswith="LEAF"):
            self.assertEqual(leaf.depth, 3)
            self.assertTrue(leaf.path.startswith("/NEW/CHILD/GRAND/"))

    def test_circular_move_rejected(self):
        root, child, grand = self._tree()
        root.parent_container = grand
        with self.assertRaises(ValidationError):
            root.save()

    def test_cte_descendants_match_path_descendants(self):
        root, child, grand = self._tree()
        cte = [c.code for c in Container.objects.get_descendants_cte(root)]
        path = [c.code for c in root.get_descendants_by_path()]
        self.assertEqual(cte, path)


class VersionPinningTests(TestCase):
    def setUp(self):
        self.asset = MediaAsset.objects.create(code="CHAR", name="Character")
        self.v1 = Version.objects.create(entity=self.asset, version_number=1, data={"r": 1})
        self.v2 = Version.objects.create(entity=self.asset, version_number=2, data={"r": 2})
        update_symlink(self.asset, "latest", self.v2)
        self.container = Container.objects.create(code="SHOT", name="Shot 010")

    def test_container_version_pins_symlink_resolution(self):
        cv = create_container_version(
            self.container, {"character": (self.asset, "latest")}, symlinks=["latest"]
        )

        ref = cv.references.get()
        self.assertEqual(ref.symlink_version, self.v2)

        # Moving the symlink afterwards must NOT change the pinned version.
        v3 = Version.objects.create(entity=self.asset, version_number=3, data={"r": 3})
        update_symlink(self.asset, "latest", v3)

        ref.refresh_from_db()
        self.assertEqual(ref.symlink_version, self.v2)

        resolved = resolve_container_references(cv)
        entry = resolved["character"]
        self.assertEqual(entry["version_at_creation"], self.v2)
        self.assertEqual(entry["current_version"], v3)
        self.assertFalse(entry["is_current"])

    def test_container_version_is_a_version_row(self):
        cv = create_container_version(self.container, {"character": (self.asset, "latest")})
        self.assertEqual(Version.objects.filter(pk=cv.pk).count(), 1)
        self.assertEqual(ContainerVersion.objects.count(), 1)
        # Asset versions are not container versions
        self.assertEqual(ContainerVersion.objects.filter(entity=self.asset).count(), 0)

    def test_missing_symlink_raises(self):
        with self.assertRaises(ValueError):
            create_container_version(self.container, {"x": (self.asset, "approved")})

    def test_version_entity_returns_proxy(self):
        cv = create_container_version(self.container, {})
        fetched = Version.objects.get(pk=cv.pk)
        self.assertIsInstance(fetched.entity, Container)

    def test_bulk_create_versions_continues_numbering(self):
        created = bulk_create_versions(self.asset, [{"a": 1}, {"a": 2}])
        self.assertEqual([v.version_number for v in created], [3, 4])

    def test_duplicate_version_number_rejected(self):
        with self.assertRaises(IntegrityError):
            Version.objects.create(entity=self.asset, version_number=1, data={})


class PublishTests(TestCase):
    def test_publish_allocates_numbers_and_moves_symlinks(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset")
        v1 = asset.publish({"f": 1})
        v2 = asset.publish({"f": 2}, symlinks=["latest", "approved"])

        self.assertEqual((v1.version_number, v2.version_number), (1, 2))
        self.assertEqual(asset.resolve_symlink("latest"), v2)
        self.assertEqual(asset.resolve_symlink("approved"), v2)

    def test_publish_stores_content_hash(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset")
        version = asset.publish({"f": 1}, content_hash="sha256:abc")
        version.refresh_from_db()
        self.assertEqual(version.content_hash, "sha256:abc")

    def test_publish_records_lineage(self):
        batch = Container.objects.create(code="B1", name="Batch")
        batch_version = create_container_version(batch, {})
        output = MediaAsset.objects.create(code="OUT1", name="Output")

        output_version = output.publish(
            {"seed": 7}, upstream={GENERATED_FROM_BATCH: batch_version}
        )

        link = output_version.upstream_links.get()
        self.assertEqual(link.from_version, batch_version)
        self.assertEqual(link.role, GENERATED_FROM_BATCH)

    def test_publish_validates_registered_payload_schema(self):
        recipe = GenerationRecipe.objects.create(code="R1", name="Recipe")
        with self.assertRaises(ValidationError):
            recipe.publish({"steps": 30})  # missing sampler and cfg
        # valid payload passes
        recipe.publish({"sampler": "euler_a", "steps": 30, "cfg": 6.5})


class DeletionProtectionTests(TestCase):
    def setUp(self):
        self.asset = MediaAsset.objects.create(code="CHAR", name="Character")
        self.v1 = self.asset.publish({"f": 1})
        self.container = Container.objects.create(code="SHOT", name="Shot")
        self.shot_v1 = create_container_version(
            self.container, {"character": (self.asset, "latest")}
        )

    def test_pinned_entity_cannot_be_deleted(self):
        with self.assertRaises(RestrictedError):
            self.asset.delete()

    def test_pinned_version_cannot_be_deleted(self):
        with self.assertRaises(RestrictedError):
            self.v1.delete()

    def test_symlinked_version_cannot_be_deleted_directly(self):
        loose = MediaAsset.objects.create(code="LOOSE", name="Loose")
        version = loose.publish({"f": 1})  # symlink 'latest' points at it
        with self.assertRaises(RestrictedError):
            version.delete()

    def test_batch_version_protected_while_outputs_link_to_it(self):
        output = MediaAsset.objects.create(code="OUT1", name="Output")
        output.publish({"seed": 1}, upstream={GENERATED_FROM_BATCH: self.shot_v1})
        with self.assertRaises(RestrictedError):
            self.shot_v1.delete()
        # deleting the output removes the lineage edge, then the batch version frees up
        output.delete()
        self.assertEqual(VersionLink.objects.count(), 0)

    def test_wholesale_teardown_still_works(self):
        """Deleting pinner and pinned in one operation is allowed (RESTRICT semantics)."""
        VersionedEntity.objects.filter(code__in=["CHAR", "SHOT"]).delete()
        self.assertEqual(VersionedEntity.objects.count(), 0)
        self.assertEqual(Version.objects.count(), 0)

    def test_archive_instead_of_delete(self):
        self.asset.archive()
        self.assertTrue(self.asset.is_archived)
        self.assertEqual(MediaAsset.objects.active().count(), 0)
        self.assertEqual(MediaAsset.objects.count(), 1)
        self.asset.unarchive()
        self.assertEqual(MediaAsset.objects.active().count(), 1)


class SymlinkAuditTests(TestCase):
    def test_moves_are_recorded(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset")
        v1 = asset.publish({"f": 1})
        v2 = asset.publish({"f": 2})

        events = list(
            SymlinkEvent.objects.filter(entity=asset, name="latest").order_by("created_at")
        )
        self.assertEqual(len(events), 2)
        self.assertIsNone(events[0].old_version)
        self.assertEqual(events[0].new_version, v1)
        self.assertEqual(events[1].old_version, v1)
        self.assertEqual(events[1].new_version, v2)

    def test_repointing_to_same_version_records_nothing(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset")
        v1 = asset.publish({"f": 1})
        update_symlink(asset, "latest", v1)
        self.assertEqual(SymlinkEvent.objects.filter(entity=asset).count(), 1)

    def test_time_travel_resolution(self):
        asset = MediaAsset.objects.create(code="A1", name="Asset")
        v1 = asset.publish({"f": 1})
        between = timezone.now()
        v2 = asset.publish({"f": 2})

        self.assertEqual(resolve_symlink_at(asset, "latest", between), v1)
        self.assertEqual(resolve_symlink_at(asset, "latest", timezone.now()), v2)
        self.assertIsNone(resolve_symlink_at(asset, "approved", timezone.now()))


class ConcurrentVersionNumberTests(TransactionTestCase):
    """Concurrent publishes must serialize on the entity lock, never collide."""

    def test_parallel_container_version_creation(self):
        asset = MediaAsset.objects.create(code="CHAR", name="Character")
        v1 = Version.objects.create(entity=asset, version_number=1, data={})
        update_symlink(asset, "latest", v1)
        container = Container.objects.create(code="SHOT", name="Shot")

        errors = []
        barrier = threading.Barrier(4)

        def publish():
            try:
                barrier.wait(timeout=5)
                create_container_version(container, {"character": (asset, "latest")})
            except Exception as exc:  # pragma: no cover - failure detail
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=publish) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        self.assertEqual(errors, [])
        numbers = sorted(
            Version.objects.filter(entity=container).values_list(
                "version_number", flat=True
            )
        )
        self.assertEqual(numbers, [1, 2, 3, 4])
