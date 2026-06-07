import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Relomate',
  description: 'EU Blue Card to Germany — case management',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="font-sans">
      <body>{children}</body>
    </html>
  );
}
