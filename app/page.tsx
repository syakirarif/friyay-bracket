export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="crawl-in">
        <h1 className="text-4xl tracking-tight sm:text-6xl">
          FriYAY May 2026 Game Bracket
        </h1>
        <p className="mt-4 text-lg text-tatooine-sand/90 sm:text-xl">
          May the FriYAY be with You!
        </p>
      </div>

      <nav className="mt-12 flex flex-col gap-3 sm:flex-row">
        <a
          href="/join"
          className="saber-glow-blue rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-widest"
        >
          Join the squad
        </a>
        <a
          href="/display"
          className="saber-outline-blue rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-widest"
        >
          Display
        </a>
        <a
          href="/admin"
          className="saber-outline-blue rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-widest"
        >
          Admin
        </a>
      </nav>
    </main>
  );
}
