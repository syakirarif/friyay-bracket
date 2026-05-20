import { NextResponse } from "next/server";

import { getSession, listGroups, listMatches } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  const session = await getSession();
  if (session.state !== "grouping") {
    return NextResponse.json(
      { error: "Session is not in grouping state." },
      { status: 409 },
    );
  }

  const groups = await listGroups();
  const N = groups.length;
  const rounds = Math.log2(N);
  if (!Number.isInteger(rounds) || rounds < 1 || N < 2 || N > 16) {
    return NextResponse.json(
      { error: "Group count must be 2, 4, 8, or 16." },
      { status: 409 },
    );
  }

  const existing = await listMatches();
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Bracket already exists. Reset to rebuild." },
      { status: 409 },
    );
  }

  const admin = getSupabaseAdmin();

  // Build top-down so each lower round can reference the next round's match id.
  const idByPos = new Map<string, string>();
  for (let round = rounds; round >= 1; round--) {
    const matchCount = Math.pow(2, rounds - round);
    const rows: Array<{
      round: number;
      slot: number;
      group_a_id: string | null;
      group_b_id: string | null;
      next_match_id: string | null;
    }> = [];

    for (let slot = 0; slot < matchCount; slot++) {
      const isRound1 = round === 1;
      const group_a_id = isRound1 ? groups[slot].id : null;
      const group_b_id = isRound1 ? groups[N - 1 - slot].id : null;
      const next_match_id =
        round < rounds
          ? (idByPos.get(`${round + 1}-${Math.floor(slot / 2)}`) ?? null)
          : null;
      rows.push({ round, slot, group_a_id, group_b_id, next_match_id });
    }

    const { data, error } = await admin
      .from("match")
      .insert(rows)
      .select("id, round, slot");
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to insert matches." },
        { status: 500 },
      );
    }
    for (const m of data) {
      idByPos.set(`${m.round}-${m.slot}`, m.id);
    }
  }

  const { error } = await admin
    .from("session")
    .update({ state: "bracket" })
    .eq("id", "current");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rounds, matches: N - 1 });
}
