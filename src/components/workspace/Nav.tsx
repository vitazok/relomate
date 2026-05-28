import Link from 'next/link';

const SECTIONS = [
  { href: '#overview', label: 'Overview', active: true },
  { href: '#profile', label: 'Profile', active: false },
  { href: '#documents', label: 'Documents', active: false },
  { href: '#drafts', label: 'Drafts', active: false },
  { href: '#forms', label: 'Forms', active: false },
  { href: '#timeline', label: 'Timeline', active: false },
  { href: '#tasks', label: 'Tasks', active: false },
  { href: '#activity', label: 'Activity', active: false },
];

export function Nav() {
  return (
    <nav className="flex flex-col gap-1 border-r border-zinc-200 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Case</h2>
      {SECTIONS.map((s) => (
        s.active ? (
          <Link key={s.href} href={s.href} className="rounded px-2 py-1 text-sm font-medium bg-zinc-100">
            {s.label}
          </Link>
        ) : (
          <span key={s.href} className="rounded px-2 py-1 text-sm text-zinc-400 cursor-not-allowed" title="Coming soon">
            {s.label}
          </span>
        )
      ))}
    </nav>
  );
}
