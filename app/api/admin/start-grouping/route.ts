import { NextResponse } from "next/server";

import { getSession, listParticipants } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  const session = await getSession();
  if (session.state !== "lobby") {
    return NextResponse.json(
      { error: "Registration is not open." },
      { status: 409 },
    );
  }

  const participants = await listParticipants();
  if (participants.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 participants to start grouping." },
      { status: 409 },
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("session")
    .update({ state: "grouping" })
    .eq("id", "current");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
