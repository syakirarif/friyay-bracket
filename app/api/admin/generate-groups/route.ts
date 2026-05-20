import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession, listMatches, listParticipants } from "@/lib/db";
import { GROUP_NAMES } from "@/lib/groupNames";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const BodySchema = z.object({
  groupCount: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
});

function cryptoShuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
      { error: "groupCount must be 2, 4, 8, or 16." },
      { status: 400 },
    );
  }
  const { groupCount } = parsed.data;

  const session = await getSession();
  if (session.state !== "grouping") {
    return NextResponse.json(
      { error: "Session is not in grouping state." },
      { status: 409 },
    );
  }

  // Block regeneration once the bracket exists.
  const matches = await listMatches();
  if (matches.length > 0) {
    return NextResponse.json(
      { error: "Bracket already generated — reset before regrouping." },
      { status: 409 },
    );
  }

  const participants = await listParticipants();
  if (participants.length < groupCount) {
    return NextResponse.json(
      {
        error: `Need at least ${groupCount} participants for ${groupCount} groups (have ${participants.length}).`,
      },
      { status: 409 },
    );
  }

  const admin = getSupabaseAdmin();

  // Clear any prior groups. ON DELETE SET NULL cascades to participant.group_id.
  {
    const { error } = await admin
      .from("group")
      .delete()
      .not("id", "is", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Insert new groups with seeds 1..N and themed names.
  const groupRows = Array.from({ length: groupCount }, (_, i) => ({
    name: GROUP_NAMES[i],
    seed: i + 1,
    eliminated: false,
  }));
  const { data: inserted, error: insertErr } = await admin
    .from("group")
    .insert(groupRows)
    .select("id, seed")
    .order("seed", { ascending: true });
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create groups." },
      { status: 500 },
    );
  }

  // Shuffle participants and slice into chunks differing by at most 1.
  const shuffled = cryptoShuffle(participants);
  const base = Math.floor(shuffled.length / groupCount);
  const extra = shuffled.length - base * groupCount;

  const updates: Array<
    PromiseLike<{ error: { message: string } | null }>
  > = [];
  let cursor = 0;
  for (let i = 0; i < groupCount; i++) {
    const size = i < extra ? base + 1 : base;
    const chunk = shuffled.slice(cursor, cursor + size);
    cursor += size;
    const groupId = inserted[i].id;
    for (const p of chunk) {
      updates.push(
        admin.from("participant").update({ group_id: groupId }).eq("id", p.id),
      );
    }
  }
  const results = await Promise.all(updates);
  const firstError = results.find((r) => r.error !== null);
  if (firstError && firstError.error) {
    return NextResponse.json(
      { error: firstError.error.message },
      { status: 500 },
    );
  }

  // Stamp the group_count on the session (state stays 'grouping').
  {
    const { error } = await admin
      .from("session")
      .update({ group_count: groupCount })
      .eq("id", "current");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, groupCount });
}
