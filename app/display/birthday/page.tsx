import Link from "next/link";

import { MAY_BIRTHDAYS } from "@/lib/birthdays";

export const dynamic = "force-static";

export default function BirthdayDisplayPage() {
  // Group entries by date while preserving the source order.
  const groups: Array<{ date: string; names: string[] }> = [];
  for (const entry of MAY_BIRTHDAYS) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) {
      last.names.push(entry.name);
    } else {
      groups.push({ date: entry.date, names: [entry.name] });
    }
  }

  return (
    <div className="relative min-h-screen w-screen px-10 py-8 text-zinc-100">
      <Link
        href="/display"
        className="saber-outline-blue absolute right-10 top-8 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
      >
        ← Bracket
      </Link>

      <header className="text-center">
        <p className="text-2xl tracking-[0.4em] text-tatooine-sand/80">
          🎂 MAY BIRTHDAYS
        </p>
        <h1 className="mt-2 text-5xl tracking-tight sm:text-6xl">
          FriYAY May 2026
        </h1>
        <p className="mt-2 text-xl text-tatooine-sand/80">
          May the FriYAY be with You!
        </p>
      </header>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groups.map((g) => (
          <article
            key={g.date}
            className="rounded-xl border border-saber-blue/30 bg-imperial-gray/30 p-5 shadow-[0_0_24px_-12px_rgba(76,184,255,0.45)]"
          >
            <p className="font-mono text-3xl font-semibold text-saber-blue">
              {g.date}
            </p>
            <ul className="mt-3 space-y-1 text-lg text-zinc-100">
              {g.names.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
