import { useMemo, useState } from 'react';
import { Checkbox, Group, Modal, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { EntityFacet } from '../../api/library';

interface EntityFilterModalProps {
  opened: boolean;
  onClose: () => void;
  entities: EntityFacet[];
  selected: Set<string>; // keys like "character:Wanda"
  onToggle: (key: string, facet: EntityFacet) => void;
}

export function EntityFilterModal({
  opened,
  onClose,
  entities,
  selected,
  onToggle,
}: EntityFilterModalProps) {
  const [query, setQuery] = useState('');

  // Group by role, filter by search
  const grouped = useMemo(() => {
    const groups: Record<string, EntityFacet[]> = {};
    for (const entity of entities) {
      if (!groups[entity.role]) groups[entity.role] = [];
      groups[entity.role].push(entity);
    }

    // Filter by search
    if (query.trim()) {
      const q = query.toLowerCase();
      Object.keys(groups).forEach((role) => {
        groups[role] = groups[role].filter((e) => e.value.toLowerCase().includes(q));
      });
    }

    // Remove empty roles, sort by role name
    return Object.entries(groups)
      .filter(([, items]) => items.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [entities, query]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Filter by entity"
      size="sm"
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      <TextInput
        placeholder="Search entities…"
        leftSection={<IconSearch size={16} stroke={1.75} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb="md"
        data-autofocus
      />

      {grouped.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--muted)' }}>No entities match.</p>
      ) : (
        grouped.map(([role, items]) => (
          <div key={role} style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--muted)',
                marginBottom: '0.5rem',
              }}
            >
              {role} ({items.length})
            </div>
            <Group gap="xs">
              {items.map((entity) => {
                const key = `${entity.role}:${entity.value}`;
                const checked = selected.has(key);
                return (
                  <label key={key} style={{ cursor: 'pointer', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Checkbox
                      checked={checked}
                      onChange={() => onToggle(key, entity)}
                      aria-label={`Filter by ${entity.role}: ${entity.value}`}
                    />
                    <span style={{ fontSize: '0.875rem' }}>
                      {entity.value}
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '4px' }}>
                        ({entity.count})
                      </span>
                    </span>
                  </label>
                );
              })}
            </Group>
          </div>
        ))
      )}
    </Modal>
  );
}
