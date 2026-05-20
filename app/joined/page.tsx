"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
}
interface Group {
  id: string;
  name: string;
  eliminated: boolean;
}
interface Match {
  id: string;
  round: number;
  group_a_id: string | null;
  group_b_id: string | null;
  winner_group_id: string | null;
}
interface Stored {
  id: string;
  nickname: string;
}

export default function JoinedPage() {
  const router = useRouter();
  const [stored, setStored] = useState<Stored | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  // Restore identity from localStorage.
  useEffect(() => {
    const raw = localStorage.getItem("participant");
    if (!raw) {
      router.replace("/join");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Stored;
      if (!parsed?.id) {
        router.replace("/join");
        return;
      }
      setStored(parsed);
    } catch {
      router.replace("/join");
    }
  }, [router]);

  // Fetch + subscribe once we know who we are.
  useEffect(() => {
    if (!stored) return;
    const supabase = getSupabaseBrowser();
    let mounted = true;

    async function refetch() {
      const [sessionRes, partsRes, groupsRes, matchesRes] = await Promise.all([
        supabase.from("session").select("*").eq("id", "current").single(),
        supabase.from("participant").select("*"),
        supabase.from("group").select("*").order("seed", { ascending: true }),
        supabase
          .from("match")
          .select("*")
          .order("round", { ascending: true })
          .order("slot", { ascending: true }),
      ]);
      if (!mounted) return;

      if (!sessionRes.error && sessionRes.data) {
        setSession(sessionRes.data as Session);
      }
      const parts = (partsRes.data ?? []) as Participant[];
      setAllParticipants(parts);
      setGroups((groupsRes.data ?? []) as Group[]);
      setMatches((matchesRes.data ?? []) as Match[]);

      const me = parts.find((p) => p.id === stored!.id) ?? null;
      if (!me) {
        // Their row got wiped (e.g. admin reset). Bounce to /join.
        localStorage.removeItem("participant");
        router.replace("/join");
        return;
      }
      setParticipant(me);
      setBootstrapped(true);
    }

    refetch();

    const sessionCh = supabase
      .channel(CHANNELS.session)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session" },
        refetch,
      )
      .subscribe();
    const partsCh = supabase
      .channel(CHANNELS.participants)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participant" },
        refetch,
      )
      .subscribe();
    const bracketCh = supabase
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
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(sessionCh);
      supabase.removeChannel(partsCh);
      supabase.removeChannel(bracketCh);
    };
  }, [stored, router]);

  const myGroup = useMemo(
    () =>
      participant?.group_id
        ? (groups.find((g) => g.id === participant.group_id) ?? null)
        : null,
    [participant, groups],
  );
  const squadMates = useMemo(
    () =>
      participant?.group_id
        ? allParticipants.filter(
            (p) =>
              p.group_id === participant.group_id && p.id !== participant.id,
          )
        : [],
    [participant, allParticipants],
  );
  const currentMatch = useMemo(() => {
    if (!myGroup) return null;
    return (
      matches.find(
        (m) =>
          (m.group_a_id === myGroup.id || m.group_b_id === myGroup.id) &&
          m.winner_group_id === null,
      ) ?? null
    );
  }, [matches, myGroup]);

  if (!stored || !bootstrapped || !session || !participant) {
    return (
      <main className="flex flex-1 items-center justify-center px-6">
        <p className="text-zinc-500">Establishing comms…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-6 py-12 text-center">
      <p className="text-xs uppercase tracking-widest text-zinc-400">
        Call sign
      </p>
      <h1 className="mt-1 text-3xl tracking-tight">
        {participant.nickname}
      </h1>

      {session.state === "lobby" && (
        <p className="mt-8 text-lg text-tatooine-sand/90">
          You are joined — awaiting transmission from command…
        </p>
      )}

      {session.state === "grouping" && !myGroup && (
        <p className="mt-8 animate-pulse text-lg text-tatooine-sand/90">
          Squads are being assigned. Stand by.
        </p>
      )}

      {myGroup && (
        <section className="mt-8 w-full rounded-lg border border-saber-blue/30 bg-imperial-gray/30 p-5">
          <p className="text-xs uppercase tracking-widest text-zinc-400">
            Squad
          </p>
          <h2 className="mt-1 text-2xl text-saber-blue">{myGroup.name}</h2>

          {squadMates.length > 0 && (
            <ul className="mt-4 space-y-1 text-zinc-200">
              {squadMates.map((m) => (
                <li key={m.id}>{m.nickname}</li>
              ))}
            </ul>
          )}

          {session.state === "bracket" && (
            <p className="mt-6 text-base">
              {session.champion_group_id === myGroup.id ? (
                <span className="text-tatooine-sand">
                  You hold the line — still in the fight.
                </span>
              ) : myGroup.eliminated ? (
                <span className="text-saber-red">
                  Your squad has fallen. Stay tuned for the finals.
                </span>
              ) : currentMatch ? (
                <span className="text-saber-blue">
                  Round {currentMatch.round} — awaiting the call.
                </span>
              ) : (
                <span className="text-saber-green">
                  Advancing. Awaiting next opponent.
                </span>
              )}
            </p>
          )}

          {session.state === "finished" && (
            <p className="mt-6 text-lg">
              {session.champion_group_id === myGroup.id ? (
                <span className="text-tatooine-sand">
                  🏆 Champions of the FriYAY!
                </span>
              ) : (
                <span className="text-zinc-400">
                  Mission complete. Better luck next FriYAY.
                </span>
              )}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
