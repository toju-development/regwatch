import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RegWatch — coming soon',
  description: 'RegWatch landing',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
