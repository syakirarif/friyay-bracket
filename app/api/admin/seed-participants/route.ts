import { NextResponse } from "next/server";
import { z } from "zod";

import { listParticipants } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const BodySchema = z.object({
  count: z.number().int().min(1).max(50),
});

const NAME_POOL = [
  "Nova", "Comet", "Pulsar", "Orbit", "Astro", "Cosmo", "Stellar", "Quasar",
  "Nebula", "Photon", "Vector", "Rogue", "Falcon", "Eagle", "Raven", "Wolf",
  "Tiger", "Phoenix", "Dragon", "Viper", "Hawk", "Shark", "Cobra", "Ranger",
  "Hunter", "Scout", "Maverick", "Ghost", "Shadow", "Blaze", "Storm", "Frost",
  "Spark", "Bolt", "Flash", "Sonic", "Turbo", "Nitro", "Rocket", "Laser",
  "Plasma", "Atom", "Quark", "Mystic", "Apex", "Zenith", "Vortex", "Spectre",
  "Phantom", "Cipher", "Echo", "Saber", "Blade", "Vanguard", "Striker", "Drift",
  "Pixel", "Glitch", "Byte", "Neon", "Crimson", "Cobalt", "Onyx", "Jade",
];

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
      { error: "Pick a count between 1 and 50." },
      { status: 400 },
    );
  }
  const { count } = parsed.data;

  // Seeding is allowed in every state. Post-lobby seeds land on the waitlist
  // (group_id stays NULL), which is exactly what we want for simulation.
  const participants = await listParticipants();
  const taken = new Set(participants.map((p) => p.nickname.toLowerCase()));

  const rows: { nickname: string }[] = [];
  for (let i = 0; i < count; i++) {
    let nickname = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      const base = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)]!;
      const candidate =
        attempt < 5 ? base : `${base}${Math.floor(Math.random() * 90 + 10)}`;
      if (!taken.has(candidate.toLowerCase())) {
        nickname = candidate;
        taken.add(candidate.toLowerCase());
        break;
      }
    }
    if (!nickname) {
      return NextResponse.json(
        { error: "Couldn't generate enough unique names." },
        { status: 500 },
      );
    }
    rows.push({ nickname });
  }

  const { error } = await getSupabaseAdmin().from("participant").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}
