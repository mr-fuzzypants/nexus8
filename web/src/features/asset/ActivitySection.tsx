import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Group, Loader, Text, TextInput } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import {
  addComment,
  createDiscussion,
  getAssetDiscussions,
  getComments,
  type CommentNode,
} from '../../api/versions';
import type { AssetSummary } from '../../api/library';

function CommentItem({ comment, depth = 0 }: { comment: CommentNode; depth?: number }) {
  return (
    <div className="comment-item" style={{ marginLeft: depth * 16 }}>
      <Text size="xs">
        <strong>{comment.author}</strong>{' '}
        <span className="text-muted">{new Date(comment.created_at).toLocaleString()}</span>
      </Text>
      <Text size="sm">{comment.content}</Text>
      {comment.replies?.map((reply) => (
        <CommentItem key={reply.id} comment={reply} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ActivitySection({ asset }: { asset: AssetSummary }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const discussions = useQuery({
    queryKey: ['discussions', asset.id],
    queryFn: () => getAssetDiscussions(asset.id),
  });
  const discussion = discussions.data?.[0];

  const comments = useQuery({
    queryKey: ['comments', discussion?.id],
    queryFn: () => getComments(discussion!.id),
    enabled: Boolean(discussion),
  });

  const send = useMutation({
    mutationFn: async () => {
      let target = discussion;
      if (!target) {
        target = await createDiscussion(asset.id, `Review: ${asset.name}`);
      }
      return addComment(target.id, draft);
    },
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['discussions', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });

  return (
    <section>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Activity
        </Text>
        {(discussions.isFetching || comments.isFetching) && <Loader size={14} />}
      </Group>

      {(comments.data?.length ?? 0) === 0 && (
        <Text size="xs" c="dimmed" mb={6}>
          No comments yet — start the review below.
        </Text>
      )}
      <div className="comment-list">
        {comments.data?.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </div>

      <Group gap={6} mt={8}>
        <TextInput
          size="xs"
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) send.mutate();
          }}
          style={{ flex: 1 }}
          aria-label="Add a comment"
        />
        <ActionIcon
          variant="light"
          aria-label="Send comment"
          disabled={!draft.trim()}
          loading={send.isPending}
          onClick={() => send.mutate()}
        >
          <IconSend size={15} stroke={1.75} />
        </ActionIcon>
      </Group>
    </section>
  );
}
