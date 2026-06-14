import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  IconSearch,
  IconFolders,
  IconLayoutBoard,
  IconUsers,
  IconClock,
  IconHeart,
  IconSparkles,
} from '@tabler/icons-react';
import clsx from 'clsx';
import { BasketRail } from './BasketRail';

const NAV_ITEMS = [
  { href: '/', label: 'Search', icon: IconSearch },
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

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link href="/" className="brand-lockup">
          <span className="brand-mark">
            <IconSparkles size={18} stroke={1.75} />
          </span>
          <span className="brand-name">
            Nexus <span className="brand-name-accent">Reference</span>
          </span>
        </Link>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
        <div className="nav-section-label">Library</div>
        {LIBRARY_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>
      <main className="app-main">{children}</main>
      <BasketRail />
    </div>
  );
}
