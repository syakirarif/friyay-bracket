import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";

// Clears the timer on a match without declaring a winner.
// Used when admin needs to restart the clock (wrong duration, mistakenly started, etc.).
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: matchId } = await ctx.params;
  if (!matchId) {
    return NextResponse.json({ error: "Missing match id." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("match")
    .update({ started_at: null, duration_seconds: null })
    .eq("id", matchId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
