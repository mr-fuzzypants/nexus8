import { Badge, Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityDetail } from '../../api/intelligence';
import { getReferenceSlots, setReferenceSlot } from '../../api/intents';
import type { VersionPolicy } from './types';

const POLICY_COLORS: Record<VersionPolicy, string> = {
  approved: 'teal',
  latest: 'gray',
  pinned: 'grape',
};

/** Curated named reference slots on an entity (character.turnaround, …) — what workflow input bindings resolve through. */
export function ReferencesSection({ entity }: { entity: EntityDetail }) {
  const qc = useQueryClient();
  const { data: slots = [] } = useQuery({
    queryKey: ['reference-slots', entity.code],
    queryFn: () => getReferenceSlots(entity.code),
  });

  if (slots.length === 0) return null;

  async function changePolicy(slot: string, assetCode: string, policy: VersionPolicy) {
    await setReferenceSlot(entity.code, slot, assetCode, policy);
    qc.invalidateQueries({ queryKey: ['reference-slots', entity.code] });
  }

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          References
        </Text>
        <Text size="xs" c="dimmed">
          named slots workflows resolve through
        </Text>
      </Group>
      <Group gap={10} align="stretch">
        {slots.map((entry) => (
          <Group
            key={entry.slot}
            gap={10}
            wrap="nowrap"
            style={{
              border: '1px solid var(--border, rgba(148,163,184,0.2))',
              borderRadius: 10,
              padding: 8,
            }}
          >
            {entry.thumb && (
              <img
                src={entry.thumb}
                alt=""
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }}
              />
            )}
            <div>
              <Text size="xs" fw={600}>
                {entry.slot}
              </Text>
              <Text size="xs" ff="monospace" c="dimmed">
                {entry.assetCode}
              </Text>
              <Group gap={4} mt={4}>
                <Badge size="xs" variant="outline">
                  v{entry.version}
                </Badge>
                <Menu shadow="md" width={190}>
                  <Menu.Target>
                    <Tooltip label="Version policy for this slot">
                      <UnstyledButton>
                        <Badge
                          size="xs"
                          variant="light"
                          color={POLICY_COLORS[entry.policy]}
                          tt="none"
                          rightSection={<IconChevronDown size={10} />}
                        >
                          {entry.policy}
                        </Badge>
                      </UnstyledButton>
                    </Tooltip>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Resolve this slot as</Menu.Label>
                    {(['approved', 'latest', 'pinned'] as VersionPolicy[]).map((option) => (
                      <Menu.Item
                        key={option}
                        onClick={() => changePolicy(entry.slot, entry.assetCode, option)}
                      >
                        <Text size="xs">
                          {option === 'approved'
                            ? 'follow approved'
                            : option === 'latest'
                              ? 'follow latest'
                              : `pin v${entry.version}`}
                        </Text>
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </div>
          </Group>
        ))}
      </Group>
    </div>
  );
}
