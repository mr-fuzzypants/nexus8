import { IconLayoutDashboard } from '@tabler/icons-react';

export function StubPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="empty-state">
      <IconLayoutDashboard size={36} stroke={1.4} />
      <h2 style={{ margin: 0, color: 'var(--foreground)' }}>{title}</h2>
      <p style={{ maxWidth: 420, margin: 0 }}>{note}</p>
    </div>
  );
}
