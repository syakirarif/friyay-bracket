import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  const admin = getSupabaseAdmin();

  // ON DELETE SET NULL on every FK pointing to group/match makes the order
  // forgiving, but doing it explicitly keeps audit-friendly behavior.
  for (const table of ["match", "participant", "group"] as const) {
    const { error } = await admin.from(table).delete().not("id", "is", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { error } = await admin
    .from("session")
    .update({
      state: "lobby",
      group_count: null,
      champion_group_id: null,
    })
    .eq("id", "current");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
