import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: matchId } = await ctx.params;
  if (!matchId) {
    return NextResponse.json({ error: "Missing match id." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().rpc("undo_winner", {
    p_match_id: matchId,
  });

  if (error) {
    const status = error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
