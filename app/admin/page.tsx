"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Bracket, type BracketMatch } from "@/components/Bracket";
import { QRJoinCode } from "@/components/QRJoinCode";
import { CHANNELS } from "@/lib/realtime";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type SessionState = "lobby" | "grouping" | "bracket" | "finished";

interface Session {
  id: "current";
  state: SessionState;
  group_count: number | null;
  champion_group_id: string | null;
  match_duration_seconds: number;
}
interface Participant {
  id: string;
  nickname: string;
  group_id: string | null;
  joined_at: string;
}
interface Group {
  id: string;
  name: string;
  seed: number;
  eliminated: boolean;
}
type Match = BracketMatch;

const GROUP_OPTIONS = [2, 4, 8, 16] as const;
type GroupOption = (typeof GROUP_OPTIONS)[number];

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [groupCount, setGroupCount] = useState<GroupOption>(4);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dummyCount, setDummyCount] = useState("5");
  const [durationInput, setDurationInput] = useState("");
  const durationInitialized = useRef(false);

  // First time the session arrives, seed the minutes input from it.
  // Subsequent realtime updates should not trample what the admin is typing.
  useEffect(() => {
    if (session && !durationInitialized.current) {
      setDurationInput(String(Math.round(session.match_duration_seconds / 60)));
      durationInitialized.current = true;
    }
  }, [session]);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let mounted = true;

    async function refetch() {
      const [s, p, g, m] = await Promise.all([
        supabase.from("session").select("*").eq("id", "current").single(),
        supabase.from("participant").select("*").order("joined_at"),
        supabase.from("group").select("*").order("seed"),
        supabase.from("match").select("*").order("round").order("slot"),
      ]);
      if (!mounted) return;
      if (!s.error && s.data) setSession(s.data as Session);
      setParticipants((p.data ?? []) as Participant[]);
      setGroups((g.data ?? []) as Group[]);
      setMatches((m.data ?? []) as Match[]);
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
  }, []);

  const membersByGroup = useMemo(() => {
    const map = new Map<string, Participant[]>();
    for (const p of participants) {
      if (!p.group_id) continue;
      const list = map.get(p.group_id) ?? [];
      list.push(p);
      map.set(p.group_id, list);
    }
    return map;
  }, [participants]);

  // Waiting list = group-less participants once the session has moved past lobby.
  const waitlist = useMemo(() => {
    if (!session || session.state === "lobby") return [];
    return participants.filter((p) => p.group_id === null);
  }, [participants, session]);

  async function callAdmin(
    label: string,
    path: string,
    body?: unknown,
  ): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `${path} failed (${res.status}).`);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return (
      <main className="flex flex-1 items-center justify-center px-6">
        <p className="animate-pulse text-zinc-500">Loading command bridge…</p>
      </main>
    );
  }

  const inLobby = session.state === "lobby";
  const inGrouping = session.state === "grouping";
  const inBracket = session.state === "bracket" || session.state === "finished";
  const bracketExists = matches.length > 0;
  const groupsExist = groups.length > 0;
  const groupOptionDisabled = (n: GroupOption) => participants.length < n;

  async function callMatch(path: string, matchId: string, body?: unknown) {
    setBusyMatchId(matchId);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `${path} failed (${res.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusyMatchId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl tracking-tight">Command bridge</h1>
        <p className="text-xs uppercase tracking-widest text-zinc-400">
          State: <span className="font-mono text-saber-blue">{session.state}</span>
          {session.group_count != null && (
            <> · groups: {session.group_count}</>
          )}
        </p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-2">
        {(
          [
            { href: "/join", label: "Join" },
            { href: "/joined", label: "Joined" },
            { href: "/display", label: "Display" },
            { href: "/display/birthday", label: "Birthday" },
            { href: "/display/title", label: "Title" },
          ] as const
        ).map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="saber-outline-blue rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
          >
            {link.label} ↗
          </a>
        ))}
        <a
          href="/display/cruise"
          className="saber-outline-blue rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
        >
          Cruise Slide
        </a>
      </nav>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-saber-red/40 bg-saber-red/10 px-4 py-2 text-sm text-saber-red"
        >
          {error}
        </p>
      )}

      {/* Section 1: Lobby control */}
      <section className="mb-10 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-lg font-semibold">Lobby</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Pilots scan the QR to join.
        </p>

        <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-start">
          <QRJoinCode size={200} />
          <div className="flex-1">
            <p className="text-sm">
              <span className="text-2xl font-semibold">
                {participants.length}
              </span>{" "}
              joined
            </p>
            {participants.length > 0 && (
              <ul className="mt-3 max-h-64 space-y-0.5 overflow-y-auto text-sm">
                {participants.map((p) => (
                  <li key={p.id} className="font-mono">
                    {p.nickname}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={!inLobby || participants.length < 2 || busy !== null}
          onClick={() => callAdmin("start", "/api/admin/start-grouping")}
          className="saber-glow-blue mt-6 rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "start" ? "Starting…" : "Start session"}
        </button>

        <div className="mt-6 border-t border-imperial-gray/40 pt-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500">
            Dev: seed dummy pilots
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-zinc-500">Count</span>
              <input
                type="number"
                min={1}
                max={50}
                value={dummyCount}
                onChange={(e) => setDummyCount(e.target.value)}
                disabled={busy !== null}
                className="mt-1 w-24 rounded-md border border-saber-blue/40 bg-imperial-gray/50 px-3 py-1.5 text-zinc-100"
              />
            </label>
            <button
              type="button"
              disabled={
                busy !== null ||
                !Number.isInteger(Number(dummyCount)) ||
                Number(dummyCount) < 1 ||
                Number(dummyCount) > 50
              }
              onClick={() =>
                callAdmin("seed", "/api/admin/seed-participants", {
                  count: Number(dummyCount),
                })
              }
              className="saber-outline-blue rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "seed" ? "Seeding…" : "Generate dummies"}
            </button>
          </div>
        </div>
      </section>

      {/* Section 2: Group setup */}
      <section
        className={`mb-10 rounded-lg border p-5 ${
          inGrouping || inBracket
            ? "border-saber-blue/25"
            : "border-imperial-gray/40 opacity-60"
        }`}
      >
        <h2 className="text-lg font-semibold">Group setup</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Random squads, sizes within ±1.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-zinc-500">Groups</span>
            <select
              value={groupCount}
              onChange={(e) =>
                setGroupCount(Number(e.target.value) as GroupOption)
              }
              disabled={!inGrouping || bracketExists}
              className="mt-1 rounded-md border border-saber-blue/40 bg-imperial-gray/50 px-3 py-1.5 text-zinc-100"
            >
              {GROUP_OPTIONS.map((n) => (
                <option
                  key={n}
                  value={n}
                  disabled={groupOptionDisabled(n)}
                >
                  {n} {groupOptionDisabled(n) ? "(not enough pilots)" : ""}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={
              !inGrouping ||
              bracketExists ||
              groupOptionDisabled(groupCount) ||
              busy !== null
            }
            onClick={() =>
              callAdmin("assign", "/api/admin/generate-groups", { groupCount })
            }
            className="saber-glow-blue rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "assign"
              ? "Assigning…"
              : groupsExist
                ? "Reassign squads"
                : "Assign squads"}
          </button>
        </div>

        {groupsExist && (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {groups.map((g) => {
              const members = membersByGroup.get(g.id) ?? [];
              return (
                <li
                  key={g.id}
                  className="rounded-md border border-imperial-gray/60 bg-imperial-gray/30 p-3"
                >
                  <p className="flex items-baseline justify-between">
                    <span>
                      <span className="text-xs text-zinc-500">#{g.seed}</span>{" "}
                      <span className="text-saber-blue">{g.name}</span>
                    </span>
                    <span className="text-xs text-zinc-500">
                      {members.length} / 5
                    </span>
                  </p>
                  <ul className="mt-1 text-sm text-zinc-200">
                    {members.map((m) => (
                      <li key={m.id}>{m.nickname}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}

        {waitlist.length > 0 && (
          <div className="mt-6 rounded-md border border-tatooine-sand/40 bg-tatooine-sand/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-widest text-tatooine-sand">
                Waiting list ({waitlist.length})
              </p>
              <button
                type="button"
                disabled={
                  busy !== null ||
                  !groupsExist ||
                  !(inGrouping || inBracket)
                }
                onClick={() =>
                  callAdmin("assignWaitlist", "/api/admin/assign-waitlist")
                }
                className="saber-glow-blue rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "assignWaitlist"
                  ? "Assigning…"
                  : "Assign waiting list"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Fills eligible squads up to 5 each. Squads in a running or
              finished match are skipped.
              {inGrouping
                ? " Overflow mints new squads."
                : " Overflow stays on the waitlist."}
            </p>
            <ul className="mt-3 grid gap-x-4 gap-y-0.5 text-sm text-zinc-200 sm:grid-cols-2 lg:grid-cols-3">
              {waitlist.map((p) => (
                <li key={p.id} className="font-mono">
                  {p.nickname}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Section 3: Bracket */}
      <section
        className={`mb-10 rounded-lg border p-5 ${
          inGrouping || inBracket
            ? "border-saber-blue/25"
            : "border-imperial-gray/40 opacity-60"
        }`}
      >
        <h2 className="text-lg font-semibold">Bracket</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Single-elimination. Winners advance automatically.
        </p>

        {inGrouping && groupsExist && !bracketExists && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => callAdmin("bracket", "/api/admin/generate-bracket")}
            className="saber-glow-blue mt-4 rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:opacity-40"
          >
            {busy === "bracket" ? "Generating…" : "Generate bracket"}
          </button>
        )}

        {bracketExists && (
          <>
            {session.state === "finished" && session.champion_group_id && (
              <p className="mt-4 rounded-md border border-tatooine-sand/50 bg-tatooine-sand/10 px-3 py-2 text-sm text-tatooine-sand">
                🏆 Champion:{" "}
                <span className="font-semibold">
                  {groups.find((g) => g.id === session.champion_group_id)?.name}
                </span>
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-imperial-gray/50 bg-imperial-gray/20 p-3">
              <label className="text-sm">
                <span className="block text-zinc-500">
                  Minutes per match
                </span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  disabled={busy !== null}
                  className="mt-1 w-24 rounded-md border border-saber-blue/40 bg-imperial-gray/50 px-3 py-1.5 text-zinc-100"
                />
              </label>
              <button
                type="button"
                disabled={
                  busy !== null ||
                  !Number.isFinite(Number(durationInput)) ||
                  Number(durationInput) < 1 ||
                  Number(durationInput) > 60 ||
                  Math.round(Number(durationInput) * 60) ===
                    session.match_duration_seconds
                }
                onClick={() =>
                  callAdmin("duration", "/api/admin/timer-duration", {
                    seconds: Math.round(Number(durationInput) * 60),
                  })
                }
                className="saber-outline-blue rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "duration" ? "Saving…" : "Save duration"}
              </button>
              <p className="text-xs text-zinc-500">
                Current:{" "}
                <span className="font-mono text-zinc-300">
                  {Math.round(session.match_duration_seconds / 60)} min
                </span>{" "}
                · applies to matches started after save.
              </p>
            </div>

            <div className="mt-4">
              <Bracket
                mode="admin"
                groups={groups}
                matches={matches}
                championGroupId={session.champion_group_id}
                busyMatchId={busyMatchId}
                onDeclareWinner={(matchId, groupId) =>
                  callMatch(`/api/admin/match/${matchId}/winner`, matchId, {
                    groupId,
                  })
                }
                onUndoWinner={(matchId) =>
                  callMatch(`/api/admin/match/${matchId}/undo`, matchId)
                }
                onStartMatch={(matchId) =>
                  callMatch(`/api/admin/match/${matchId}/start`, matchId)
                }
                onCancelMatch={(matchId) =>
                  callMatch(`/api/admin/match/${matchId}/cancel`, matchId)
                }
              />
            </div>
          </>
        )}
      </section>

      {/* Section 4: Reset */}
      <section className="mb-4 rounded-lg border border-saber-red/40 p-5">
        <h2 className="text-lg text-saber-red">Reset</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Wipes participants, groups, and the bracket. Returns to lobby.
        </p>

        {confirmReset ? (
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                const ok = await callAdmin("reset", "/api/admin/reset");
                if (ok) setConfirmReset(false);
              }}
              className="saber-glow-red rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:opacity-40"
            >
              {busy === "reset" ? "Resetting…" : "Yes, reset everything"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              disabled={busy !== null}
              className="rounded-full border border-imperial-gray/60 px-5 py-2 text-xs uppercase tracking-widest"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="saber-outline-red mt-4 rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-widest"
          >
            Reset session
          </button>
        )}
      </section>
    </main>
  );
}
