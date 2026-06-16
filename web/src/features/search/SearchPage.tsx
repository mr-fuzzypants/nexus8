import { useEffect, useMemo, useRef, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { Button, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { IconBookmarkPlus, IconSearch, IconUpload, IconX } from '@tabler/icons-react';
import { createSmartCollection } from '../../api/intelligence';
import clsx from 'clsx';
import {
  searchLibrary,
  uploadFiles,
  type AssetSummary,
  type FacetValue,
} from '../../api/library';
import { useLibraryStore } from '../../stores/library';
import { AssetGrid } from '../grid/AssetGrid';
import { AssetPanel } from '../asset/AssetPanel';
import { useSearchState } from './useSearchState';
import { RecommendationsStrip } from './RecommendationsStrip';
import { EntityFilterModal } from './EntityFilterModal';
import { useProject } from '../projects/ProjectContext';
import type { EntityFacet } from '../../api/library';

const DENSITIES = [
  { label: 'S', value: '160' },
  { label: 'M', value: '220' },
  { label: 'L', value: '300' },
];

function FacetChip({
  facet,
  active,
  onClick,
}: {
  facet: FacetValue;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={clsx('facet-chip', active && 'active')} onClick={onClick}>
      {facet.value}
      <span className="count">{facet.count}</span>
    </button>
  );
}

export function SearchPage() {
  const { code } = useProject();
  const { state, update, toggleTag } = useSearchState();
  const [input, setInput] = useState(state.q);
  const [debouncedInput] = useDebouncedValue(input, 250);
  const [rowHeight, setRowHeight] = useState('220');
  const [selected, setSelected] = useState<AssetSummary | null>(null);
  const [entityModalOpen, setEntityModalOpen] = useState(false);
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pushRecent = useLibraryStore((s) => s.pushRecent);
  const queryClient = useQueryClient();

  useHotkeys([['/', () => searchRef.current?.focus()]]);

  useEffect(() => {
    if (debouncedInput !== state.q) update({ q: debouncedInput });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput]);

  const query = useInfiniteQuery({
    queryKey: ['library-search', code, state.q, state.tags, state.mediaType],
    queryFn: ({ pageParam }) =>
      searchLibrary({
        q: state.q,
        tags: state.tags,
        mediaType: state.mediaType,
        project: code,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.num_pages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });

  const assets = useMemo(
    () => query.data?.pages.flatMap((page) => page.results) ?? [],
    [query.data],
  );
  const facets = query.data?.pages[0]?.facets;
  const totalCount = query.data?.pages[0]?.count ?? 0;

  const upload = useMutation({
    mutationFn: (files: File[]) => uploadFiles(files, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-search'] });
    },
  });

  const hasActiveSearch = Boolean(state.q || state.tags.length || state.mediaType);
  const [saveModal, setSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveSearch = useMutation({
    mutationFn: () =>
      createSmartCollection(saveName, window.location.search.replace(/^\?/, ''), code),
    onSuccess: () => {
      setSaveModal(false);
      setSaveName('');
      queryClient.invalidateQueries({ queryKey: ['smart-collections'] });
    },
  });

  const openAsset = (asset: AssetSummary) => {
    setSelected(asset);
    pushRecent(asset);
  };

  const handleEntityToggle = (key: string, facet: EntityFacet) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Remove from input query
        const token = `${facet.role}:${facet.value.includes(' ') ? `"${facet.value}"` : facet.value}`;
        setInput(input.replace(token, '').replace(/\s{2,}/g, ' ').trim());
      } else {
        next.add(key);
        // Add to input query
        const token = `${facet.role}:${facet.value.includes(' ') ? `"${facet.value}"` : facet.value}`;
        setInput(`${input} ${token}`.trim());
      }
      return next;
    });
  };

  // Facet rows show selected tags first (even when no longer in the top N).
  const tagFacets = useMemo(() => {
    if (!facets) return [];
    const listed = new Set(facets.tags.map((f) => f.value));
    const extras = state.tags
      .filter((tag) => !listed.has(tag))
      .map((tag) => ({ value: tag, count: 0 }));
    return [...extras, ...facets.tags];
  }, [facets, state.tags]);

  return (
    <>
      <header className="search-header">
        <div className="search-toolbar">
          <TextInput
            ref={searchRef}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder='Search references… (try free text, or tokens like "tag:hero type:image")'
            leftSection={<IconSearch size={16} stroke={1.75} />}
            rightSection={
              input ? (
                <IconX
                  size={14}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setInput('')}
                  aria-label="Clear search"
                />
              ) : undefined
            }
            style={{ flex: 1, maxWidth: 640 }}
            size="sm"
            aria-label="Search references"
          />
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }} aria-live="polite">
            {query.isFetching && !query.isFetchingNextPage
              ? 'Searching…'
              : `${totalCount.toLocaleString()} asset${totalCount === 1 ? '' : 's'}`}
          </Text>
          <SegmentedControl
            size="xs"
            value={rowHeight}
            onChange={setRowHeight}
            data={DENSITIES}
            aria-label="Grid density"
          />
          {hasActiveSearch && (
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconBookmarkPlus size={15} stroke={1.75} />}
              onClick={() => setSaveModal(true)}
            >
              Save search
            </Button>
          )}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconUpload size={15} stroke={1.75} />}
            loading={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            Add images
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              if (files.length) upload.mutate(files);
              e.currentTarget.value = '';
            }}
          />
        </div>

        {facets && (facets.entities?.length ?? 0) > 0 && (
          <div className="facet-row">
            <button
              type="button"
              className="facet-chip"
              onClick={() => setEntityModalOpen(true)}
              style={{ gap: '6px' }}
            >
              🔍 Filter entities
              {selectedEntities.size > 0 && <span className="count">{selectedEntities.size}</span>}
            </button>
            {Array.from(selectedEntities).map((key) => {
              const [role, value] = key.split(':');
              return (
                <button
                  key={key}
                  type="button"
                  className="facet-chip active"
                  onClick={() => {
                    const facet = facets.entities!.find((f) => f.role === role && f.value === value);
                    if (facet) handleEntityToggle(key, facet);
                  }}
                >
                  {role}: {value}
                  <span className="count">{facets.entities!.find((f) => f.role === role && f.value === value)?.count || 0}</span>
                </button>
              );
            })}
          </div>
        )}

        {facets && (facets.media_type.length > 1 || tagFacets.length > 0) && (
          <div className="facet-row">
            {facets.media_type.length > 1 &&
              facets.media_type.map((facet) => (
                <FacetChip
                  key={`type-${facet.value}`}
                  facet={facet}
                  active={state.mediaType === facet.value}
                  onClick={() =>
                    update({ mediaType: state.mediaType === facet.value ? '' : facet.value })
                  }
                />
              ))}
            {facets.media_type.length > 1 && tagFacets.length > 0 && (
              <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
            )}
            {tagFacets.map((facet) => (
              <FacetChip
                key={`tag-${facet.value}`}
                facet={facet}
                active={state.tags.includes(facet.value)}
                onClick={() => toggleTag(facet.value)}
              />
            ))}
          </div>
        )}
      </header>

      {!hasActiveSearch && <RecommendationsStrip onOpen={openAsset} />}

      <AssetGrid
        assets={assets}
        onOpen={openAsset}
        rowHeight={Number(rowHeight)}
        hasMore={Boolean(query.hasNextPage)}
        isFetching={query.isFetching}
        fetchMore={() => query.fetchNextPage()}
      />

      <AssetPanel
        asset={selected}
        onClose={() => setSelected(null)}
        onOpenAsset={openAsset}
        onTagClick={(tag) => {
          setSelected(null);
          if (!state.tags.includes(tag)) toggleTag(tag);
        }}
      />

      <Modal
        opened={saveModal}
        onClose={() => setSaveModal(false)}
        title="Save search as smart collection"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={saveName}
            onChange={(e) => setSaveName(e.currentTarget.value)}
            placeholder="e.g. Crimson abstracts"
            data-autofocus
          />
          <Button
            disabled={!saveName.trim()}
            loading={saveSearch.isPending}
            onClick={() => saveSearch.mutate()}
          >
            Save
          </Button>
        </Stack>
      </Modal>

      <EntityFilterModal
        opened={entityModalOpen}
        onClose={() => setEntityModalOpen(false)}
        entities={facets?.entities ?? []}
        selected={selectedEntities}
        onToggle={handleEntityToggle}
      />

      <Dropzone.FullScreen
        active
        accept={['image/*']}
        onDrop={(files) => upload.mutate(files)}
      >
        <div className="empty-state" style={{ pointerEvents: 'none' }}>
          <IconUpload size={36} stroke={1.4} />
          <Text>Drop images to add them to your library</Text>
        </div>
      </Dropzone.FullScreen>
    </>
  );
}
