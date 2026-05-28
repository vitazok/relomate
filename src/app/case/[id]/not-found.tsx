import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div>
        <h1 className="text-2xl font-semibold">Case not found</h1>
        <p className="mt-2 text-zinc-600">
          <Link href="/" className="underline">Start a new case</Link>
        </p>
      </div>
    </main>
  );
}
