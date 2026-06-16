import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Badge, Button, Modal, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlus, IconLayoutGrid, IconSparkles } from '@tabler/icons-react';
import {
  PROJECT_STATUSES,
  createProject,
  listProjects,
  type ProjectStatus,
} from '../../api/projects';

const STATUS_COLOR: Record<ProjectStatus, string> = {
  active: 'green',
  wip: 'yellow',
  archived: 'gray',
};

export function ProjectsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string | null>('active');

  const projects = useQuery({ queryKey: ['projects'], queryFn: listProjects });

  const create = useMutation({
    mutationFn: () =>
      createProject(name, { description, status: (status as ProjectStatus) ?? 'active' }),
    onSuccess: (project) => {
      setModal(false);
      setName('');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/p/${project.code}`);
    },
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background)',
      }}
    >
      <header className="search-header">
        <div className="search-toolbar">
          <span className="brand-mark" style={{ width: '1.6rem', height: '1.6rem' }}>
            <IconSparkles size={16} stroke={1.75} />
          </span>
          <Text fw={650}>
            Nexus <span className="brand-name-accent">Reference</span>
          </Text>
          <Text size="xs" c="dimmed">
            · {projects.data?.length ?? 0} project{(projects.data?.length ?? 0) === 1 ? '' : 's'}
          </Text>
          <Button
            size="xs"
            leftSection={<IconPlus size={15} stroke={1.75} />}
            onClick={() => setModal(true)}
            style={{ marginLeft: 'auto' }}
          >
            New project
          </Button>
        </div>
      </header>
      <div style={{ padding: '1.5rem 1.25rem 0.5rem' }}>
        <Text fw={680} size="xl">
          Select a project
        </Text>
        <Text size="sm" c="dimmed">
          Open a project to work in its scoped library, entities, boards, and collections.
        </Text>
      </div>

      {projects.data?.length === 0 ? (
        <div className="empty-state">
          <IconLayoutGrid size={36} stroke={1.4} />
          <p style={{ maxWidth: 440, margin: 0 }}>
            No projects yet. Create a project to organize its entities and assets, then open it to
            see the landing dashboard.
          </p>
        </div>
      ) : (
        <div className="entity-grid">
          {projects.data?.map((project) => (
            <div
              key={project.id}
              className="entity-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/p/${project.code}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/p/${project.code}`)}
              style={{ cursor: 'pointer' }}
            >
              {project.cover_thumb ? (
                <img src={project.cover_thumb} alt="" loading="lazy" />
              ) : (
                <div style={{ aspectRatio: '4/3', background: 'var(--muted)' }} />
              )}
              <div className="entity-card-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text size="sm" fw={550} truncate style={{ flex: 1 }}>
                    {project.name}
                  </Text>
                  <Badge size="xs" color={STATUS_COLOR[project.status] ?? 'gray'} variant="light">
                    {project.status}
                  </Badge>
                </div>
                <Text size="xs" c="dimmed">
                  {project.entity_count ?? 0} entities · {project.asset_count ?? 0} assets
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal opened={modal} onClose={() => setModal(false)} title="New project" size="sm">
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Crimson Tide S2"
            data-autofocus
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="Optional"
            autosize
            minRows={2}
          />
          <Select label="Status" value={status} onChange={setStatus} data={[...PROJECT_STATUSES]} />
          <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </Stack>
      </Modal>
    </div>
  );
}
