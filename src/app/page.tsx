export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-4">
      <h1 className="text-3xl font-semibold">Relomate</h1>
      <p className="text-zinc-600 max-w-md text-center">
        Build a complete EU Blue Card to Germany application — guided by an agent, reviewed by you.
      </p>
      <form action="/api/case/new" method="post">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Start a case
        </button>
      </form>
    </main>
  );
}
