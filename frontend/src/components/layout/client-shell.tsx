'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/components/layout/auth-gate';
import { Sidebar } from '@/components/layout/sidebar';
import { SyncStatus } from '@/components/layout/sync-status';

interface ClientShellProps {
  children: ReactNode;
}

export function ClientShell({ children }: ClientShellProps) {
  return (
    <AuthGate>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <SyncStatus />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </AuthGate>
  );
}
