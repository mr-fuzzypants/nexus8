"""
Seed a realistic CG/VFX demo production from REAL (non-synthetic) media.

Themed on Blender's open VFX short "Tears of Steel" (CC-BY): a sci-fi/robot
film, which maps cleanly onto a CG pipeline (sequences, shots, departments)
and whose subject matter matches the real 3D character/prop models we pull
from the Khronos glTF Sample Assets.

What it creates
---------------
* A top-level Project (hard-partition scope); every entity/asset/folder below
  is stamped with its project_code, so the whole demo opens as one project in
  the SPA workspace.
* Assets / Editorial / Sequences -> Shots folder (container) hierarchy.
* Real 3D GLB assets (animated robot, rigged human, sci-fi helmet, set piece)
  downloaded from the Khronos glTF Sample Assets repo, each with a real render
  thumbnail and a small version history (model -> rig -> lookdev).
* Real image-sequence plates: genuine consecutive frames sliced from the film.
* Real movies: per-shot dailies (short real clips) + the full film delivery.
* Descriptive entities (characters/prop/location) linked to assets, plus
  first-class sequence/shot entities (the trackable production units).
* Per-shot department task trees (Layout/Anim/FX/Lighting/Comp) with progress.
* Shot "packages" (container versions) that pin the exact asset versions used.
* A dependency DAG (DependencyLink edges) wiring film -> sequence entities ->
  shot entities -> assets, so the dependency/impact graph view renders the
  whole production; shot entities also list their assets via EntityRelation.

All media is real and CC-licensed. Downloads are cached under
``<media_root>/../.seed_cache`` so re-runs are fast. Idempotent: everything
under the ``TOS_`` code prefix is deleted and rebuilt each run.

    python manage.py seed_demo_production
    python manage.py seed_demo_production --no-movie   # skip the 354MB film
"""

import hashlib
import io
import os
import ssl
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from trackables.models import (
    Container,
    DependencyLink,
    EntityRelation,
    MediaAsset,
    Project,
    VersionedEntity,
    bulk_create_versions,
    create_container_hierarchy,
    create_container_version,
    create_task_hierarchy,
    update_symlink,
)
from trackables.services.ingest import store_media_bytes

PREFIX = "TOS_"

# The demo's top-level project (hard-partition scope). Every entity/asset this
# command creates is stamped with PROJECT_CODE so it shows up under this project
# in the SPA's project workspace.
PROJECT_CODE = f"{PREFIX}PROJ"
PROJECT_NAME = "Tears of Steel"

GLTF = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models"

# Real 3D assets: (code, name, category, glb_url, screenshot_url, dept_history)
GLB_ASSETS = [
    (
        "HERO", "Aud (hero, human)", "character",
        f"{GLTF}/CesiumMan/glTF-Binary/CesiumMan.glb",
        f"{GLTF}/CesiumMan/screenshot/screenshot.gif",
    ),
    (
        "ROBOT", "Sentry Robot", "character",
        f"{GLTF}/BrainStem/glTF-Binary/BrainStem.glb",
        f"{GLTF}/BrainStem/screenshot/screenshot.gif",
    ),
    (
        "HELMET", "Battle Helmet", "prop",
        f"{GLTF}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
        f"{GLTF}/DamagedHelmet/screenshot/screenshot.png",
    ),
    (
        "SET", "Amsterdam Set Piece", "prop",
        f"{GLTF}/ABeautifulGame/glTF-Binary/ABeautifulGame.glb",
        f"{GLTF}/ABeautifulGame/screenshot/screenshot.jpg",
    ),
]

# Full film delivery (real CC-BY encode).
MOVIE_URL = "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov"

# Shots: (code, name, seq_code, plate_time_s, frame_count) — time = where in the
# film to slice the real plate frames + dailies clip from.
SHOTS = [
    ("SH010", "Rooftop reveal", "SEQ010", 38.0, 36),
    ("SH020", "Robot approach", "SEQ010", 561.0, 36),
    ("SH030", "Final standoff", "SEQ020", 583.0, 36),
]

DEPARTMENTS = ["Layout", "Animation", "FX", "Lighting", "Comp"]
ARTISTS = ["mira", "jun", "deva", "kai", "noor"]

