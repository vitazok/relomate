import Link from 'next/link';

const SECTIONS = [
  { href: '#tracker', label: 'Tracker', active: true, enabled: true },
  { href: '#profile', label: 'Profile', active: false, enabled: false },
  { href: '#documents', label: 'Documents', active: false, enabled: false },
  { href: '#drafts', label: 'Drafts', active: false, enabled: false },
  { href: '#forms', label: 'Forms', active: false, enabled: true },
  { href: '#timeline', label: 'Timeline', active: false, enabled: false },
  { href: '#tasks', label: 'Tasks', active: false, enabled: false },
  { href: '#activity', label: 'Activity', active: false, enabled: false },
];

export function Nav() {
  return (
    <nav className="flex flex-col gap-1 border-r border-zinc-200 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Case</h2>
      {SECTIONS.map((s) => (
        s.enabled ? (
          <Link
            key={s.href}
            href={s.href}
            className={`rounded px-2 py-1 text-sm ${
              s.active ? 'bg-zinc-100 font-medium text-zinc-950' : 'text-zinc-700 hover:bg-zinc-50'
            }`}
          >
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
