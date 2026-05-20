"use client";

import { useMemo } from "react";

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
}

interface CommonProps {
  groups: BracketGroup[];
  matches: BracketMatch[];
  championGroupId?: string | null;
}

interface AdminProps extends CommonProps {
  mode: "admin";
  busyMatchId?: string | null;
  onDeclareWinner: (matchId: string, groupId: string) => void | Promise<void>;
  onUndoWinner: (matchId: string) => void | Promise<void>;
}

interface DisplayProps extends CommonProps {
  mode: "display";
  highlightGroupId?: string | null;
}

type Props = AdminProps | DisplayProps;

export function Bracket(props: Props) {
  const { groups, matches, championGroupId } = props;

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
    <div className="flex gap-6 overflow-x-auto pb-2">
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
            className="flex min-w-[16rem] flex-col gap-3"
            style={{ justifyContent: "space-around" }}
          >
            <p className="text-xs uppercase tracking-widest text-saber-blue/80">
              {label}
            </p>
            {list.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                groupById={groupById}
                championGroupId={championGroupId ?? null}
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
  props,
}: {
  match: BracketMatch;
  groupById: Map<string, BracketGroup>;
  championGroupId: string | null;
  props: Props;
}) {
  const a = match.group_a_id ? groupById.get(match.group_a_id) : null;
  const b = match.group_b_id ? groupById.get(match.group_b_id) : null;
  const decided = match.winner_group_id !== null;
  const isFinal = match.next_match_id === null;
  const isChampionFinal =
    isFinal && decided && championGroupId === match.winner_group_id;

  return (
    <div
      className={`rounded-md border p-3 text-sm transition ${
        isChampionFinal
          ? "border-tatooine-sand/60 bg-tatooine-sand/10 shadow-[0_0_24px_-6px_rgba(193,168,117,0.6)]"
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
      />
      <p className="my-1 text-center text-[10px] uppercase tracking-widest text-saber-red/70">
        vs
      </p>
      <Side
        group={b}
        isWinner={decided && match.winner_group_id === match.group_b_id}
        isHighlight={
          props.mode === "display" &&
          props.highlightGroupId === (b?.id ?? null)
        }
      />

      {props.mode === "admin" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!decided && a && b && (
            <>
              <button
                type="button"
                disabled={props.busyMatchId === match.id}
                onClick={() => props.onDeclareWinner(match.id, a.id)}
                className="saber-glow-blue rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40"
              >
                {a.name}
              </button>
              <button
                type="button"
                disabled={props.busyMatchId === match.id}
                onClick={() => props.onDeclareWinner(match.id, b.id)}
                className="saber-glow-blue rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40"
              >
                {b.name}
              </button>
            </>
          )}
          {decided && (
            <button
              type="button"
              disabled={props.busyMatchId === match.id}
              onClick={() => props.onUndoWinner(match.id)}
              className="rounded-full border border-imperial-gray/60 px-3 py-1 text-xs text-zinc-300 transition hover:bg-imperial-gray/30 disabled:opacity-40"
            >
              Undo
            </button>
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
}: {
  group: BracketGroup | null | undefined;
  isWinner: boolean;
  isHighlight: boolean;
}) {
  if (!group) {
    return <p className="text-zinc-600">— awaiting winner —</p>;
  }
  return (
    <p
      className={[
        "flex items-baseline justify-between",
        isWinner ? "font-semibold text-saber-blue" : "text-zinc-200",
        !isWinner && group.eliminated ? "text-zinc-500 line-through" : "",
        isHighlight ? "text-tatooine-sand" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span>
        <span className="mr-1 text-xs text-zinc-500">#{group.seed}</span>
        {group.name}
      </span>
      {isWinner && (
        <span className="text-xs uppercase tracking-widest text-saber-green">
          winner
        </span>
      )}
    </p>
  );
}
