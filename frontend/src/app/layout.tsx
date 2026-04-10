import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Starter',
  description: 'Full-stack TypeScript starter project',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
