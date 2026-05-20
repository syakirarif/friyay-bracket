// Phase 5 verification: bracket structure + declare/undo/finished flow.
// Run with: NODE_TLS_REJECT_UNAUTHORIZED=0 node --env-file=.env.local scripts/verify-phase5.mjs
// Expects: dev server on :3456, admin cookie via process.env.ADMIN_COOKIE.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3456";
const COOKIE = process.env.ADMIN_COOKIE;
if (!COOKIE) {
  console.error("Set ADMIN_COOKIE='<value>' (no admin_auth= prefix).");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let pass = 0;
let fail = 0;
function ok(name, extra = "") {
  console.log(`  ok  ${name}${extra ? " — " + extra : ""}`);
  pass++;
}
function bad(name, msg) {
  console.log(`  FAIL ${name} — ${msg}`);
  fail++;
}

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Cookie: `admin_auth=${COOKIE}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function loadState() {
  const [s, g, m] = await Promise.all([
    admin.from("session").select("*").eq("id", "current").single(),
    admin.from("group").select("*").order("seed"),
    admin.from("match").select("*").order("round").order("slot"),
  ]);
  return { session: s.data, groups: g.data ?? [], matches: m.data ?? [] };
}

console.log("Phase 5 verification");

// --- 1. Initial bracket structure ---
{
  const { matches, groups } = await loadState();
  if (matches.length === 3) ok("3 matches created");
  else bad("3 matches created", `got ${matches.length}`);

  const round1 = matches.filter((m) => m.round === 1);
  const round2 = matches.filter((m) => m.round === 2);
  if (round1.length === 2 && round2.length === 1) {
    ok("2 round-1 matches + 1 final");
  } else {
    bad("round counts", `r1=${round1.length} r2=${round2.length}`);
  }

  // Verify seeding: round-1 slot 0 = seed 1 vs seed 4, slot 1 = seed 2 vs seed 3.
  const g = (seed) => groups.find((x) => x.seed === seed);
  const r10 = round1.find((m) => m.slot === 0);
  const r11 = round1.find((m) => m.slot === 1);
  if (
    r10.group_a_id === g(1).id &&
    r10.group_b_id === g(4).id &&
    r11.group_a_id === g(2).id &&
    r11.group_b_id === g(3).id
  ) {
    ok("round-1 seeding 1v4, 2v3");
  } else {
    bad(
      "round-1 seeding",
      `r10=[${r10.group_a_id?.slice(0,4)},${r10.group_b_id?.slice(0,4)}] r11=[${r11.group_a_id?.slice(0,4)},${r11.group_b_id?.slice(0,4)}]`,
    );
  }

  // Final has both slots empty and no next_match_id.
  const final = round2[0];
  if (
    final.group_a_id === null &&
    final.group_b_id === null &&
    final.next_match_id === null
  ) {
    ok("final starts empty with no next_match");
  } else {
    bad(
      "final init",
      `a=${final.group_a_id} b=${final.group_b_id} next=${final.next_match_id}`,
    );
  }

  // Round-1 matches both point to the final.
  if (r10.next_match_id === final.id && r11.next_match_id === final.id) {
    ok("round-1 matches both reference the final via next_match_id");
  } else {
    bad("round-1 next_match wiring", "mismatch");
  }
}

// --- 2. Declare winner on round-1 slot 0 ---
let state = await loadState();
const r10 = state.matches.find((m) => m.round === 1 && m.slot === 0);
const r11 = state.matches.find((m) => m.round === 1 && m.slot === 1);
const final = state.matches.find((m) => m.round === 2);
const seed1Group = state.groups.find((g) => g.seed === 1);
const seed2Group = state.groups.find((g) => g.seed === 2);
const seed3Group = state.groups.find((g) => g.seed === 3);
const seed4Group = state.groups.find((g) => g.seed === 4);

{
  const res = await api(`/api/admin/match/${r10.id}/winner`, {
    groupId: seed1Group.id,
  });
  if (res.status === 200) ok("declare-winner r1m0 → 200");
  else bad("declare-winner r1m0", `${res.status} ${JSON.stringify(res.data)}`);
}

state = await loadState();
{
  const r10now = state.matches.find((m) => m.id === r10.id);
  const finalNow = state.matches.find((m) => m.round === 2);
  if (r10now.winner_group_id === seed1Group.id) ok("r1m0 has winner stamped");
  else bad("r1m0 winner stamp", `got ${r10now.winner_group_id}`);

  if (state.groups.find((g) => g.id === seed4Group.id).eliminated) {
    ok("loser (seed 4) marked eliminated");
  } else {
    bad("loser eliminated", "still active");
  }

  if (finalNow.group_a_id === seed1Group.id) {
    ok("winner advanced to final.group_a (first empty slot)");
  } else {
    bad("advancement", `final.group_a=${finalNow.group_a_id}`);
  }
}

// --- 3. Reject double-declare on the same match ---
{
  const res = await api(`/api/admin/match/${r10.id}/winner`, {
    groupId: seed1Group.id,
  });
  if (res.status === 409 && /already decided/.test(res.data.error ?? "")) {
    ok("double-declare rejected (409)");
  } else {
    bad("double-declare", `${res.status} ${JSON.stringify(res.data)}`);
  }
}

// --- 4. Undo while final is still open should clear final.group_a ---
{
  const res = await api(`/api/admin/match/${r10.id}/undo`);
  if (res.status === 200) ok("undo r1m0 → 200");
  else bad("undo r1m0", `${res.status} ${JSON.stringify(res.data)}`);
}
state = await loadState();
{
  const finalNow = state.matches.find((m) => m.round === 2);
  if (finalNow.group_a_id === null) ok("undo cleared final.group_a");
  else bad("undo cleared final.group_a", `got ${finalNow.group_a_id}`);

  if (!state.groups.find((g) => g.id === seed4Group.id).eliminated) {
    ok("undo un-eliminated seed 4");
  } else {
    bad("un-eliminate", "still eliminated");
  }
}

// --- 5. Re-declare, declare r1m1, then declare final → finished ---
await api(`/api/admin/match/${r10.id}/winner`, { groupId: seed1Group.id });
await api(`/api/admin/match/${r11.id}/winner`, { groupId: seed2Group.id });
state = await loadState();
{
  const finalNow = state.matches.find((m) => m.round === 2);
  if (
    finalNow.group_a_id !== null &&
    finalNow.group_b_id !== null &&
    finalNow.group_a_id !== finalNow.group_b_id
  ) {
    ok("final now has both opponents populated");
  } else {
    bad("final populated", `a=${finalNow.group_a_id} b=${finalNow.group_b_id}`);
  }
}

const finalId = state.matches.find((m) => m.round === 2).id;
{
  const res = await api(`/api/admin/match/${finalId}/winner`, {
    groupId: seed1Group.id,
  });
  if (res.status === 200) ok("declare final winner → 200");
  else bad("declare final", `${res.status} ${JSON.stringify(res.data)}`);
}
state = await loadState();
{
  if (state.session.state === "finished") ok("session.state flipped to finished");
  else bad("finished state", `got ${state.session.state}`);

  if (state.session.champion_group_id === seed1Group.id) {
    ok("session.champion_group_id set to winner");
  } else {
    bad("champion stored", `got ${state.session.champion_group_id}`);
  }
}

// --- 6. Undo of a decided round-1 match must fail (final already decided) ---
{
  const res = await api(`/api/admin/match/${r10.id}/undo`);
  if (res.status === 409 && /already decided/.test(res.data.error ?? "")) {
    ok("undo r1m0 refused once final is decided (409)");
  } else {
    bad("undo refused", `${res.status} ${JSON.stringify(res.data)}`);
  }
}

// --- 7. Undo of the final reverts to bracket state ---
{
  const res = await api(`/api/admin/match/${finalId}/undo`);
  if (res.status === 200) ok("undo final → 200");
  else bad("undo final", `${res.status} ${JSON.stringify(res.data)}`);
}
state = await loadState();
{
  if (
    state.session.state === "bracket" &&
    state.session.champion_group_id === null
  ) {
    ok("session reverted to bracket, champion cleared");
  } else {
    bad(
      "post-undo final state",
      `state=${state.session.state} champion=${state.session.champion_group_id}`,
    );
  }
}

// --- 8. Generate-bracket refuses when bracket already exists ---
{
  const res = await api("/api/admin/generate-bracket");
  if (res.status === 409) ok("generate-bracket rejects re-generation (409)");
  else bad("re-generate", `${res.status} ${JSON.stringify(res.data)}`);
}

// --- 9. Generate-groups refuses outside `grouping` state ---
// (After undoing the final we're back to state=`bracket`, so the state guard
// fires before the matches-exist guard. Both reject paths are valid.)
{
  const res = await api("/api/admin/generate-groups", { groupCount: 4 });
  if (res.status === 409) {
    ok(`generate-groups rejected outside grouping (409): "${res.data.error}"`);
  } else {
    bad("groups guard", `${res.status} ${JSON.stringify(res.data)}`);
  }
}

// --- 10. Reset cleans everything ---
{
  const res = await api("/api/admin/reset");
  if (res.status === 200) ok("reset → 200");
  else bad("reset", `${res.status} ${JSON.stringify(res.data)}`);
}
state = await loadState();
{
  if (
    state.session.state === "lobby" &&
    state.matches.length === 0 &&
    state.groups.length === 0
  ) {
    ok("post-reset: lobby + 0 matches + 0 groups");
  } else {
    bad(
      "post-reset state",
      `state=${state.session.state} matches=${state.matches.length} groups=${state.groups.length}`,
    );
  }
}

console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
