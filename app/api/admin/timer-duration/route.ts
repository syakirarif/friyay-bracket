import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase/server";

const BodySchema = z.object({
  seconds: z.number().int().min(15).max(60 * 60),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Duration must be between 15 seconds and 1 hour." },
      { status: 400 },
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("session")
    .update({ match_duration_seconds: parsed.data.seconds })
    .eq("id", "current");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
