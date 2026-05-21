import { NextResponse } from "next/server";

import { getSession, listMatches } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: matchId } = await ctx.params;
  if (!matchId) {
    return NextResponse.json({ error: "Missing match id." }, { status: 400 });
  }

  const session = await getSession();
  if (session.state !== "bracket") {
    return NextResponse.json(
      { error: "Matches can only run while the bracket is live." },
      { status: 409 },
    );
  }

  const matches = await listMatches();
  const match = matches.find((m) => m.id === matchId);
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  if (match.winner_group_id) {
    return NextResponse.json(
      { error: "Match already decided." },
      { status: 409 },
    );
  }
  if (!match.group_a_id || !match.group_b_id) {
    return NextResponse.json(
      { error: "Match doesn't have both opponents yet." },
      { status: 409 },
    );
  }

  const running = matches.find(
    (m) => m.started_at && !m.winner_group_id && m.id !== matchId,
  );
  if (running) {
    return NextResponse.json(
      { error: "Another match is already running — cancel it first." },
      { status: 409 },
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("match")
    .update({
      started_at: new Date().toISOString(),
      duration_seconds: session.match_duration_seconds,
    })
    .eq("id", matchId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
