import { NextResponse } from "next/server";
import { z } from "zod";

import { listParticipants } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const BodySchema = z.object({
  nickname: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(24)),
});

// Joining is open in every session state. Late arrivals get group_id = NULL,
// which keeps them out of any already-deployed squads / bracket.
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
      { error: "Pick a call sign between 1 and 24 characters, pilot." },
      { status: 400 },
    );
  }
  const { nickname } = parsed.data;

  const participants = await listParticipants();
  const target = nickname.toLowerCase();
  if (participants.some((p) => p.nickname.toLowerCase() === target)) {
    return NextResponse.json(
      { error: "This call sign is already in use, pilot." },
      { status: 409 },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("participant")
    .insert({ nickname })
    .select("id, nickname")
    .single();
  if (error) {
    return NextResponse.json(
      { error: "Could not register. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, nickname: data.nickname });
}
