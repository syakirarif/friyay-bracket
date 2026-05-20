"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { Bracket, type BracketGroup, type BracketMatch } from "@/components/Bracket";
import { QRJoinCode } from "@/components/QRJoinCode";
import { CHANNELS } from "@/lib/realtime";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type SessionState = "lobby" | "grouping" | "bracket" | "finished";

interface Session {
  id: "current";
  state: SessionState;
  champion_group_id: string | null;
}
interface Participant {
  id: string;
  nickname: string;
  group_id: string | null;
  joined_at: string;
}

interface LiveState {
  session: Session;
  participants: Participant[];
  groups: BracketGroup[];
  matches: BracketMatch[];
}

export default function DisplayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center text-zinc-500">
          Establishing comms…
        </div>
      }
    >
      <DisplayInner />
    </Suspense>
  );
}

function DisplayInner() {
  const params = useSearchParams();
  const demoMode = params.get("demo");

  const [live, setLive] = useState<LiveState | null>(null);

  // Demo data: build a synthetic snapshot for any of the four states.
  useEffect(() => {
    if (!demoMode) return;
    setLive(buildDemo(demoMode));
  }, [demoMode]);

  // Real data: REST fetch + Realtime, identical pattern to /joined and /admin.
  useEffect(() => {
    if (demoMode) return;
    const supabase = getSupabaseBrowser();
    let mounted = true;

    async function refetch() {
      const [s, p, g, m] = await Promise.all([
        supabase.from("session").select("*").eq("id", "current").single(),
        supabase.from("participant").select("*").order("joined_at"),
        supabase.from("group").select("*").order("seed"),
        supabase
          .from("match")
          .select("*")
          .order("round")
          .order("slot"),
      ]);
      if (!mounted || s.error || !s.data) return;
      setLive({
        session: s.data as Session,
        participants: (p.data ?? []) as Participant[],
        groups: (g.data ?? []) as BracketGroup[],
        matches: (m.data ?? []) as BracketMatch[],
      });
    }
    refetch();

    const channels = [
      supabase
        .channel(CHANNELS.session)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "session" },
          refetch,
        )
        .subscribe(),
      supabase
        .channel(CHANNELS.participants)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "participant" },
          refetch,
        )
        .subscribe(),
      supabase
        .channel(CHANNELS.bracket)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "group" },
          refetch,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "match" },
          refetch,
        )
        .subscribe(),
    ];

    return () => {
      mounted = false;
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [demoMode]);

  if (!live) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-zinc-500">
        Establishing comms…
      </div>
    );
  }

  switch (live.session.state) {
    case "lobby":
      return <LobbyView participants={live.participants} />;
    case "grouping":
      return (
        <GroupingView
          groups={live.groups}
          participants={live.participants}
        />
      );
    case "bracket":
    case "finished":
      return <BracketView live={live} />;
  }
}

// ---------- Lobby ----------

