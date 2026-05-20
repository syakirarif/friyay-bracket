import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/server";

const BodySchema = z.object({
  groupId: z.string().uuid(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: matchId } = await ctx.params;
  if (!matchId) {
    return NextResponse.json({ error: "Missing match id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "groupId is required." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().rpc("declare_winner", {
    p_match_id: matchId,
    p_winner_group_id: parsed.data.groupId,
  });

  if (error) {
    // P0002 = our "Match not found" → 404; P0001 = our domain errors → 409.
    const status = error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
