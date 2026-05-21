import Link from "next/link";

export const dynamic = "force-static";

export default function TitleDisplayPage() {
  return (
    <div className="relative flex min-h-screen w-screen flex-col items-center justify-center px-10 py-12 text-center text-zinc-100">
      <Link
        href="/display"
        className="saber-outline-blue absolute right-10 top-8 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
      >
        ← Bracket
      </Link>

      <div className="crawl-in">
        <h1 className="text-6xl tracking-tight sm:text-8xl">FriYAY May 2026</h1>
        <p className="mt-4 text-2xl text-tatooine-sand sm:text-4xl">
          May the FriYAY be with You!
        </p>

        <div className="mt-16 space-y-2 text-xl text-zinc-300 sm:text-2xl">
          <p className="text-saber-blue">May 22, 2026</p>
          <p>Pantry 10th floor — ATC Semarang</p>
          <p className="text-tatooine-sand/80">ATC Indonesia Community</p>
        </div>
      </div>
    </div>
  );
}
