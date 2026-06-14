import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button, Text } from '@mantine/core';
import { IconLayoutBoard, IconPlus } from '@tabler/icons-react';
import { createBoard, listBoards } from '../../api/boards';

export function BoardsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const boards = useQuery({ queryKey: ['boards'], queryFn: listBoards });

  const newBoard = useMutation({
    mutationFn: () => createBoard('Untitled board'),
    onSuccess: (board) => {
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      navigate(`/boards/${board.id}`);
    },
  });

  return (
    <>
      <header className="search-header">
        <div className="search-toolbar">
          <Text fw={600}>Boards</Text>
          <Text size="xs" c="dimmed">
            {boards.data?.length ?? 0} board{boards.data?.length === 1 ? '' : 's'}
          </Text>
          <Button
            size="xs"
            leftSection={<IconPlus size={15} stroke={1.75} />}
            loading={newBoard.isPending}
            onClick={() => newBoard.mutate()}
            style={{ marginLeft: 'auto' }}
          >
            New board
          </Button>
        </div>
      </header>

      {boards.data?.length === 0 ? (
        <div className="empty-state">
          <IconLayoutBoard size={36} stroke={1.4} />
          <p style={{ maxWidth: 420, margin: 0 }}>
            No boards yet. Collect references into the basket and hit “Create board”, or start a
            blank one.
          </p>
        </div>
      ) : (
        <div className="boards-grid">
          {boards.data?.map((board) => (
            <div
              key={board.id}
              className="board-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/boards/${board.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/boards/${board.id}`)}
            >
              <div className="board-card-thumbs">
                {(board.preview_thumbs ?? []).slice(0, 4).map((src, i) => (
                  <img key={i} src={src} alt="" loading="lazy" />
                ))}
              </div>
              <div className="board-card-body">
                <Text size="sm" fw={550} truncate>
                  {board.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {board.item_count} item{board.item_count === 1 ? '' : 's'} · updated{' '}
                  {new Date(board.updated_at).toLocaleDateString()}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
