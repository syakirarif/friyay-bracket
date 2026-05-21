import { NextResponse } from "next/server";

import {
  getSession,
  listGroups,
  listMatches,
  listParticipants,
} from "@/lib/db";
import { GROUP_NAMES } from "@/lib/groupNames";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const MAX_PER_GROUP = 5;

// Distributes participants with group_id IS NULL into groups.
//   - Skips groups whose R1 match is already running or decided.
//   - Fills smallest eligible groups first, up to MAX_PER_GROUP each.
//   - In grouping state, creates new groups for overflow (max 16 total).
//   - In bracket state, leaves overflow on the waitlist (bracket is locked).
export async function POST() {
  const session = await getSession();
  if (session.state !== "grouping" && session.state !== "bracket") {
    return NextResponse.json(
      { error: "Waitlist can only be assigned during grouping or bracket." },
      { status: 409 },
    );
  }

  const [participants, groups, matches] = await Promise.all([
    listParticipants(),
    listGroups(),
    listMatches(),
  ]);

  const waitlist = participants.filter((p) => p.group_id === null);
  if (waitlist.length === 0) {
    return NextResponse.json({
      ok: true,
      assigned: 0,
      remaining: 0,
      newGroups: 0,
    });
  }
  if (groups.length === 0) {
    return NextResponse.json(
      { error: "No groups exist yet — assign squads first." },
      { status: 409 },
    );
  }

  // Lock any group whose match has started OR been decided.
  const lockedGroupIds = new Set<string>();
  for (const m of matches) {
    if (m.started_at === null && m.winner_group_id === null) continue;
    if (m.group_a_id) lockedGroupIds.add(m.group_a_id);
    if (m.group_b_id) lockedGroupIds.add(m.group_b_id);
  }

  const sizeByGroup = new Map<string, number>();
  for (const p of participants) {
    if (p.group_id) {
      sizeByGroup.set(p.group_id, (sizeByGroup.get(p.group_id) ?? 0) + 1);
    }
  }

  const eligible = groups
    .filter((g) => !lockedGroupIds.has(g.id))
    .sort(
      (a, b) =>
        (sizeByGroup.get(a.id) ?? 0) - (sizeByGroup.get(b.id) ?? 0) ||
        a.seed - b.seed,
    );

  const admin = getSupabaseAdmin();
  const assignments: Array<{ participantId: string; groupId: string }> = [];
  let cursor = 0;

  // Phase 1: fill existing eligible groups up to the cap.
  for (const g of eligible) {
    let size = sizeByGroup.get(g.id) ?? 0;
    while (size < MAX_PER_GROUP && cursor < waitlist.length) {
      assignments.push({ participantId: waitlist[cursor].id, groupId: g.id });
      size++;
      cursor++;
    }
    sizeByGroup.set(g.id, size);
  }

  // Phase 2: in grouping state, mint new groups for any overflow.
  let newGroupsCreated = 0;
  if (cursor < waitlist.length && session.state === "grouping") {
    let nextSeed = groups.length + 1;
    while (cursor < waitlist.length) {
      const nameIdx = nextSeed - 1;
      if (nameIdx >= GROUP_NAMES.length) {
        return NextResponse.json(
          {
            error: `Out of squad names — capped at ${GROUP_NAMES.length} groups.`,
          },
          { status: 409 },
        );
      }
      const { data, error } = await admin
        .from("group")
        .insert({
          name: GROUP_NAMES[nameIdx],
          seed: nextSeed,
          eliminated: false,
        })
        .select("id")
        .single();
      if (error || !data) {
        return NextResponse.json(
          { error: error?.message ?? "Failed to create group." },
          { status: 500 },
        );
      }
      newGroupsCreated++;
      let size = 0;
      while (size < MAX_PER_GROUP && cursor < waitlist.length) {
        assignments.push({ participantId: waitlist[cursor].id, groupId: data.id });
        size++;
        cursor++;
      }
      nextSeed++;
    }
  }

  // Apply participant assignments in parallel.
  const results = await Promise.all(
    assignments.map((a) =>
      admin
        .from("participant")
        .update({ group_id: a.groupId })
        .eq("id", a.participantId),
    ),
  );
  const firstError = results.find((r) => r.error !== null);
  if (firstError && firstError.error) {
    return NextResponse.json(
      { error: firstError.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    assigned: assignments.length,
    remaining: waitlist.length - cursor,
    newGroups: newGroupsCreated,
  });
}
