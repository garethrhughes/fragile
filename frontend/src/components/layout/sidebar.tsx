'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Target, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'DORA Dashboard', href: '/dora', icon: <BarChart3 className="h-5 w-5" /> },
  { label: 'Planning', href: '/planning', icon: <Target className="h-5 w-5" /> },
  { label: 'Settings', href: '/settings', icon: <Settings className="h-5 w-5" /> },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col bg-sidebar text-white">
      {/* Brand */}
      <div className="flex items-center gap-2 px-5 py-6">
        <BarChart3 className="h-7 w-7 text-blue-400" />
        <span className="text-lg font-bold tracking-tight">DORA Metrics</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 text-xs text-gray-500">
        v0.1.0
      </div>
    </aside>
  );
}
