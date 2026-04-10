import type { Metadata } from 'next';
import './globals.css';
import { ClientShell } from '@/components/layout/client-shell';

export const metadata: Metadata = {
  title: 'DORA Metrics Dashboard',
  description: 'Jira DORA & Planning Metrics Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