# Which asset each shot consumes, and at which symlink (pinned for repro).
# role -> (asset code, symlink). Drives both the shot "package" (Container
# references) and the DependencyLink edges the graph view renders.
SHOT_ASSET_DEPS = [
    ("hero", "HERO", "approved"),
    ("robot", "ROBOT", "approved"),
    ("helmet", "HELMET", "latest"),
    ("set", "SET", "approved"),
]


class Command(BaseCommand):
    help = "Seed a realistic CG/VFX demo production from real Tears of Steel media."

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-movie", action="store_true",
            help="Skip the full-film download + plates/dailies (GLB assets only).",
        )

    # -- infra ---------------------------------------------------------------

    def heading(self, text):
        self.stdout.write(self.style.MIGRATE_HEADING(f"\n=== {text} ==="))

    def _ffmpeg(self):
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()

    def _ssl_context(self):
        try:
            import certifi
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:  # pragma: no cover - last-resort for public CC assets
            return ssl._create_unverified_context()

    def _cache_dir(self):
        d = Path(settings.MEDIA_ROOT).parent / ".seed_cache"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _download(self, url, *, label):
        """Download to cache (skip if already present). Returns local Path."""
        dest = self._cache_dir() / hashlib.sha1(url.encode()).hexdigest()[:16] / os.path.basename(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.stat().st_size > 0:
            self.stdout.write(f"  cached  {label} ({dest.stat().st_size // 1024} KB)")
            return dest
        self.stdout.write(f"  fetch   {label} ...")
        req = urllib.request.Request(url, headers={"User-Agent": "nexus8-seed"})
        tmp = dest.with_suffix(dest.suffix + ".part")
        with urllib.request.urlopen(req, timeout=120, context=self._ssl_context()) as resp, open(tmp, "wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            read = 0
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
                read += len(chunk)
                if total > 1 << 24 and read % (1 << 25) < (1 << 20):
                    self.stdout.write(f"    {read // 1024 // 1024}/{total // 1024 // 1024} MB")
        tmp.rename(dest)
        self.stdout.write(f"  done    {label} ({dest.stat().st_size // 1024} KB)")
        return dest

    def _thumb_from_image_bytes(self, image_bytes, content_hash):
        """
        Build a thumbnail pyramid for a non-image asset (GLB / movie) from a
        still. Unlike the ingest pyramid we never size-gate: even a small
        130px Khronos render screenshot yields a real grid thumbnail.
        """
        import base64

        from PIL import Image

        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.load()
        except Exception as exc:  # pragma: no cover - defensive
            self.stdout.write(self.style.WARNING(f"    thumbnail failed: {exc}"))
            return {}, {}, ""

        width, height = img.size
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        thumbnails = {}
        for size in (256, 1024):
            thumb = img.copy()
            thumb.thumbnail((size, size), Image.LANCZOS)
            buffer = io.BytesIO()
            thumb.convert("RGB").save(buffer, "WEBP", quality=82)
            rel = f"assets/thumbs/{content_hash}_{size}.webp"
            if default_storage.exists(rel):  # stable name across re-runs
                default_storage.delete(rel)
            default_storage.save(rel, io.BytesIO(buffer.getvalue()))
            thumbnails[str(size)] = settings.MEDIA_URL + rel

        tiny = img.copy()
        tiny.thumbnail((24, 24), Image.LANCZOS)
        buffer = io.BytesIO()
        tiny.convert("RGB").save(buffer, "WEBP", quality=40)
        placeholder = "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode()

        technical = {"width": width, "height": height, "format": (img.format or "").lower()}
        return thumbnails, technical, placeholder

    def _make_asset(self, code, name, *, file_bytes, filename, media_type,
                    thumb_bytes=None, tags=None, department=None, category=None):
        """Store real bytes + thumbnail, create a published MediaAsset."""
        stored = store_media_bytes(file_bytes, filename)
        content_hash = stored["content_hash"]
        thumbnails = stored["thumbnails"]
        placeholder = stored["placeholder"]
        technical = dict(stored["technical_metadata"])
        if thumb_bytes is not None:
            thumbnails, tech2, placeholder = self._thumb_from_image_bytes(thumb_bytes, content_hash)
            technical.setdefault("width", tech2.get("width"))
            technical.setdefault("height", tech2.get("height"))
        type_data = {
            "file_path": stored["file_path"],
            "media_type": media_type,
            "original_filename": filename,
            "thumbnails": thumbnails,
            "placeholder": placeholder,
            "technical_metadata": technical,
            "tags": tags or [],
            "project_code": PROJECT_CODE,
        }
        if department:
            type_data["department"] = department
        if category:
            type_data["category"] = category
        asset = MediaAsset.objects.create(code=f"{PREFIX}{code}", name=name, type_data=type_data)
        asset.publish(
            data={
                "file_path": stored["file_path"],
                "thumbnails": thumbnails,
                "technical_metadata": technical,
            },
            content_hash=content_hash,
        )
        return asset

    def _extract_frame(self, movie, time_s, width=512):
        """Grab one real frame as JPEG bytes."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
            out = tf.name
        subprocess.run(
            [self._ffmpeg(), "-y", "-ss", str(time_s), "-i", str(movie),
             "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", out],
            check=True, capture_output=True,
        )
        data = Path(out).read_bytes()
        os.unlink(out)
        return data

    def _extract_sequence(self, movie, time_s, count, width=854):
        """Slice `count` consecutive real frames. Returns list of JPEG bytes."""
        tmp = Path(tempfile.mkdtemp())
        subprocess.run(
            [self._ffmpeg(), "-y", "-ss", str(time_s), "-i", str(movie),
             "-frames:v", str(count), "-vf", f"scale={width}:-2", "-q:v", "3",
             "-start_number", "1001", str(tmp / "f.%04d.jpg")],
            check=True, capture_output=True,
        )
        frames = [p.read_bytes() for p in sorted(tmp.glob("f.*.jpg"))]
        for p in tmp.glob("*"):
            p.unlink()
        tmp.rmdir()
        return frames

    def _extract_clip(self, movie, time_s, dur, width=854):
        """Cut a short real clip, re-encoded to h264 mp4. Returns bytes."""
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
            out = tf.name
        subprocess.run(
            [self._ffmpeg(), "-y", "-ss", str(time_s), "-i", str(movie),
             "-t", str(dur), "-vf", f"scale={width}:-2", "-c:v", "libx264",
             "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", out],
            check=True, capture_output=True,
        )
        data = Path(out).read_bytes()
        os.unlink(out)
        return data

    # -- main ----------------------------------------------------------------

    def handle(self, *args, **options):
        no_movie = options["no_movie"]

        self.heading("0. Reset demo data")
        # Dependency links first: target_version is on_delete=RESTRICT, so links
        # pointing at demo versions must go before the entities are deleted.
        DependencyLink.objects.filter(
            source_version__entity__code__startswith=PREFIX
        ).delete()
        DependencyLink.objects.filter(
            target_version__entity__code__startswith=PREFIX
        ).delete()
        deleted, _ = VersionedEntity.objects.filter(code__startswith=PREFIX).delete()
        EntityRelation.objects.filter(asset__code__startswith=PREFIX).delete()
        self.stdout.write(f"deleted {deleted} rows from previous runs")

        # -- project (top-level scope) --------------------------------------
        self.heading("1. Project (top-level scope)")
        project_entity = Project.objects.create(
            code=PROJECT_CODE,
            name=PROJECT_NAME,
            description="Blender's open sci-fi short — a full CG/VFX demo production.",
            type_data={"status": "active", "started_at": "2012-09-26"},
        )
        self.stdout.write(f"  project '{project_entity.name}' ({project_entity.code})")

        # -- hierarchy -------------------------------------------------------
        self.heading("2. Folder hierarchy")
        create_container_hierarchy({
            "code": f"{PREFIX}PROJECT", "name": "Tears of Steel",
            "subcontainers": [
                {"code": f"{PREFIX}ASSETS", "name": "Assets", "subcontainers": [
                    {"code": f"{PREFIX}CHARS", "name": "Characters"},
                    {"code": f"{PREFIX}PROPS", "name": "Props"},
                ]},
                {"code": f"{PREFIX}EDIT", "name": "Editorial"},
                {"code": f"{PREFIX}SEQ010", "name": "Seq 010 — Rooftop", "subcontainers": [
                    {"code": f"{PREFIX}SH010", "name": "SH010 — Rooftop reveal"},
                    {"code": f"{PREFIX}SH020", "name": "SH020 — Robot approach"},
                ]},
                {"code": f"{PREFIX}SEQ020", "name": "Seq 020 — Standoff", "subcontainers": [
                    {"code": f"{PREFIX}SH030", "name": "SH030 — Final standoff"},
                ]},
            ],
        })
        project = Container.objects.get(code=f"{PREFIX}PROJECT")
        # Scope every folder in the tree to the project too.
        containers = [project, *project.get_descendants_by_path()]
        for c in containers:
            c.type_data = {**(c.type_data or {}), "project_code": PROJECT_CODE}
            c.save(update_fields=["type_data", "updated_at"])
            self.stdout.write(f"{'  ' * c.depth}{c.path}")

        # -- descriptive entities -------------------------------------------
        self.heading("3. Descriptive entities (characters / props)")
        entities = {}
        for code, name, category in [
            ("E_AUD", "Aud", "character"),
            ("E_ROBOT", "Sentry Robot", "character"),
            ("E_HELMET", "Battle Helmet", "prop"),
            ("E_ROOFTOP", "Rooftop", "location"),
        ]:
            ent = VersionedEntity.objects.create(
                entity_type="entity", code=f"{PREFIX}{code}", name=name,
                type_data={"category": category, "project_code": PROJECT_CODE},
            )
            entities[code] = ent
            self.stdout.write(f"  {category:<10} {name}")

        # -- 3D GLB assets ---------------------------------------------------
        self.heading("4. Real 3D GLB assets (Khronos glTF Sample Assets)")
        assets = {}
        # code -> {symlink_name: Version} so shot dependency links can pin the
        # exact version each shot consumes (approved vs latest).
        asset_versions = {}
        for code, name, category, glb_url, shot_url in GLB_ASSETS:
            glb = self._download(glb_url, label=f"{code}.glb").read_bytes()
            shot = self._download(shot_url, label=f"{code} screenshot").read_bytes()
            asset = self._make_asset(
                code, name, file_bytes=glb, filename=os.path.basename(glb_url),
                media_type="3d_model", thumb_bytes=shot,
                tags=["3d", category], category=category,
            )
            # A small, real-looking version history across departments.
            versions = bulk_create_versions(asset, [
                {"dept": "Modeling", "artist": "mira", "dcc": "blender", "status": "approved"},
                {"dept": "Rigging", "artist": "jun", "dcc": "blender", "status": "approved"},
                {"dept": "LookDev", "artist": "deva", "dcc": "substance", "status": "review"},
            ])
            update_symlink(asset, "latest", versions[-1])
            update_symlink(asset, "approved", versions[1])
            assets[code] = asset
            asset_versions[code] = {"latest": versions[-1], "approved": versions[1]}
            self.stdout.write(
                f"  {name}: {versions[-1].version_number} versions, "
                f"latest=v{versions[-1].version_number}, approved=v{versions[1].version_number}"
            )

        # Link assets <-> descriptive entities.
        for asset_code, ent_code, role in [
            ("HERO", "E_AUD", "character"),
            ("ROBOT", "E_ROBOT", "character"),
            ("HELMET", "E_HELMET", "prop"),
        ]:
            EntityRelation.objects.create(
                asset=assets[asset_code], entity=entities[ent_code], role=role, source="user",
            )

        movie_path = None
        if not no_movie:
            self.heading("5. Download film (real CC-BY Tears of Steel 720p)")
            movie_path = self._download(MOVIE_URL, label="tears_of_steel_720p.mov")

        # -- per-shot plates, dailies, packages, tasks ----------------------
        self.heading("6. Per-shot plates, dailies, departments, packages")
        plate_version_by_shot = {}  # shot_code -> plate Version (shot deps need it)
        for shot_code, shot_name, seq_code, t, nframes in SHOTS:
            shot = Container.objects.get(code=f"{PREFIX}{shot_code}")
            self.stdout.write(self.style.HTTP_INFO(f"\n  {shot_code} — {shot_name}"))

            plate = None
            plate_version = None
            if movie_path is not None:
                # Real image-sequence plate.
                frames = self._extract_sequence(movie_path, t, nframes)
                frame_urls = []
                base_hash = hashlib.sha256(frames[0]).hexdigest()[:16]
                for i, fb in enumerate(frames):
                    rel = f"assets/sequences/{PREFIX}{shot_code}/plate.{1001 + i:04d}.jpg"
                    if not default_storage.exists(rel):
                        default_storage.save(rel, io.BytesIO(fb))
                    frame_urls.append(settings.MEDIA_URL + rel)
                mid = frames[len(frames) // 2]
                plate = self._make_asset(
                    f"{shot_code}_PLATE", f"{shot_code} plate (image sequence)",
                    file_bytes=mid, filename=f"{shot_code}_plate.{1001:04d}.jpg",
                    media_type="image", department="Plate", tags=["plate", "sequence"],
                )
                plate.type_data["image_sequence"] = {
                    "pattern": f"plate.####.jpg", "first": 1001, "last": 1000 + nframes,
                    "frame_count": nframes, "fps": 24, "frames": frame_urls,
                }
                plate.save(update_fields=["type_data", "updated_at"])
                plate_versions = bulk_create_versions(plate, [
                    {"dept": "Plate", "artist": "kai", "status": "approved", "frames": nframes},
                ])
                update_symlink(plate, "latest", plate_versions[-1])
                plate_version = plate_versions[-1]
                self.stdout.write(f"    plate: {nframes} real frames -> {shot_code}/plate.####.jpg")

                # Real dailies clip (short real footage).
                clip = self._extract_clip(movie_path, t, 3.0)
                thumb = self._extract_frame(movie_path, t + 1)
                daily = self._make_asset(
                    f"{shot_code}_DAILY", f"{shot_code} comp dailies",
                    file_bytes=clip, filename=f"{shot_code}_comp_v003.mp4",
                    media_type="video", thumb_bytes=thumb,
                    department="Comp", tags=["dailies", "comp"],
                )
                self.stdout.write(f"    dailies: 3s real clip -> {daily.code}")

            # Department task tree.
            subtasks = [
                {"title": f"{dept}", "assigned_to": artist}
                for dept, artist in zip(DEPARTMENTS, ARTISTS)
            ]
            (root_task,) = create_task_hierarchy(
                shot, {"title": f"{shot_code} production", "task_type": "feature",
                       "subtasks": subtasks},
                assigned_to="mira",
            )
            # Mark upstream departments done to show progress.
            for done in ("Layout", "Animation"):
                root_task.subtasks.get(title=done).mark_completed()
            self.stdout.write(
                f"    departments: {len(DEPARTMENTS)} tasks, "
                f"{root_task.get_completion_percentage():.0f}% complete"
            )

            # Shot package: pin the exact asset versions used in this shot
            # (ContainerReference reproducibility — separate from the graph).
            refs = {role: (assets[code], sym) for role, code, sym in SHOT_ASSET_DEPS}
            if plate is not None:
                refs["plate"] = (plate, "latest")
                plate_version_by_shot[shot_code] = plate_version
            pkg = create_container_version(shot, references=refs, symlinks=["latest"])
            self.stdout.write(f"    package: {shot_code} v{pkg.version_number} pins {len(refs)} refs")

        # -- sequence & shot ENTITIES (the trackable production units) -------
        # Shots/sequences are first-class entities (visible on the Entities
        # page), each published as v1 and wired into the dependency graph:
        #   sequence -depends_on-> shot -uses-> asset
        self.heading("7. Sequence & shot entities (+ asset dependencies)")
        seq_shots = {}
        for shot_code, _name, seq_code, _t, _n in SHOTS:
            seq_shots.setdefault(seq_code, []).append(shot_code)
        seq_names = {"SEQ010": "Seq 010 — Rooftop", "SEQ020": "Seq 020 — Standoff"}
        shot_names = {sc: name for sc, name, *_ in SHOTS}

        def _entity_version(code, name, category):
            ent = VersionedEntity.objects.create(
                entity_type="entity", code=f"{PREFIX}{code}", name=name,
                type_data={"category": category, "project_code": PROJECT_CODE},
            )
            ent.publish()
            return ent, ent.versions.order_by("-version_number").first()

        shot_entities = {}
        for shot_code in shot_names:
            ent, ent_v = _entity_version(f"SHOT_{shot_code}", shot_names[shot_code], "shot")
            shot_entities[shot_code] = (ent, ent_v)
            # shot -uses-> each asset version (+ plate); also surface the assets
            # on the shot's entity hub via EntityRelation.
            deps = [(role, assets[code], asset_versions[code][sym])
                    for role, code, sym in SHOT_ASSET_DEPS]
            if shot_code in plate_version_by_shot:
                deps.append(("plate", None, plate_version_by_shot[shot_code]))
            for role, asset, target in deps:
                DependencyLink.objects.get_or_create(
                    source_version=ent_v, target_version=target,
                    relationship_type="uses", defaults={"role": role},
                )
                if asset is not None:
                    EntityRelation.objects.get_or_create(
                        asset=asset, entity=ent, role=role, defaults={"source": "user"},
                    )
            self.stdout.write(f"  shot   {ent.name}: {len(deps)} asset deps")

        seq_entities = {}
        for seq_code, shot_codes in seq_shots.items():
            ent, ent_v = _entity_version(
                f"SEQ_{seq_code}", seq_names.get(seq_code, seq_code), "sequence"
            )
            seq_entities[seq_code] = (ent, ent_v)
            for sc in shot_codes:
                DependencyLink.objects.get_or_create(
                    source_version=ent_v, target_version=shot_entities[sc][1],
                    relationship_type="depends_on", defaults={"role": "shot"},
                )
            self.stdout.write(f"  seq    {ent.name}: -> {len(shot_codes)} shot(s)")

        # -- final delivery movie -------------------------------------------
        film_version = None
        if movie_path is not None:
            self.heading("8. Editorial: full-film delivery (real movie)")
            film_bytes = movie_path.read_bytes()
            thumb = self._extract_frame(movie_path, 90)
            film = self._make_asset(
                "FILM", "Tears of Steel — final delivery",
                file_bytes=film_bytes, filename="tears_of_steel_720p.mov",
                media_type="video", thumb_bytes=thumb,
                department="Editorial", tags=["delivery", "film"],
            )
            self.stdout.write(f"  {film.name}: {len(film_bytes) // 1024 // 1024} MB")
            # Film -depends_on-> each sequence entity: the graph root for the
            # whole production (film -> seq -> shot -> asset).
            film_version = film.versions.order_by("-version_number").first()
            for seq_code, (_seq_ent, seq_v) in seq_entities.items():
                DependencyLink.objects.get_or_create(
                    source_version=film_version, target_version=seq_v,
                    relationship_type="depends_on", defaults={"role": "sequence"},
                )
            self.stdout.write(f"  film -> {len(seq_entities)} sequence dependency edges")

        # -- summary ---------------------------------------------------------
        self.heading("9. Summary")
        for et in ("project", "container", "entity", "media_asset"):
            n = VersionedEntity.objects.filter(code__startswith=PREFIX, entity_type=et).count()
            self.stdout.write(f"  {et:<12} {n}")
        dep_count = DependencyLink.objects.filter(
            source_version__entity__code__startswith=PREFIX
        ).count()
        self.stdout.write(f"  {'dep_links':<12} {dep_count}")
        self.stdout.write(self.style.SUCCESS(
            f"\nDemo production seeded into project '{PROJECT_NAME}' ({PROJECT_CODE}). "
            f"Open it from the project landing page, or go straight to "
            f"/p/{PROJECT_CODE} in the SPA."
        ))
        # Point at the richest graph root available.
        if film_version is not None:
            self.stdout.write(
                f"Dependency graph (film -> seq -> shot -> asset): "
                f"/p/{PROJECT_CODE}/graph/{film_version.id}"
            )
        elif shot_entities:
            _ent, any_shot_v = next(iter(shot_entities.values()))
            self.stdout.write(
                f"Dependency graph (shot -> assets): "
                f"/p/{PROJECT_CODE}/graph/{any_shot_v.id}"
            )
