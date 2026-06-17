import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  IconSearch,
  IconFolders,
  IconLayoutBoard,
  IconLayoutDashboard,
  IconUsers,
  IconClock,
  IconHeart,
  IconSparkles,
  IconChevronDown,
  IconLayoutGrid,
} from '@tabler/icons-react';
import { Menu, Text } from '@mantine/core';
import clsx from 'clsx';
import { BasketRail } from './BasketRail';
import { FloatingViewerLayer } from '../features/viewer/FloatingViewerLayer';
import { useProject } from '../features/projects/ProjectContext';

// Workspace nav. Hrefs are relative to the /p/:code base (nested routing).
const NAV_ITEMS = [
  { href: '/', label: 'Search', icon: IconSearch },
  { href: '/overview', label: 'Overview', icon: IconLayoutDashboard },
  { href: '/collections', label: 'Collections', icon: IconFolders },
  { href: '/boards', label: 'Boards', icon: IconLayoutBoard },
  { href: '/entities', label: 'Entities', icon: IconUsers },
];

const LIBRARY_ITEMS = [
  { href: '/recent', label: 'Recent', icon: IconClock },
  { href: '/favorites', label: 'Favorites', icon: IconHeart },
];

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof IconSearch;
}) {
  const [location] = useLocation();
  const active = location === href;
  return (
    <Link href={href} className={clsx('nav-link', active && 'active')}>
      <Icon size={17} stroke={1.75} />
      {label}
    </Link>
  );
}

// Relative path's first segment -> section label for the breadcrumb.
const SECTION_LABELS: Record<string, string> = {
  '': 'Search',
  overview: 'Overview',
  collections: 'Collections',
  boards: 'Boards',
  entities: 'Entities',
  graph: 'Graph',
  favorites: 'Favorites',
  recent: 'Recent',
};

function Breadcrumb() {
  const [location] = useLocation();
  const { project, code } = useProject();
  const segment = location.split('/')[1] ?? '';
  const section = SECTION_LABELS[segment] ?? 'Search';
  return (
    <div className="workspace-crumbs">
      <Link href="~/" className="crumb">
        All projects
      </Link>
      <span className="crumb-sep">/</span>
      <Link href="/overview" className="crumb">
        {project?.name ?? code}
      </Link>
      <span className="crumb-sep">/</span>
      <span className="crumb current">{section}</span>
    </div>
  );
}

function ProjectSwitcher() {
  const { code, project, projects } = useProject();
  const label = project?.name ?? code;
  return (
    <Menu position="bottom-start" width={240} withinPortal>
      <Menu.Target>
        <button type="button" className="project-switcher">
          <span className="project-switcher-mark">
            <IconLayoutGrid size={15} stroke={1.75} />
          </span>
          <Text size="sm" fw={600} truncate style={{ flex: 1, textAlign: 'left' }}>
            {label}
          </Text>
          <IconChevronDown size={14} stroke={2} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Switch project</Menu.Label>
        {projects.map((p) => (
          <Menu.Item
            key={p.code}
            component={Link}
            href={`~/p/${p.code}`}
            fw={p.code === code ? 700 : 400}
          >
            {p.name}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item component={Link} href="~/" leftSection={<IconLayoutGrid size={14} />}>
          All projects
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link href="~/" className="brand-lockup">
          <span className="brand-mark">
            <IconSparkles size={18} stroke={1.75} />
          </span>
          <span className="brand-name">
            Nexus <span className="brand-name-accent">Reference</span>
          </span>
        </Link>
        <ProjectSwitcher />
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
        <div className="nav-section-label">Library</div>
        {LIBRARY_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>
      <main className="app-main">
        <Breadcrumb />
        <div className="app-content">{children}</div>
      </main>
      <BasketRail />
      <FloatingViewerLayer />
    </div>
  );
}
