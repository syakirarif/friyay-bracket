"use client";

import { useEffect, useMemo, useState } from "react";

export interface BracketGroup {
  id: string;
  name: string;
  seed: number;
  eliminated: boolean;
}

export interface BracketMatch {
  id: string;
  round: number;
  slot: number;
  group_a_id: string | null;
  group_b_id: string | null;
  winner_group_id: string | null;
  next_match_id: string | null;
  started_at: string | null;
  duration_seconds: number | null;
}

interface CommonProps {
  groups: BracketGroup[];
  matches: BracketMatch[];
  championGroupId?: string | null;
  membersByGroup?: Map<string, { nickname: string }[]>;
}

interface AdminProps extends CommonProps {
  mode: "admin";
  busyMatchId?: string | null;
  onDeclareWinner: (matchId: string, groupId: string) => void | Promise<void>;
  onUndoWinner: (matchId: string) => void | Promise<void>;
  onStartMatch: (matchId: string) => void | Promise<void>;
  onCancelMatch: (matchId: string) => void | Promise<void>;
}

interface DisplayProps extends CommonProps {
  mode: "display";
  highlightGroupId?: string | null;
}

type Props = AdminProps | DisplayProps;

export function Bracket(props: Props) {
  const { groups, matches, championGroupId } = props;
  const large = props.mode === "display";

  const groupById = useMemo(() => {
    const m = new Map<string, BracketGroup>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  const byRound = useMemo(() => {
    const m = new Map<number, BracketMatch[]>();
    for (const match of matches) {
      const list = m.get(match.round) ?? [];
      list.push(match);
      m.set(match.round, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.slot - b.slot);
    }
    return m;
  }, [matches]);

  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No bracket yet. Generate one once squads are assigned.
      </p>
    );
  }

  return (
    <div
      className={`flex overflow-x-auto pb-2 ${large ? "gap-10" : "gap-6"}`}
    >
      {rounds.map((round) => {
        const list = byRound.get(round) ?? [];
        const label =
          round === rounds[rounds.length - 1]
            ? "Final"
            : round === rounds[rounds.length - 2]
              ? "Semifinal"
              : `Round ${round}`;
        return (
          <div
            key={round}
            className={`flex flex-col ${large ? "min-w-[24rem] gap-6" : "min-w-[16rem] gap-3"}`}
            style={{ justifyContent: "space-around" }}
          >
            <p
              className={`uppercase tracking-widest text-saber-blue/80 ${large ? "text-lg" : "text-xs"}`}
            >
              {label}
            </p>
            {list.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                groupById={groupById}
                championGroupId={championGroupId ?? null}
                membersByGroup={props.membersByGroup}
                large={large}
                props={props}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MatchCard({
  match,
  groupById,
  championGroupId,
  membersByGroup,
  large,
  props,
}: {
  match: BracketMatch;
  groupById: Map<string, BracketGroup>;
  championGroupId: string | null;
  membersByGroup: Map<string, { nickname: string }[]> | undefined;
  large: boolean;
  props: Props;
}) {
  const a = match.group_a_id ? groupById.get(match.group_a_id) : null;
  const b = match.group_b_id ? groupById.get(match.group_b_id) : null;
  const decided = match.winner_group_id !== null;
  const inProgress = !decided && match.started_at !== null;
  const isFinal = match.next_match_id === null;
  const isChampionFinal =
    isFinal && decided && championGroupId === match.winner_group_id;

  return (
    <div
      className={`rounded-md border transition ${large ? "p-5 text-lg" : "p-3 text-sm"} ${
        isChampionFinal
          ? "border-tatooine-sand/60 bg-tatooine-sand/10 shadow-[0_0_24px_-6px_rgba(193,168,117,0.6)]"
          : inProgress
            ? "border-saber-blue bg-saber-blue/10 shadow-[0_0_28px_-4px_rgba(76,184,255,0.7)]"
            : decided
              ? "border-saber-blue/35 bg-imperial-gray/30"
              : "border-imperial-gray/60 bg-imperial-gray/20"
      }`}
    >
      <Side
        group={a}
        isWinner={decided && match.winner_group_id === match.group_a_id}
        isHighlight={
          props.mode === "display" &&
          props.highlightGroupId === (a?.id ?? null)
        }
        members={a ? membersByGroup?.get(a.id) : undefined}
        large={large}
        side="a"
      />
      <p
        className={`text-center uppercase tracking-widest text-saber-red/70 ${
          large ? "my-2 text-sm" : "my-1 text-[10px]"
        }`}
      >
        vs
      </p>
      <Side
        group={b}
        isWinner={decided && match.winner_group_id === match.group_b_id}
        isHighlight={
          props.mode === "display" &&
          props.highlightGroupId === (b?.id ?? null)
        }
        members={b ? membersByGroup?.get(b.id) : undefined}
        large={large}
        side="b"
      />

      {props.mode === "admin" && (
        <div className="mt-3 space-y-2">
          {inProgress && (
            <InlineCountdown
              startedAt={match.started_at!}
              durationSeconds={match.duration_seconds ?? 0}
            />
          )}
          {!decided && a && b && (
            <div className="flex flex-wrap gap-2">
              {!inProgress ? (
                <button
                  type="button"
                  disabled={props.busyMatchId === match.id}
                  onClick={() => props.onStartMatch(match.id)}
                  className="saber-glow-blue rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest disabled:opacity-40"
                >
                  Start match
                </button>
              ) : (
                <button
                  type="button"
                  disabled={props.busyMatchId === match.id}
                  onClick={() => props.onCancelMatch(match.id)}
                  className="rounded-full border border-saber-red/50 px-3 py-1 text-xs uppercase tracking-widest text-saber-red transition hover:bg-saber-red/10 disabled:opacity-40"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={props.busyMatchId === match.id}
                onClick={() => props.onDeclareWinner(match.id, a.id)}
                className="rounded-full border border-violet-500/70 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25 disabled:opacity-40"
              >
                {a.name}
              </button>
              <button
                type="button"
                disabled={props.busyMatchId === match.id}
                onClick={() => props.onDeclareWinner(match.id, b.id)}
                className="rounded-full border border-amber-400/70 bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/25 disabled:opacity-40"
              >
                {b.name}
              </button>
            </div>
          )}
          {decided && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={props.busyMatchId === match.id}
                onClick={() => props.onUndoWinner(match.id)}
                className="rounded-full border border-imperial-gray/60 px-3 py-1 text-xs text-zinc-300 transition hover:bg-imperial-gray/30 disabled:opacity-40"
              >
                Undo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Side({
  group,
  isWinner,
  isHighlight,
  members,
  large,
  side,
}: {
  group: BracketGroup | null | undefined;
  isWinner: boolean;
  isHighlight: boolean;
  members: { nickname: string }[] | undefined;
  large: boolean;
  side: "a" | "b";
}) {
  // Jackbox Survey Scramble side colors: purple (top / side A), yellow (bottom / side B).
  const accent =
    side === "a"
      ? "border-l-4 border-violet-500 bg-violet-500/15"
      : "border-l-4 border-amber-400 bg-amber-400/15";
  const wrapper = `rounded-r-md ${accent} ${large ? "px-3 py-2" : "px-2 py-1"}`;

  if (!group) {
    return (
      <div className={wrapper}>
        <p className="text-zinc-500">— awaiting winner —</p>
      </div>
    );
  }
  const dimmed = !isWinner && group.eliminated;
  return (
    <div className={wrapper}>
      <p
        className={[
          "flex items-baseline justify-between",
          isWinner ? "font-semibold text-saber-blue" : "text-zinc-100",
          dimmed ? "text-zinc-500 line-through" : "",
          isHighlight ? "text-tatooine-sand" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span>
          <span
            className={`mr-1 text-zinc-400 ${large ? "text-base" : "text-xs"}`}
          >
            #{group.seed}
          </span>
          {group.name}
        </span>
        {isWinner && (
          <span
            className={`uppercase tracking-widest text-saber-green ${large ? "text-sm" : "text-xs"}`}
          >
            winner
          </span>
        )}
      </p>
      {members && members.length > 0 && (
        <p
          className={`mt-1 text-zinc-300 ${large ? "text-sm" : "text-xs"} ${dimmed ? "opacity-60" : ""}`}
        >
          {members.map((m) => m.nickname).join(", ")}
        </p>
      )}
    </div>
  );
}

// Re-ticks once a second and returns the remaining seconds (can go negative).
export function useTimeRemaining(
  startedAt: string | null,
  durationSeconds: number | null,
): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt || durationSeconds == null) return null;
  const ends = new Date(startedAt).getTime() + durationSeconds * 1000;
  return Math.round((ends - now) / 1000);
}

export function formatRemaining(seconds: number): string {
  const abs = Math.max(0, seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function InlineCountdown({
  startedAt,
  durationSeconds,
}: {
  startedAt: string;
  durationSeconds: number;
}) {
  const remaining = useTimeRemaining(startedAt, durationSeconds) ?? 0;
  const expired = remaining <= 0;
  return (
    <p
      className={`font-mono text-sm ${expired ? "text-saber-red" : "text-saber-blue"}`}
    >
      {expired ? "Time's up" : `⏱ ${formatRemaining(remaining)}`}
    </p>
  );
}
