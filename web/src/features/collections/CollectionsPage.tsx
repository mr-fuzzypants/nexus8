import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ActionIcon, Badge, Text } from '@mantine/core';
import { IconBookmark, IconTrash } from '@tabler/icons-react';
import { deleteSmartCollection, listSmartCollections } from '../../api/intelligence';
import { useProject } from '../projects/ProjectContext';

export function CollectionsPage() {
  const [, navigate] = useLocation();
  const { code } = useProject();
  const queryClient = useQueryClient();
  const collections = useQuery({
    queryKey: ['smart-collections', code],
    queryFn: () => listSmartCollections(code),
  });
  const remove = useMutation({
    mutationFn: deleteSmartCollection,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['smart-collections'] }),
  });

  return (
    <>
      <header className="search-header">
        <div className="search-toolbar">
          <Text fw={600}>Collections</Text>
          <Text size="xs" c="dimmed">
            {collections.data?.length ?? 0} smart collection
            {collections.data?.length === 1 ? '' : 's'}
          </Text>
        </div>
      </header>

      {collections.data?.length === 0 ? (
        <div className="empty-state">
          <IconBookmark size={36} stroke={1.4} />
          <p style={{ maxWidth: 440, margin: 0 }}>
            No smart collections yet. Run a search, then hit “Save search” — the collection re-runs
            the query live, so it always reflects your latest library.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '1.25rem', overflowY: 'auto' }}>
          {collections.data?.map((collection) => (
            <div
              key={collection.id}
              className="smart-collection-row"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/?${collection.query}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/?${collection.query}`)}
            >
              <IconBookmark size={17} stroke={1.75} style={{ color: 'var(--primary)' }} />
              <Text size="sm" fw={550}>
                {collection.name}
              </Text>
              <Badge variant="light" style={{ textTransform: 'none' }}>
                {decodeURIComponent(collection.query) || 'everything'}
              </Badge>
              <div style={{ flex: 1 }} />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Delete ${collection.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove.mutate(collection.id);
                }}
              >
                <IconTrash size={15} stroke={1.75} />
              </ActionIcon>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
