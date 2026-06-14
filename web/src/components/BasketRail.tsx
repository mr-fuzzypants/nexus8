import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Indicator,
  Menu,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronRight,
  IconDots,
  IconDownload,
  IconFolderPlus,
  IconLayoutBoard,
  IconShoppingBag,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { createBoard, createCollection } from '../api/boards';
import { SLOTS, basketManifest, basketToCanvas, useBasketStore } from '../stores/basket';

function downloadJson(payload: object, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BasketRail() {
  const { items, collapsed, remove, setSlot, clear, toggleCollapsed } = useBasketStore();
  const [, navigate] = useLocation();
  const [collectionName, setCollectionName] = useState('');
  const [collectionModal, setCollectionModal] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const group = map.get(item.slot) ?? [];
      group.push(item);
      map.set(item.slot, group);
    }
    return [...map.entries()];
  }, [items]);

  const makeBoard = useMutation({
    mutationFn: () => createBoard('Reference board', basketToCanvas(items)),
    onSuccess: (board) => navigate(`/boards/${board.id}`),
  });

  const saveCollection = useMutation({
    mutationFn: () =>
      createCollection(
        collectionName,
        items.map((i) => i.asset.id),
      ),
    onSuccess: () => {
      setCollectionModal(false);
      setCollectionName('');
    },
  });

  if (collapsed) {
    return (
      <aside className="basket-rail collapsed">
        <Tooltip label="Reference basket" position="left">
          <Indicator
            label={items.length || undefined}
            size={16}
            color="teal"
            disabled={items.length === 0}
          >
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={toggleCollapsed}
              aria-label="Open reference basket"
            >
              <IconShoppingBag size={20} stroke={1.75} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside className="basket-rail">
      <div className="basket-header">
        <Text size="sm" fw={600}>
          Reference basket
        </Text>
        <Badge variant="light" size="sm">
          {items.length}
        </Badge>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={toggleCollapsed}
          aria-label="Collapse basket"
          style={{ marginLeft: 'auto' }}
        >
          <IconChevronRight size={16} stroke={1.75} />
        </ActionIcon>
      </div>

      <div className="basket-body">
        {items.length === 0 ? (
          <Text size="xs" c="dimmed" px="sm" py="lg" ta="center">
            Hover any asset and tap the bag icon to start collecting references.
          </Text>
        ) : (
          groups.map(([slot, groupItems]) => (
            <div key={slot}>
              <div className="basket-slot-label">{slot}</div>
              {groupItems.map(({ asset }) => (
                <div key={asset.id} className="basket-item">
                  <img
                    src={asset.thumbnails['256'] || asset.file_path || asset.placeholder}
                    alt=""
                    style={
                      asset.placeholder ? { backgroundImage: `url(${asset.placeholder})` } : undefined
                    }
                  />
                  <span className="basket-item-name">{asset.name}</span>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" size="sm" aria-label="Item actions">
                        <IconDots size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>Move to slot</Menu.Label>
                      {SLOTS.filter((s) => s !== slot).map((s) => (
                        <Menu.Item key={s} onClick={() => setSlot(asset.id, s)}>
                          {s}
                        </Menu.Item>
                      ))}
                      <Menu.Divider />
                      <Menu.Item
                        color="red"
                        leftSection={<IconX size={14} />}
                        onClick={() => remove(asset.id)}
                      >
                        Remove
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {items.length > 0 && (
        <Stack gap={6} className="basket-footer">
          <Button
            size="xs"
            leftSection={<IconLayoutBoard size={15} stroke={1.75} />}
            loading={makeBoard.isPending}
            onClick={() => makeBoard.mutate()}
          >
            Create board
          </Button>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconFolderPlus size={15} stroke={1.75} />}
            onClick={() => setCollectionModal(true)}
          >
            Save as collection
          </Button>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconDownload size={15} stroke={1.75} />}
            onClick={() => downloadJson(basketManifest(items), 'reference-basket.json')}
          >
            Export manifest
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconTrash size={15} stroke={1.75} />}
            onClick={clear}
          >
            Clear
          </Button>
        </Stack>
      )}

      <Modal
        opened={collectionModal}
        onClose={() => setCollectionModal(false)}
        title="Save basket as collection"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="Collection name"
            value={collectionName}
            onChange={(e) => setCollectionName(e.currentTarget.value)}
            placeholder="e.g. Wanda — battle looks"
            data-autofocus
          />
          <Button
            disabled={!collectionName.trim()}
            loading={saveCollection.isPending}
            onClick={() => saveCollection.mutate()}
          >
            Save {items.length} reference{items.length === 1 ? '' : 's'}
          </Button>
        </Stack>
      </Modal>
    </aside>
  );
}
