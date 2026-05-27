import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Visa',
  description: 'EU Blue Card to Germany — case management',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