function LobbyView({ participants }: { participants: Participant[] }) {
  const recent = useMemo(
    () => [...participants].slice(-30),
    [participants],
  );
  const marqueeItems = recent.length > 0 ? [...recent, ...recent] : [];
  const animationSeconds = Math.max(20, recent.length * 2);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden px-8 text-zinc-100">
      <div className="crawl-in text-center">
        <h1 className="text-5xl tracking-tight sm:text-7xl">
          FriYAY May 2026 Game Bracket
        </h1>
        <p className="mt-4 text-2xl text-tatooine-sand sm:text-3xl">
          May the FriYAY be with You!
        </p>
      </div>

      <div className="my-10 rounded-xl bg-white p-6 shadow-[0_0_50px_-10px_rgba(76,184,255,0.55)]">
        <QRJoinCode size={420} />
      </div>

      <p className="text-3xl sm:text-4xl">
        <span className="font-semibold text-saber-blue">
          {participants.length}
        </span>{" "}
        {participants.length === 1 ? "rebel has" : "rebels have"} joined the
        resistance
      </p>

      {recent.length > 0 && (
        <div className="mt-8 w-full overflow-hidden">
          <div
            className="flex w-max gap-10 whitespace-nowrap text-2xl text-tatooine-sand/80"
            style={{
              animation: `marquee ${animationSeconds}s linear infinite`,
            }}
          >
            {marqueeItems.map((p, i) => (
              <span key={`${p.id}-${i}`}>{p.nickname}</span>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes marquee {
          from {
            transform: translateX(0%);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}

// ---------- Grouping ----------

function GroupingView({
  groups,
  participants,
}: {
  groups: BracketGroup[];
  participants: Participant[];
}) {
  const membersByGroup = useMemo(() => {
    const m = new Map<string, Participant[]>();
    for (const p of participants) {
      if (!p.group_id) continue;
      const list = m.get(p.group_id) ?? [];
      list.push(p);
      m.set(p.group_id, list);
    }
    return m;
  }, [participants]);

  if (groups.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center px-8 text-center text-zinc-100">
        <p className="animate-pulse text-5xl text-tatooine-sand">
          Squad assignments incoming…
        </p>
      </div>
    );
  }

  const cols = groups.length <= 4 ? "grid-cols-2" : "grid-cols-4";

  return (
    <div className="flex h-screen w-screen flex-col items-center overflow-hidden px-8 py-8 text-zinc-100">
      <h1 className="text-3xl tracking-tight sm:text-5xl">Squads assembled</h1>
      <p className="mt-1 text-lg text-tatooine-sand/80">
        May the FriYAY be with You!
      </p>

      <div className={`mt-6 grid w-full flex-1 gap-4 ${cols}`}>
        {groups.map((g) => {
          const members = membersByGroup.get(g.id) ?? [];
          return (
            <div
              key={g.id}
              className="rounded-lg border border-saber-blue/30 bg-imperial-gray/40 p-4"
            >
              <p className="flex items-baseline justify-between">
                <span className="text-2xl text-saber-blue">{g.name}</span>
                <span className="text-base text-zinc-500">#{g.seed}</span>
              </p>
              <ul className="mt-2 space-y-0.5 text-lg text-zinc-200">
                {members.map((m) => (
                  <li key={m.id}>{m.nickname}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Bracket / Finished ----------

function BracketView({ live }: { live: LiveState }) {
  const champion = live.session.champion_group_id
    ? live.groups.find((g) => g.id === live.session.champion_group_id)
    : null;
  const championMembers = champion
    ? live.participants.filter((p) => p.group_id === champion.id)
    : [];

  return (
    <div className="relative flex h-screen w-screen flex-col px-8 py-6 text-zinc-100">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl tracking-tight">FriYAY Bracket</h1>
        <p className="text-base text-tatooine-sand/80">
          May the FriYAY be with You!
        </p>
      </header>

      <div className="mt-6 flex-1 overflow-hidden">
        <Bracket
          mode="display"
          groups={live.groups}
          matches={live.matches}
          championGroupId={live.session.champion_group_id}
        />
      </div>

      {live.session.state === "finished" && champion && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#03050d]/90 px-8 text-center">
          <p className="text-2xl uppercase tracking-widest text-tatooine-sand">
            Champion
          </p>
          <p
            className="mt-4 text-7xl sm:text-8xl"
            style={{
              textShadow:
                "0 0 24px rgba(193, 168, 117, 0.55), 0 0 60px rgba(193, 168, 117, 0.25)",
            }}
          >
            🏆 {champion.name}
          </p>
          {championMembers.length > 0 && (
            <ul className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2 text-2xl text-zinc-200">
              {championMembers.map((m) => (
                <li key={m.id}>{m.nickname}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Demo data ----------

function buildDemo(mode: string): LiveState {
  const state: SessionState = (() => {
    switch (mode) {
      case "lobby":
      case "grouping":
      case "bracket":
      case "finished":
        return mode;
      default:
        return "finished";
    }
  })();

  const baseParticipants: Participant[] = [
    "Luke",
    "Leia",
    "Han",
    "Chewbacca",
    "Rey",
    "Finn",
    "Poe",
    "BB-8",
    "Obi-Wan",
    "Yoda",
    "Mace",
    "Ahsoka",
  ].map((n, i) => ({
    id: `p${i}`,
    nickname: n,
    group_id: null,
    joined_at: new Date(2026, 4, 20, 18, 0, i).toISOString(),
  }));

  if (state === "lobby") {
    return {
      session: { id: "current", state, champion_group_id: null },
      participants: baseParticipants.slice(0, 7),
      groups: [],
      matches: [],
    };
  }

  const groups: BracketGroup[] = [
    { id: "g1", name: "Rebel Alliance", seed: 1, eliminated: false },
    { id: "g2", name: "Galactic Empire", seed: 2, eliminated: false },
    { id: "g3", name: "Jedi Order", seed: 3, eliminated: false },
    { id: "g4", name: "Sith Order", seed: 4, eliminated: false },
  ];
  const participants = baseParticipants.map((p, i) => ({
    ...p,
    group_id: groups[i % 4].id,
  }));

  if (state === "grouping") {
    return {
      session: { id: "current", state, champion_group_id: null },
      participants,
      groups,
      matches: [],
    };
  }

  // Bracket: 4 groups → 3 matches.
  const finalId = "m-final";
  const r1a: BracketMatch = {
    id: "m-r1a",
    round: 1,
    slot: 0,
    group_a_id: "g1",
    group_b_id: "g4",
    winner_group_id: state === "finished" ? "g1" : "g1",
    next_match_id: finalId,
  };
  const r1b: BracketMatch = {
    id: "m-r1b",
    round: 1,
    slot: 1,
    group_a_id: "g2",
    group_b_id: "g3",
    winner_group_id: state === "finished" ? "g2" : "g2",
    next_match_id: finalId,
  };
  const finalMatch: BracketMatch = {
    id: finalId,
    round: 2,
    slot: 0,
    group_a_id: "g1",
    group_b_id: "g2",
    winner_group_id: state === "finished" ? "g1" : null,
    next_match_id: null,
  };
  const matches = [r1a, r1b, finalMatch];

  const withElim = groups.map((g) => ({
    ...g,
    eliminated:
      g.id === "g3" ||
      g.id === "g4" ||
      (state === "finished" && g.id === "g2"),
  }));

  return {
    session: {
      id: "current",
      state,
      champion_group_id: state === "finished" ? "g1" : null,
    },
    participants,
    groups: withElim,
    matches,
  };
}
