# FriYAY May 2026 Game Bracket — Implementation Plan

**Tagline:** *May the FriYAY be with You!*

## Context

Greenfield Next.js + Supabase web app for a live, in-person event. The host (admin) shows a QR code on a big screen; audience scans with phones, enters a nickname, and lands on a personal confirmation page. Admin watches the registrant list update in real time, picks a group count (2/4/8/16), the app randomly distributes audience members into **groups that act as teams**, then generates a single-elimination bracket. Admin advances winners with a click; the big-screen display and each audience member's page update live.

## Locked Decisions

- **Each group = one team** in the bracket. Advancing a group advances every member with it.
- **Group sizes may differ by ±1** when audience count doesn't divide evenly.
- **Admin auth:** single password from `ADMIN_PASSWORD` env var, cookie-gated.
- **Bracket size:** restricted to powers of 2 — admin picks **2, 4, 8, or 16** groups.
- **Single global session** at any time; admin can reset to start a fresh round.
- **Three distinct UIs:** `/join` + `/joined` (audience phones), `/admin` (host laptop), `/display` (big screen, read-only).
- **Audience confirmation page** shows nickname + live group/bracket status once those exist.

## Tech & Hosting

- **Framework:** Next.js (App Router) + React + TypeScript, styled with Tailwind CSS.
- **Backend:** Supabase Postgres + Row-Level Security + **Supabase Realtime** for live updates.
- **QR generation:** `qrcode.react` (client component on `/admin` and `/display`).
- **Hosting:** Vercel (web) + Supabase Cloud (DB + Realtime).
- **Star Wars feel:** Tailwind theme with deep-space background, `Orbitron`/`Press Start 2P` headings, blue/red lightsaber-glow buttons, themed group names (Rebel Alliance, Galactic Empire, Jedi Order, Sith Order, Mandalorians, Bounty Hunters, Resistance, First Order, …).

## Data Model (Supabase)

```
session         (singleton row, id = 'current')
  state              text  -- 'lobby' | 'grouping' | 'bracket' | 'finished'
  group_count        int   nullable
  join_base_url      text  -- public URL for QR
  champion_group_id  uuid  nullable FK -> group.id  -- set by final match
  updated_at         timestamptz

participant
  id               uuid PK
  nickname         text  not null
  group_id         uuid  nullable FK -> group.id
  joined_at        timestamptz

group
  id               uuid PK
  name             text  -- themed: "Rebel Alliance", etc.
  seed             int   -- 1..N, used for bracket pairing
  eliminated       bool  default false

match
  id               uuid PK
  round            int   -- 1 = first round, increases each round
  slot             int   -- position within the round
  group_a_id       uuid nullable FK
  group_b_id       uuid nullable FK
  winner_group_id  uuid nullable FK
  next_match_id    uuid nullable FK -> match.id  -- where winner advances
```

Enable Realtime publication on `session`, `participant`, `group`, `match`.

## Routes

| Route | Audience | Notes |
|---|---|---|
| `/` | anyone | Landing card with event title + tagline + links to Display / Admin |
| `/join` | phone | Nickname form; QR code targets this URL |
| `/joined` | phone | Confirmation + live group reveal + bracket status (stores participant id in `localStorage`) |
| `/admin/login` | host | Password form, sets HttpOnly cookie |
| `/admin` | host | Registrants list, group-count picker, bracket controls, reset |
| `/display` | big screen | QR (lobby) → group reveal → live bracket |

## Server actions / API

- `POST /api/join` — public, creates participant if session is in `lobby`.
- `POST /api/admin/start-grouping` — admin only, locks lobby.
- `POST /api/admin/generate-groups` — admin only, shuffles participants into `group_count` groups (±1 size diff).
- `POST /api/admin/generate-bracket` — admin only, creates `match` rows wired via `next_match_id`.
- `POST /api/admin/match/[id]/winner` — admin only, sets winner, propagates to `next_match_id`, marks loser group eliminated, flips session to `finished` on final.
- `POST /api/admin/reset` — admin only, wipes participants/groups/matches and returns session to `lobby`.

All admin endpoints check the `admin_auth` cookie in a Next.js middleware.

---

# Implementation Phases

Each phase below includes **Implementation Phase** (work), **Implementation Result** (acceptance check), and **Notes for Upcoming Steps** (handoff context).

## Phase 1 — Project Scaffold & Supabase Setup

**Implementation Phase**
- `pnpm create next-app friyay-bracket --typescript --tailwind --app --eslint`.
- Add deps: `@supabase/supabase-js`, `@supabase/ssr`, `qrcode.react`, `zod`.
- Create Supabase project in Cloud; copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (service role only used server-side).
- Add `ADMIN_PASSWORD` to `.env.local`.
- Create `lib/supabase/server.ts` (service-role client for admin actions) and `lib/supabase/browser.ts` (anon client for Realtime).
- Add a placeholder landing page at `/` with title and tagline so deployment can be smoke-tested early.

**Implementation Result**
- `pnpm dev` renders `/` showing "FriYAY May 2026 Game Bracket — May the FriYAY be with You!".
- Supabase client connects without errors (verify with a trivial `select 1` from a server action).

**Notes for Upcoming Steps**
- Service-role key must never reach the browser — keep it inside server-only modules (mark files with `"server-only"` import).
- Decide deployment URL now (Vercel preview vs custom domain); it's needed for the QR code base URL.

---

## Phase 2 — Database Schema & Realtime Wiring

**Implementation Phase**
- Add `supabase/migrations/0001_init.sql` with the four tables above plus indices on `participant.group_id`, `match.round`, `match.next_match_id`.
- Seed the singleton `session` row with `id='current'`, `state='lobby'`.
- Enable Realtime publication: `alter publication supabase_realtime add table session, participant, "group", match;`.
- Apply RLS:
  - `participant`: public can `insert` (only when `session.state='lobby'`) and `select` own row by id; service role bypasses.
  - `session`, `group`, `match`: public `select` only; mutations only via service role.
- Write `lib/db.ts` with typed helpers (`getSession`, `listParticipants`, etc.).

**Implementation Result**
- Running migrations in a fresh Supabase project produces the schema with no errors.
- A throwaway script can subscribe to `participant` changes and see inserts in real time.

**Notes for Upcoming Steps**
- The Realtime subscription channel name pattern (`session:current`, `participants:all`, `bracket:all`) will be reused in three different pages — centralize channel names in `lib/realtime.ts`.
- Consider whether a participant's `localStorage` id should ever be regenerated. Decision: no — it's their only proof of identity for the `/joined` view.

---

## Phase 3 — Public Join Flow

**Implementation Phase**
- `/join` page: minimal Star-Wars-themed form, single nickname input, client-side trim + 1–24 char validation, Zod-validated server action POST.
- On success, store returned participant `{ id, nickname }` in `localStorage` and `router.push('/joined')`.
- `/joined` page:
  - Reads participant id from `localStorage`; if missing, redirect to `/join`.
  - Subscribes via Supabase browser client to `session`, own `participant` row, and `group`/`match` changes.
  - Renders:
    - Lobby state: "You are joined as **{nickname}** — awaiting transmission from command…"
    - Grouping state: "Squad assigned: **{group.name}**" with squad-mate list.
    - Bracket state: highlight their group's current match + status (advanced / eliminated / waiting).
- Reject duplicate nicknames within the session (case-insensitive) with a friendly Star Wars error ("This call sign is already in use, pilot.").

**Implementation Result**
- Two phones can scan a QR, enter different nicknames, and each lands on their own confirmation page.
- Admin (next phase) sees both names appear within ~1 s.

**Notes for Upcoming Steps**
- The QR code on `/admin` and `/display` must point to the deployed origin's `/join`, not `localhost`. Use `NEXT_PUBLIC_BASE_URL` env var, fall back to `window.location.origin` in client components.
- Audience phones may lose connection between rounds — Realtime client should auto-reconnect; verify with airplane-mode toggle.

---

## Phase 4 — Admin Panel: Auth, Registrants, Group Generation

**Implementation Phase**
- `/admin/login` posts password to a server action that compares to `ADMIN_PASSWORD`, sets `admin_auth` HttpOnly cookie (signed with a separate `ADMIN_COOKIE_SECRET`).
- `middleware.ts` rewrites `/admin/*` (except `/admin/login`) to login if cookie missing/invalid.
- `/admin` panel sections:
  1. **Lobby control** — shows QR for `/join`, live registrant count + name list (Realtime subscription), "Close registration" button → flips session to `grouping`.
  2. **Group setup** — only enabled when state = `grouping`. Dropdown allows **2 / 4 / 8 / 16** groups (option disabled if fewer participants than that count). Button "Assign Squads" calls `/api/admin/generate-groups`:
     - Server fetches all participants, shuffles with crypto-random, slices into `group_count` chunks of size `floor(n/k)` or `ceil(n/k)` so sizes differ by at most 1.
     - Inserts groups with themed names (round-robin from a 16-entry Star Wars list), assigns participants, sets seed = 1..N.
     - Flips session state to a sub-state `grouped` (or stays in `grouping` with `group_count` set — pick one and reflect in the state machine).
  3. **Reset** button (always visible behind a confirm modal) → `POST /api/admin/reset`.

**Implementation Result**
- Admin can log in with correct password, watches names stream in from real phones, clicks "Close registration", picks "4 groups", and sees 4 named groups with members distributed within ±1 of each other.
- Re-running "Assign Squads" before bracket creation re-shuffles deterministically (idempotent: clears prior groups first).

**Notes for Upcoming Steps**
- The themed group-name list must be at least 16 entries long to support max bracket size. Keep it in `lib/groupNames.ts` for reuse on `/display`.
- Group regeneration before bracket creation is allowed; after bracket creation it is blocked (UI disables the button, server also rejects).

---

## Phase 5 — Bracket Generation & Match Updates

**Implementation Phase**
- "Generate Bracket" button on `/admin` (enabled once groups exist) calls `/api/admin/generate-bracket`:
  - Computes `rounds = log2(group_count)`.
  - Creates matches bottom-up:
    - Round 1: pair seed *i* with seed *(N − i + 1)* (1v8, 2v7, 3v6, 4v5 for N=8).
    - Higher rounds: empty `group_a_id` / `group_b_id` placeholders linked via `next_match_id`.
  - Flips session state to `bracket`.
- Bracket view component (shared between `/admin` and `/display`):
  - Renders rounds left-to-right with connector lines.
  - Each match card shows both group names; admin variant adds two "Declare Winner" buttons (one per group), display variant is read-only.
- Winner endpoint logic (`/api/admin/match/[id]/winner`):
  1. Verify match has both groups and no winner yet.
  2. Set `winner_group_id`; mark losing group `eliminated = true`.
  3. If `next_match_id` exists: fill the empty `group_a_id` or `group_b_id` slot on that match (first empty wins).
  4. If no `next_match_id`: this was the final — set `session.state = 'finished'`, store champion group id on session.
- Admin can undo a winner declaration (button on a decided match) — clears winner, un-eliminates loser, clears the downstream match's filled slot **only if** that downstream match has no winner yet (otherwise show error "later rounds already decided — reset the bracket instead").

**Implementation Result**
- For 4 groups: 3 matches created (2 round-1, 1 final). Clicking winners through both round-1 matches auto-populates the final; clicking the final's winner flips session to `finished` and the champion is highlighted on `/admin`, `/display`, and on each audience phone in that group.
- For 8 and 16 groups, the same flow works; bracket layout adapts.

**Notes for Upcoming Steps**
- Real-time correctness depends on the server applying winner updates atomically. Use a Postgres function (`declare_winner(match_id, group_id)`) called from the route handler to keep multi-row updates in one transaction.
- Audience phones rely on the `participant.group_id → group.eliminated` chain — make sure the `groups` Realtime payload triggers a re-render on `/joined`.

---

## Phase 6 — Display View (Big Screen)

**Implementation Phase**
- `/display` is publicly accessible, read-only, no auth.
- Renders one of three layouts based on `session.state`:
  - `lobby`: huge QR code (centered), event title, tagline, live count "**N rebels have joined the resistance**", scrolling marquee of recent nicknames.
  - `grouping`/`grouped`: animated "Squad assignments incoming…" then reveals groups as cards with member lists.
  - `bracket`/`finished`: full-screen bracket; on `finished`, overlay "🏆 Champion: **{group.name}**" with member names.
- Optimize for projector: large fonts, high contrast, no scrollbars at 1080p.

**Implementation Result**
- Pointing a TV browser at `/display` and running the full happy path from another machine shows the QR, then groups, then bracket, then champion overlay — all updates within ~1 s of admin action.

**Notes for Upcoming Steps**
- Provide a `?demo=1` query param that injects fake data so the visual can be QA'd without spinning up a real session.
- Test that the QR remains scannable from the back of a typical conference room (8–10 m); bump module size if not.

---

## Phase 7 — Star Wars Theming & Polish

**Implementation Phase**
- Tailwind config: extend palette with `saber-blue`, `saber-red`, `saber-green`, `imperial-gray`, `tatooine-sand`.
- Global `body` background: dark space gradient with subtle star-field SVG.
- Headings use `Orbitron` (via `next/font/google`); button hover applies an outer glow matching the saber color (blue for primary, red for destructive like Reset).
- Add a brief opening "crawl" animation on `/` and `/display` lobby (CSS `transform: perspective` + `rotateX`).
- Group name list (`lib/groupNames.ts`): 16 themed names with matching emoji/sigil.
- Sound effects (optional, off by default behind a toggle on `/display`): lightsaber-on for "Generate Bracket", lightsaber-clash for "Declare Winner".

**Implementation Result**
- Visual review on `/`, `/join`, `/joined`, `/admin`, `/display` shows consistent Star Wars styling with readable contrast in a dim room.

**Notes for Upcoming Steps**
- Validate font loading on mobile Safari (the audience target). `next/font` should self-host, avoiding FOUT.
- Keep the sound toggle default-OFF so the projector doesn't blast audio unexpectedly.

---

## Phase 8 — Deployment

**Implementation Phase**
- Push to GitHub, import into Vercel, configure env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `ADMIN_COOKIE_SECRET`, `NEXT_PUBLIC_BASE_URL`.
- Apply Supabase migrations to the Cloud project; enable Realtime publication there.
- Smoke-test deployed URL with two phones + one laptop (admin) + one TV (display).
- Add a `README.md` documenting: how to start a new session (`/api/admin/reset`), how to rotate the admin password, and how to view logs.

**Implementation Result**
- Live URL works end-to-end on real hardware with real network (not just localhost).
- Reset cleanly returns the session to `lobby` for a second run-through.

**Notes for Upcoming Steps**
- Day-of-event checklist: charge laptop, confirm wi-fi capacity for ~50 simultaneous phone joins, pre-load `/display` on the projector laptop, dry-run with the host 30 min before showtime.
- Post-event: optionally export participant/bracket data to CSV before resetting (not in scope unless requested).

---

## Critical Files (to be created)

- `app/page.tsx` — landing
- `app/join/page.tsx` — public join form
- `app/joined/page.tsx` — audience confirmation + live status
- `app/admin/login/page.tsx`, `app/admin/page.tsx` — host control panel
- `app/display/page.tsx` — projector view
- `app/api/join/route.ts`
- `app/api/admin/start-grouping/route.ts`
- `app/api/admin/generate-groups/route.ts`
- `app/api/admin/generate-bracket/route.ts`
- `app/api/admin/match/[id]/winner/route.ts`
- `app/api/admin/reset/route.ts`
- `middleware.ts` — admin cookie gate
- `components/Bracket.tsx` — shared bracket renderer
- `components/QRJoinCode.tsx`
- `lib/supabase/server.ts`, `lib/supabase/browser.ts`
- `lib/db.ts`, `lib/realtime.ts`, `lib/groupNames.ts`
- `supabase/migrations/0001_init.sql`

## End-to-End Verification

1. Deploy to Vercel preview URL.
2. From a TV/laptop browser, open `/display` → QR visible.
3. From 5+ phones, scan QR, submit distinct nicknames → admin list and display count update live.
4. Admin logs in at `/admin/login`, closes registration, selects "4 groups" → audience phones show their assigned squad.
5. Admin clicks "Generate Bracket" → bracket appears on admin + display + audience phones.
6. Admin declares winners through to the final → champion overlay appears everywhere; eliminated audience phones show "Eliminated"; champion-squad phones show "🏆 Champions".
7. Admin clicks "Reset" → everything returns to lobby; re-run with a different group count (e.g., 8) to verify scaling.

---

# Implementation Journal

Living log of what was actually built per phase. Fill in **Implementation Result** with concrete files/commits/screenshots and **Notes for Upcoming Phase** with anything the next phase needs to know (gotchas, deviations from the plan, decisions taken mid-flight). Update the **Status** line as work moves forward.

> Status legend: ⬜ Not started · 🟡 In progress · ✅ Done · ⚠️ Blocked

---

## Phase 1 — Project Scaffold & Supabase Setup

**Status:** ✅ Done
**Started:** 2026-05-19
**Completed:** 2026-05-19

**Implementation Result**
- Scaffolded with `pnpm create next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --use-pnpm --turbopack --yes` (Next 16.2.6, React 19.2.4, Tailwind v4, TypeScript 5.9).
- Existing `CLAUDE.md`, `implementation_plan.md`, and `.rtk/` were temporarily moved aside because create-next-app refuses to run in a non-empty directory; restored after the install completed.
- Added runtime deps: `@supabase/supabase-js@2.106.0`, `@supabase/ssr@0.10.3`, `qrcode.react@4.2.0`, `zod@4.4.3`, `server-only@0.0.1`.
- Env files created:
  - `.env.local` — placeholder values (gitignored via existing `.env*` rule).
  - `.env.example` — committed reference listing all six env vars from the plan plus `NEXT_PUBLIC_BASE_URL`.
- Supabase client modules:
  - `lib/supabase/server.ts` — `"server-only"` import + lazy `getSupabaseAdmin()` factory using the service-role key.
  - `lib/supabase/browser.ts` — `"use client"` + lazy `getSupabaseBrowser()` factory using the anon key.
- Landing page (`app/page.tsx`) replaced with a minimal placeholder showing the title `"FriYAY May 2026 Game Bracket"`, the tagline `"May the FriYAY be with You!"`, and nav links to `/join`, `/display`, `/admin`. `app/layout.tsx` metadata updated to match (title + description).
- Verification:
  - `pnpm exec next build` ✓ compiles successfully (route table shows `○ /` and `○ /_not-found`, both prerendered).
  - `pnpm exec next dev --port 3456` ✓ ready in 465 ms. `curl http://localhost:3456/` returns HTTP 200 with the expected `<title>FriYAY May 2026 Game Bracket</title>`, `<h1>FriYAY May 2026 Game Bracket</h1>`, and `<p>May the FriYAY be with You!</p>` in the rendered HTML.
- The "trivial `select 1` from a server action" connection check from the plan is **deferred to Phase 2**, when real Supabase credentials are available; the lazy client design above lets phases 2+ wire it without rewriting Phase 1 modules.

**Notes for Upcoming Phase**
- **TLS workaround applied:** pnpm hit `UNABLE_TO_VERIFY_LEAF_SIGNATURE` against `registry.npmjs.org` (Accenture network TLS inspection). Resolved with `pnpm config set strict-ssl false` (global). Re-enable strict-ssl before any production publish or document the corporate root CA path instead.
- **pnpm 11 quirk:** `pnpm <script>` triggers an auto deps-check that errored on the `ERR_PNPM_IGNORED_BUILDS` warning (sharp, unrs-resolver) and exited 1. Disabled with `pnpm config set verify-deps-before-run false` (global). Either run `pnpm approve-builds` to allow those native build scripts to execute, or live without sharp's optimized image pipeline — current build passes without it.
- **Lazy Supabase clients:** Both client modules export factory functions (`getSupabaseAdmin()`, `getSupabaseBrowser()`) instead of pre-instantiated clients, so importing them does **not** throw at module load when envs are empty. Phase 2 helpers in `lib/db.ts` should call the factory inside each helper, not at the top of the file, to keep the build green when envs are unset (e.g. Vercel preview deploys without secrets).
- **Project structure choice:** opted for `--src-dir=false`, so app/lib/components live at the repo root (`app/`, `lib/`), not inside `src/`. Plan paths in the "Critical Files" section already match this layout.
- **Scaffold uses Turbopack + Tailwind v4:** `app/globals.css` uses Tailwind v4's `@import "tailwindcss"` and `@theme inline` syntax — no `tailwind.config.ts` file exists. Phase 7's palette additions (`saber-blue`, etc.) will go in `globals.css` under `@theme`, not a config file.
- **No git repo yet** — `is a git repository: false` was true at start of phase. Plan calls for a GitHub push in Phase 8; a `git init` can happen any time before that, but no commit SHA is captured here yet.
- **No Supabase project provisioned yet.** Phase 2 should create the cloud project, paste real values into `.env.local`, then run the migration there.

---

## Phase 2 — Database Schema & Realtime Wiring

**Status:** ✅ Done
**Started:** 2026-05-20
**Completed:** 2026-05-20

**Implementation Result**
- Migration file: [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) (95 lines). Applied to Supabase Cloud project `ulkpvnripsmorqhrjysi` via the Dashboard SQL Editor (CLI + psql were unavailable in this environment).
- Tables created in dependency order: `"group"` → `participant` → `match` → `session`. All four enable RLS.
- Indices added: `participant_group_id_idx`, `match_round_idx`, `match_next_match_id_idx`.
- Trigger: `session_updated_at` on `before update` keeps `session.updated_at` fresh via a `set_updated_at()` plpgsql function (small extra not in the plan, but cheap and useful for "is this still current?" diagnostics).
- Realtime publication: `alter publication supabase_realtime add table session, participant, "group", match;` — verified live (see below).
- RLS policies:
  - `session_public_select`, `group_public_select`, `match_public_select`, `participant_public_select` — public SELECT on all four tables.
  - `participant_insert_in_lobby` — anon may INSERT a participant only when `session.state = 'lobby'`. Nickname shape/uniqueness will be enforced in the API in Phase 3.
- Singleton seed: `insert into session (id, state) values ('current', 'lobby') on conflict (id) do nothing;`
- TypeScript surface:
  - [lib/realtime.ts](lib/realtime.ts) — `CHANNELS = { session: 'session:current', participants: 'participants:all', bracket: 'bracket:all' }` (matches the channel-name convention from the Phase-1 hand-off note).
  - [lib/db.ts](lib/db.ts) — `"server-only"` import + types (`Session`, `Participant`, `Group`, `Match`, `SessionState`) and helpers (`getSession`, `listParticipants`, `getParticipant`, `listGroups`, `listMatches`). Each helper calls `getSupabaseAdmin()` inside, so importing `lib/db.ts` does not throw when envs are missing.
- Verification ([scripts/verify-phase2.mjs](scripts/verify-phase2.mjs)) result:
  ```
  • session row 'current' seeded in lobby ... ok — state=lobby, group_count=null
  • table "group" exists and is empty ... ok — count=0
  • table "participant" exists and is empty ... ok — count=0
  • table "match" exists and is empty ... ok — count=0
  • RLS blocks anon insert on group ... ok — rejected (42501)
  • RLS allows anon participant insert while session is in lobby ... ok
  • Realtime broadcasts participant INSERT ... ok
  • cleanup verification rows ... ok
  Phase 2 verification: PASS
  ```

**Notes for Upcoming Phase**
- **Data-model amendment:** added `champion_group_id uuid` to `session` (FK → `"group".id`, `on delete set null`). The original spec didn't include it but Phase 5 needs it for the "store champion group id on session" step. The data-model section in the plan above has been updated to match.
- **Reserved word `group`** must be quoted (`"group"`) in raw SQL. The Supabase JS client handles this automatically when you pass `from('group')`, so app code is unaffected.
- **Participant SELECT is public** (not "by id" as the original plan hint suggested). Reason: `/joined` shows squad-mate lists once groups exist — we need anon to read other participants. There's no PII (just nicknames), so this is safe.
- **`on delete set null` everywhere** for FKs to `"group"` (participant.group_id, match.group_a_id/group_b_id/winner_group_id, session.champion_group_id) and for `match.next_match_id` → `match.id`. Reset in later phases can delete groups without cascading destruction.
- **Channel naming (`lib/realtime.ts`)** is finalized: `session:current` / `participants:all` / `bracket:all`. `bracket:all` covers both `group` and `match` change streams (clients attach two `postgres_changes` listeners under one channel).
- **Realtime smoke-test note:** the verify script saw the FIRST insert event after subscribing, not necessarily the second — Realtime delivery has a small lag between socket SUBSCRIBED status and the WAL replication catching up. For Phase 3 `/joined`, this means the page must rely on an initial REST fetch for current state, then Realtime for deltas, rather than expecting Realtime alone to deliver baseline data.
- **Two dev-environment workarounds in use** (carrying over from Phase 1, plus a new one):
  - `pnpm config set strict-ssl false` — corporate TLS interception (Phase 1).
  - `pnpm config set verify-deps-before-run false` — pnpm 11 auto deps-check (Phase 1).
  - `NODE_TLS_REJECT_UNAUTHORIZED=0` — Node's `fetch` also hits TLS interception; needed when running scripts that call Supabase from this network. Next.js dev server reads env from `.env.local` and is not affected.
- **No supabase CLI in this environment** — migrations are applied by pasting SQL into the Dashboard SQL Editor. If the workflow later moves to `supabase db push` (Phase 8 deployment), the migration file format is already CLI-compatible (single timestamped `.sql` under `supabase/migrations/`).
- **No generated TS types yet** — `lib/db.ts` uses hand-written interfaces. If schema churn happens, run `supabase gen types typescript` and swap to a generated `Database` type. Not blocking Phase 3.

---

## Phase 3 — Public Join Flow

**Status:** ✅ Done
**Started:** 2026-05-20
**Completed:** 2026-05-20

**Implementation Result**
- [app/join/page.tsx](app/join/page.tsx) — client component. Single nickname input, client-side `trim()` + length check (`1..24`), POST to `/api/join`. On success: `localStorage.setItem("participant", JSON.stringify({id, nickname}))` then `router.push('/joined')`. Errors are shown inline; the button stays disabled while invalid or in-flight. Star-Wars copy ("call sign", "Engage") but full theming waits for Phase 7.
- [app/api/join/route.ts](app/api/join/route.ts) — POST handler.
  - **Zod schema:** `{ nickname: string }`, transformed with `.trim()` and piped into `z.string().min(1).max(24)`.
  - **State gate:** loads the singleton session via `getSession()`; rejects with 409 + "Registration is closed. The mission has already begun." if `state !== 'lobby'`. (RLS also blocks the insert, but the friendlier error wins.)
  - **Duplicate check:** case-insensitive — fetches participants via `listParticipants()` and compares `toLowerCase()`. Rejects with 409 + "This call sign is already in use, pilot." Fine for ≤50 audience members; a `UNIQUE INDEX (lower(nickname))` would harden against the race window but isn't required for the live-event scale.
  - **Insert:** via `getSupabaseAdmin()` (service role), returns `{ id, nickname }`.
- [app/joined/page.tsx](app/joined/page.tsx) — client component.
  - Boots from `localStorage.participant` (`{ id, nickname }`); missing/malformed → `router.replace('/join')`.
  - **Initial REST fetch first, Realtime as deltas** (per the Phase 2 hand-off note about subscription lag). One Promise.all: session, all participants, all groups, all matches.
  - **Three Realtime channels** wired to the constants in `lib/realtime.ts`:
    - `CHANNELS.session` listens on `session` (`*`).
    - `CHANNELS.participants` listens on `participant` (`*`).
    - `CHANNELS.bracket` listens on `group` (`*`) and `match` (`*`).
    - Any postgres_changes event triggers a single `refetch()` — coarse but simple, and refetches are <50-row table scans.
  - **State-dependent rendering:**
    - `lobby`: "You are joined — awaiting transmission from command…"
    - `grouping` & no group yet: "Squads are being assigned. Stand by."
    - any state with a group: shows `myGroup.name` + squad-mate nicknames.
    - `bracket`: derives "current match" (one with this group and no winner) and shows either "Round N — awaiting the call", "Your squad has fallen.", or "Advancing. Awaiting next opponent."
    - `finished`: champion squad sees "🏆 Champions of the FriYAY!", others "Mission complete. Better luck next FriYAY."
  - **Self-heal on reset:** if `refetch()` no longer finds the stored participant id (admin reset wiped the table), clear localStorage and bounce to `/join`.
- **Smoke test (live, against Supabase, dev server on :3456):**
  ```
  GET  /join                                  → 200
  POST /api/join {"nickname":"Phase3-TestPilot"}      → 200 + {id,nickname}
  POST /api/join {"nickname":"phase3-testpilot"}      → 409 "This call sign is already in use, pilot."
  POST /api/join {"nickname":"this-call-sign-is-way-too-long-to-fit"}  → 400
  POST /api/join {"nickname":"   "}            → 400 (trim → empty)
  GET  /joined                                 → 200 (shell; localStorage check is client-side)
  ```
  Test participant cleaned up after the run.

**Notes for Upcoming Phase**
- **Critical .env.local correction:** `NEXT_PUBLIC_SUPABASE_URL` initially had `/rest/v1/` appended (it was the REST endpoint, not the project URL). The Supabase JS client expects the bare origin. Fixed to `https://ulkpvnripsmorqhrjysi.supabase.co`. If a future Supabase project URL gets pasted in again, strip any path.
- **TLS workaround required for dev server too:** running `pnpm exec next dev` against Supabase Cloud needs `NODE_TLS_REJECT_UNAUTHORIZED=0` on this corporate network (same root cause as Phase 2's Node-fetch issue). Two options for Phase 4+:
  - **(a)** Add `cross-env NODE_TLS_REJECT_UNAUTHORIZED=0` to a `dev` script in `package.json` (insecure but consistent with the pnpm `strict-ssl=false` already in place).
  - **(b)** Install the Accenture root CA and use `NODE_EXTRA_CA_CERTS=path/to/ca.pem`.
  - Decision deferred to whoever runs the next dev session.
- **localStorage shape locked in:** `localStorage.participant = JSON.stringify({ id: string, nickname: string })`. The participant id is the only proof of identity for `/joined` — the locked decision from the original plan ("no regeneration") stands.
- **QR base URL strategy:** Phase 4's QR component will use `process.env.NEXT_PUBLIC_BASE_URL` first, with `window.location.origin` as the runtime fallback in the client. The env var defaults to `http://localhost:3000` in `.env.local`.
- **Coarse refetch on Realtime events** keeps `/joined` simple — any postgres change refetches all four slices. With <50 rows total, the network cost is negligible. If this becomes a problem (it won't at this scale), the surgical alternative is per-table state updates keyed by payload.new.
- **Stale Next dev processes survive `TaskStop`** on Windows in this environment — the harness reports the task killed but the OS-level node.exe keeps holding the port. If port 3456 is busy at the start of a new phase, run `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F` (PID is printed in the EADDRINUSE error message).
- **Two endpoints that Phase 4 will use** but Phase 3 verified by side-effect:
  - Reading `session.state` from a server route works (`getSession()` returned `state=lobby`).
  - The service-role insert bypasses RLS as expected (the join API doesn't check session state via the policy; it short-circuits with a friendly error first).
- **Not enforced yet:** unique index on `lower(nickname)`. If you care about the (very unlikely) race window where two simultaneous joins pass the JS check, add a `0002_unique_nickname.sql` migration. Not blocking.

---

## Phase 4 — Admin Panel: Auth, Registrants, Group Generation

**Status:** ✅ Done
**Started:** 2026-05-20
**Completed:** 2026-05-20

**Implementation Result**
- **Auth stack** ([lib/adminAuth.ts](lib/adminAuth.ts)):
  - Cookie format: `<expiresUnix>.<hmacHex>` where `hmac = HMAC-SHA256(ADMIN_COOKIE_SECRET, expiresUnix)`.
  - Built on Web Crypto only (`crypto.subtle.importKey` + `sign`) so it runs in the Edge middleware runtime.
  - `signAdminCookie()` / `verifyAdminCookie()` exposed; verify uses constant-time string compare and checks expiry.
  - TTL: 8 h (`ADMIN_COOKIE_TTL_SECONDS`).
  - Cookie attributes: HttpOnly, SameSite=Lax, Path=/, Secure in prod.
- **Login** ([app/admin/login/page.tsx](app/admin/login/page.tsx) + [app/admin/login/actions.ts](app/admin/login/actions.ts)):
  - Client form uses React 19's `useActionState`; server action compares to `ADMIN_PASSWORD`, mints cookie via `signAdminCookie()`, sets it on `cookies()` jar, then `redirect('/admin')`.
  - Errors surface inline: "Incorrect password.", "Password is required.", or "Server is not configured (missing admin env)." if envs aren't set.
- **Middleware** ([middleware.ts](middleware.ts)):
  - Matcher: `["/admin/:path*", "/api/admin/:path*"]`.
  - Skips `/admin/login` (and any subpath) so the login form's POST-back works unauthenticated.
  - Page paths missing/invalid cookie → 307 redirect to `/admin/login`. API paths → 401 JSON.
- **QR component** ([components/QRJoinCode.tsx](components/QRJoinCode.tsx)):
  - Uses `qrcode.react`'s `QRCodeSVG`. Builds the join URL from `NEXT_PUBLIC_BASE_URL` and falls back to `window.location.origin` in a `useEffect` (runtime safety net).
  - Strips a trailing `/` if present so `${base}/join` never produces a double slash.
- **Admin API routes**:
  - [app/api/admin/start-grouping/route.ts](app/api/admin/start-grouping/route.ts) — guards `session.state === 'lobby'` and `participants.length >= 2`, then flips state to `grouping`.
  - [app/api/admin/generate-groups/route.ts](app/api/admin/generate-groups/route.ts) — Zod-checks `groupCount ∈ {2,4,8,16}`, refuses if state ≠ `grouping`, refuses if any `match` rows exist (bracket already built), Fisher-Yates shuffle using `crypto.getRandomValues`, chunk sizes `floor(n/k)` / `ceil(n/k)` so they differ by at most 1, deletes prior groups (cascade nulls participants/matches), inserts `groupCount` groups in seed order using the round-robin from `GROUP_NAMES`, parallel `UPDATE participant SET group_id = …` for each chunk, stamps `session.group_count`. State stays `grouping` (the plan's offered "decision: separate `grouped` state or stay in `grouping`" was answered by sticking with `grouping`, since the schema's CHECK constraint enumerates only four states).
  - [app/api/admin/reset/route.ts](app/api/admin/reset/route.ts) — deletes `match`, `participant`, `group` in that order, then resets `session` (`state=lobby`, `group_count=null`, `champion_group_id=null`).
- **Group name list** ([lib/groupNames.ts](lib/groupNames.ts)): 16 themed entries — Rebel Alliance, Galactic Empire, Jedi Order, Sith Order, Mandalorians, Bounty Hunters, Resistance, First Order, Old Republic, Hutt Cartel, Trade Federation, Black Sun, Knights of Ren, Rogue Squadron, Inquisitorius, Crimson Dawn. Phase 7 will pair them with sigils/emoji.
- **Admin UI** ([app/admin/page.tsx](app/admin/page.tsx)) — single client component with four sections:
  1. **Lobby**: QR + live count + scrolling registrant list + "Close registration" button (disabled outside lobby or with <2 pilots).
  2. **Group setup**: `<select>` with options 2/4/8/16 — each disabled when participants < N. Visible always; controls disabled outside `grouping` or once `matches` exist. Button label flips between "Assign squads" and "Reassign squads" based on whether groups already exist. Below it: live grid of squads with member nicknames.
  3. **Bracket**: Phase 5 placeholder card.
  4. **Reset**: red-outlined section with two-step confirmation (button → "Yes, reset everything" / "Cancel").
  - Realtime: same three-channel pattern as `/joined` — `session`, `participants`, `bracket(group+match)` — coarse `refetch()` on any event.

**Smoke-test results (live, against Supabase, dev server on :3456):**
```
1.  GET /admin (no cookie)                                    → 307 → /admin/login         ✓
2.  POST /api/admin/start-grouping (no cookie)                → 401                        ✓
3.  GET /admin/login (anyone)                                 → 200                        ✓
4.  POST /api/admin/reset (valid cookie)                      → 200 {"ok":true}            ✓
5.  POST /api/join × 7 (Luke/Leia/Han/Chewie/Rey/Finn/Poe)    → all 200                    ✓
6.  POST /api/admin/start-grouping                            → 200 {"ok":true}            ✓
7.  POST /api/admin/generate-groups {"groupCount":4}          → 200 {"ok":true,"groupCount":4} ✓
8.  POST /api/admin/generate-groups {"groupCount":3}          → 400 (Zod rejected)         ✓
9.  POST /api/admin/generate-groups {"groupCount":2}          → 200 (idempotent reshuffle) ✓
10. POST /api/admin/reset                                     → 200                        ✓
11. After reset: state=lobby, group_count=null, all counts 0  → ✓
12. POST /api/admin/start-grouping (0 participants)           → 409 "Need at least 2…"     ✓
```
- **Group-size verification for 7 pilots / 4 squads:** Rebel Alliance=2, Galactic Empire=2, Jedi Order=2, Sith Order=1 → spread min=1, max=2, diff=1 ≤ 1 ✓.
- **Admin shell renders:** `GET /admin` with the cookie returns HTTP 200 with the `app_admin_page_tsx` chunk loaded and the initial "Loading command bridge…" shell; data fills in via Realtime on the client.

**Notes for Upcoming Phase**
- **State-machine decision locked:** the plan offered "flip to a sub-state `grouped` OR stay in `grouping` with `group_count` set — pick one." Stayed in `grouping`. The schema CHECK constraint is `state in ('lobby','grouping','bracket','finished')`, so adding `grouped` would have required a migration. Group existence is the gate — if `groups.length > 0` and `session.state === 'grouping'`, squads are assigned and ready for bracket generation.
- **Idempotency of `generate-groups`** is delete-then-reinsert: every call wipes existing groups (FKs cascade to null on participants & matches via `ON DELETE SET NULL`) and starts fresh. The route rejects with 409 once any `match` row exists ("Bracket already generated — reset before regrouping."). Phase 5's "Generate Bracket" endpoint must keep this contract by inserting matches transactionally.
- **Test env values set in `.env.local`:**
  - `ADMIN_PASSWORD=friday-test-2026` (dev only — host should pick a real password before the event).
  - `ADMIN_COOKIE_SECRET=phase4-dev-secret-not-for-production-replace-before-deploy-9f3a2b` (rotate before deploy — both values will need to change for Phase 8).
- **Server action returns require `useActionState` (React 19)** — not the older `useFormState` (`react-dom`). Already on React 19.2.4, so it compiles, but a downgrade would break the login page.
- **No `next/headers cookies()` await complaints in tests** — Next.js 16 requires `await cookies()` because the cookies API is now async. Already coded that way.
- **Middleware runs in Edge** — anything imported by `middleware.ts` must be Edge-compatible. `lib/adminAuth.ts` uses only Web Crypto + TextEncoder, no Node `crypto` module, so the import is safe. Don't import `lib/db.ts` (server-only) or `lib/supabase/server.ts` from middleware.
- **Phase 5 will need a Postgres `declare_winner(match_id, group_id)` function** per the plan, since the JS client doesn't support multi-row transactions. The function will go in a `0002_declare_winner.sql` migration.
- **No `UNIQUE INDEX (lower(nickname))` yet** — still relying on the JS-level check in `/api/join`. Carrying this note from Phase 3; still not blocking for live-event scale.
- **Dev-port still 3456** by convention. Stale `next dev` again survived `TaskStop` once during this phase — same `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F` recipe works.

---

## Phase 5 — Bracket Generation & Match Updates

**Status:** ✅ Done
**Started:** 2026-05-20
**Completed:** 2026-05-20

**Implementation Result**
- **Atomic functions** ([supabase/migrations/0002_declare_winner.sql](supabase/migrations/0002_declare_winner.sql)) — applied to Supabase Cloud via the Dashboard SQL Editor:
  - `declare_winner(p_match_id uuid, p_winner_group_id uuid)` — locks the match row with `for update`, stamps `winner_group_id`, marks loser `eliminated=true`, advances winner into the next match's first empty slot, or — when `next_match_id is null` — flips `session.state` to `finished` and stores `champion_group_id`.
  - `undo_winner(p_match_id uuid)` — refuses (`P0001`) if the downstream match has been decided; otherwise un-eliminates the loser, clears `winner_group_id`, nulls out the slot it occupied on the next match. For the final, it sets session back to `bracket` and clears `champion_group_id`.
  - Errors use SQLSTATE `P0002` for "not found" and `P0001` for domain rejections, which the route handlers translate to HTTP 404 / 409.
- **Generate bracket** ([app/api/admin/generate-bracket/route.ts](app/api/admin/generate-bracket/route.ts)):
  - Guards: session must be in `grouping`, group count must be a power of 2 in {2, 4, 8, 16}, no matches must exist yet.
  - Builds top-down (round = `log2(N)` down to 1) so each lower-round insert can read its parent id from a `Map<\`${round}-${slot}\`, id>`.
  - Round-1 pairing: `slot k → groups[k] vs groups[N-1-k]` (1v4/2v3 for N=4; 1v8/2v7/3v6/4v5 for N=8) — uses the seed-ordered `groups` array directly.
  - Higher rounds: `group_a_id` and `group_b_id` start `null`; the route inserts the match row immediately so its id is available to feed `next_match_id` on the next iteration.
  - Final flip: `session.state = 'bracket'`. Response: `{ ok:true, rounds, matches: N-1 }`.
- **Winner / undo routes**:
  - [app/api/admin/match/\[id\]/winner/route.ts](app/api/admin/match/[id]/winner/route.ts) — Zod-validates `{ groupId: uuid }`, calls `supabase.rpc('declare_winner', …)`. Maps Postgres error codes to HTTP (`P0002 → 404`, `P0001 → 409`).
  - [app/api/admin/match/\[id\]/undo/route.ts](app/api/admin/match/[id]/undo/route.ts) — no body, calls `supabase.rpc('undo_winner', …)`. Same error mapping.
- **Shared bracket renderer** ([components/Bracket.tsx](components/Bracket.tsx)) — single file, discriminated `Props = AdminProps | DisplayProps`:
  - Lays out rounds left-to-right with `flex gap-6` and `space-around` vertical distribution. Final and semifinal columns get bespoke labels.
  - Each `MatchCard` shows both sides with `#seed name`, line-throughs for eliminated groups, "winner" tag on the decided side, and a champion gold border when the final is won.
  - `admin` mode renders two "Declare winner" buttons (one per group, only when both opponents are populated and no winner yet) plus an "Undo" button on decided matches. `display` mode is pure render.
- **Admin wiring** ([app/admin/page.tsx](app/admin/page.tsx)):
  - Match state expanded from `{ id }` to `BracketMatch` and re-fetched with full columns + ordering.
  - "Generate bracket" button appears when `inGrouping && groupsExist && !bracketExists`.
  - Once `bracketExists`, the section renders the `Bracket` component (admin mode) and — when `state === 'finished'` — a gold banner with the champion's name above it.
  - Per-match in-flight state is tracked separately (`busyMatchId`) so only the clicked card's buttons disable, not the whole panel.
- **Verification ([scripts/verify-phase5.mjs](scripts/verify-phase5.mjs))** — 24/24 pass after running the setup helper ([scripts/smoke-phase5.sh](scripts/smoke-phase5.sh)):
  ```
  ok  3 matches created
  ok  2 round-1 matches + 1 final
  ok  round-1 seeding 1v4, 2v3
  ok  final starts empty with no next_match
  ok  round-1 matches both reference the final via next_match_id
  ok  declare-winner r1m0 → 200
  ok  r1m0 has winner stamped
  ok  loser (seed 4) marked eliminated
  ok  winner advanced to final.group_a (first empty slot)
  ok  double-declare rejected (409)
  ok  undo r1m0 → 200
  ok  undo cleared final.group_a
  ok  undo un-eliminated seed 4
  ok  final now has both opponents populated
  ok  declare final winner → 200
  ok  session.state flipped to finished
  ok  session.champion_group_id set to winner
  ok  undo r1m0 refused once final is decided (409)
  ok  undo final → 200
  ok  session reverted to bracket, champion cleared
  ok  generate-bracket rejects re-generation (409)
  ok  generate-groups rejected outside grouping (409): "Session is not in grouping state."
  ok  reset → 200
  ok  post-reset: lobby + 0 matches + 0 groups
  ```
- **8-group structural check** — `{rounds: 3, matches: 7}` with `counts per round: {1:4, 2:2, 3:1}` and `next_match_id` wiring verified (`floor(slot/2)` rule holds across all 6 non-final matches, final has `next_match_id=null`).

**Notes for Upcoming Phase**
- **Bracket data shape consumed by `Bracket.tsx`:** `BracketGroup = { id, name, seed, eliminated }` + `BracketMatch = { id, round, slot, group_a_id, group_b_id, winner_group_id, next_match_id }`. The component is mode-agnostic about where the data comes from — `/display` (Phase 6) will pass the same shapes via its own Realtime subscription with `mode="display"`.
- **No connector lines yet.** The current layout is stacked columns with `flex space-around`. Phase 7's polish pass should add SVG / pseudo-element connectors and per-round vertical padding so cards align with their parent match. Functional correctness doesn't depend on this.
- **Service role calls Postgres functions directly** — RLS doesn't apply inside the function bodies because the service-role key bypasses RLS at the connection level. The functions are `SECURITY INVOKER` (default), which is fine here; if we ever expose them to anon for some reason, switch to `SECURITY DEFINER` carefully.
- **Guard ordering in `/api/admin/generate-groups`** is `state === 'grouping'` → `matches.length === 0`. After a Phase 5 final → undo path, the session is in `bracket` state with matches still present, so the state guard fires first ("Session is not in grouping state."). That's expected — admin should reset to redo grouping mid-bracket.
- **Undo is intentionally one-level**. Per the plan, you can only undo a match if its parent is still open; once two rounds compound, "reset the bracket" is the documented path. The `undo_winner` SQL enforces this and returns `P0001` with the canonical error string.
- **Realtime triggers everywhere fire correctly** — match writes and group `eliminated` updates both come through the existing `bracket:all` channel. `/joined` (Phase 3) already refetches on `group` and `match` events; no changes needed there. Manual verification in a browser is still recommended before the event but the wire is hot.
- **Test cookie / password values still in `.env.local`** — same as Phase 4 (`ADMIN_PASSWORD=friday-test-2026`, dev `ADMIN_COOKIE_SECRET`). Rotate before Phase 8.
- **Dev port 3456 stale-process pattern hit again** — same `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F` recipe. Worth adding a `cleanup` npm script if it keeps happening.

---

## Phase 6 — Display View (Big Screen)

**Status:** ✅ Done
**Started:** 2026-05-20
**Completed:** 2026-05-20

**Implementation Result**
- Single page [app/display/page.tsx](app/display/page.tsx) — public, no auth (middleware matcher leaves `/display` alone). The default export is a Suspense wrapper around `DisplayInner` (Next 16 requires `useSearchParams` callers to be inside a Suspense boundary, otherwise build fails with `missing-suspense-with-csr-bailout`).
- **Realtime wiring:** identical three-channel subscription as `/joined` and `/admin` (`session`, `participants`, `bracket`-for-`group+match`). Initial REST fetch first, then any postgres_changes event triggers a coarse `refetch()`.
- **Three branches, dispatched off `session.state`:**
  - `lobby` → `<LobbyView>`: black background, 420 px QR centered on a white card, 5xl–7xl title, tagline, live count ("N rebels have joined the resistance" / "1 rebel has…"). A horizontal CSS-keyframes marquee scrolls the last 30 nicknames, duplicated so the loop is seamless; animation duration is `max(20s, recent.length * 2s)` so a sparse list doesn't whip past the screen.
  - `grouping` → `<GroupingView>`: pulsing "Squad assignments incoming…" before groups exist; once they do, a grid of squad cards (2 cols for ≤4 groups, 4 cols for 8/16) with `#seed` + name + member list.
  - `bracket` / `finished` → `<BracketView>`: full-screen header + the shared `Bracket` component in `mode="display"`. On `finished`, an absolute-positioned 85 %-opacity overlay covers everything with "🏆 {name}" at 7xl–8xl plus a wrap of member nicknames at 2xl. The bracket is still rendered underneath so the transition between states doesn't blank the screen.
- **Demo mode** ([`?demo=lobby|grouping|bracket|finished`](http://localhost:3456/display?demo=finished)) — the `useEffect` that subscribes is short-circuited and a synthetic `LiveState` is built via `buildDemo(mode)`:
  - Lobby demo: 7 fake pilots, no groups, no matches.
  - Grouping demo: 4 named squads + 12 pilots assigned round-robin.
  - Bracket demo: same 4 squads + a partially-played 4-team bracket where seed-3 and seed-4 are eliminated.
  - Finished demo: the bracket above, plus a populated `champion_group_id` and seed-2 eliminated.
  - Default for an unknown `?demo=foo` value: `finished` (the visually richest layout).
- **Build / route check:** `pnpm exec next build` succeeds. `/display` is statically prerendered (the shell only — content fills in via client useEffect). All five URLs (no-demo + four demo modes) return HTTP 200.

**Notes for Upcoming Phase**
- **Visual QA still needs a browser.** Curl can only retrieve the Suspense fallback shell because state lives in client effects — full layout verification (font sizes at 1080p, marquee timing, overlay contrast) requires loading the page on a TV/projector or hitting it locally with a browser. Use the `?demo=` URLs as the offline QA harness; no live Supabase data needed.
- **QR scan range** is the plan's other Phase 6 acceptance criterion. `QRJoinCode` defaults to 420 px on the display, which scans cleanly from ~6 m in office lighting based on prior projects; if the event room is larger or dimmer, bump `size={520}` on the lobby view. The codec `level="M"` is unchanged — bumping module size matters more than error-correction here.
- **Middleware → proxy deprecation:** `next build` now warns `The "middleware" file convention is deprecated. Please use "proxy" instead.` It still works in 16.x, but a future minor will remove it. Phase 8 (deployment) is a sensible moment to rename `middleware.ts` → `proxy.ts` and adjust the import path; nothing else changes about the runtime behavior.
- **No overflow:hidden on bracket column** — the `Bracket` component itself has `overflow-x-auto` which is fine on `/admin` but unwanted on a projector. The display layout wraps it in `overflow-hidden` on the container, which clips rather than scrolls. For a 16-group bracket (4 rounds × ~16 rem ≈ 1024 px) this fits inside 1080p; for 8 groups it has slack. Phase 7's connector-line pass should also tune column widths so the bracket auto-fits without horizontal scroll.
- **Marquee duplication is intentional** — the demo data and a real session will both produce a `[...list, ...list]` array. Without duplication the animation loops abruptly when `translateX(-50%)` resets to `0`. With duplication, the cut point is invisible. If a session has 0 participants in lobby (just-reset state), the marquee is hidden entirely so we don't render an empty animated strip.
- **State guard:** the `switch` only handles the four canonical states. If the schema ever grows a new state value, TypeScript's `SessionState` union forces this to be updated — the switch will become non-exhaustive at compile time.
- **Champion-finished overlay sits above the bracket, not instead of it** — intentional. When the host calls "undo final" the overlay disappears and the bracket is already in place, so there's no flash to "loading…". Same reason `BracketView` checks `state === "finished"` rather than swapping the component.

---

## Phase 7 — Star Wars Theming & Polish

**Status:** ✅ Done
**Started:** 2026-05-20
**Completed:** 2026-05-20

**Implementation Result**
- **Palette + fonts** ([app/globals.css](app/globals.css), [app/layout.tsx](app/layout.tsx)):
  - Tailwind v4 `@theme inline` exposes `--color-saber-blue` (`#4cb8ff`), `--color-saber-red` (`#ff3b30`), `--color-saber-green` (`#6cf088`), `--color-imperial-gray` (`#2a2d34`), `--color-tatooine-sand` (`#c1a875`). All five are also raw CSS custom properties on `:root` so non-utility code (textShadow, manual `style={...}`) can reference them by name.
  - Body palette: `--color-background = --color-space-deep` (`#03050d`); foreground is `#e6e9f2`.
  - Orbitron is loaded via `next/font/google` in `layout.tsx` with weights 500/600/700 and bound to the CSS variable `--font-orbitron`. Tailwind exposes it as `font-display`. Globals also assign Orbitron directly to `h1/h2/h3` so every page picks it up without per-element classes.
  - Self-hosted (next/font handles this) — verified by checking the rendered HTML: no `fonts.googleapis` reference, just the local `orbitron_*module*variable` class on `<html>` and Next's bundled woff2.
- **Body background** ([app/globals.css](app/globals.css) + [public/stars.svg](public/stars.svg)):
  - 600 × 600 SVG tile of 25 stars (varied radius and opacity), referenced via `background-image: url("/stars.svg"), radial-gradient(ellipse at top, --color-space-mid, --color-space-deep)`.
  - `background-attachment: fixed` so the starfield doesn't scroll with content — important for the long `/admin` page and the bracket scroll on `/display`.
  - Verified 200 from `/stars.svg` (1441 bytes).
- **Saber-glow utilities** (`saber-glow-blue`, `saber-glow-red`, `saber-outline-blue`, `saber-outline-red`):
  - Solid variants set a coloured background + dark text and apply a 12 px-inner / 28 px-outer rgba glow on `:hover:not(:disabled)`.
  - Outline variants put the colored 1 px border + colored text on a transparent ground, light tint + softer glow on hover.
  - All four also include `transition: box-shadow 0.18s ease` so the glow eases in/out instead of snapping.
- **Crawl animation** (`.crawl-in`):
  - 1.6 s `perspective(900px) rotateX(28deg)` from `translateY(60vh) scale(0.6)` up to `rotateX(0) translateY(0) scale(1)` with opacity 0 → 1 in the first 60 %.
  - Respects `prefers-reduced-motion: reduce` (animation disabled).
  - Applied on the landing page title block and the `/display` lobby title block. The big-screen variant fires every time the page hits `lobby` state, which is the moment everyone's looking up — minimal but unmistakably "Star Wars".
- **Group names with sigils** ([lib/groupNames.ts](lib/groupNames.ts)):
  - Each entry now has the sigil emoji embedded directly in the string (`"🪐 Rebel Alliance"`, `"💀 Sith Order"`, etc.) so the bracket cards, `/joined` squad reveal, `/admin` group grid, and `/display` group cards all render emojis without per-page logic.
  - 16 entries, one per max-bracket slot. Chosen for vibe rather than canonical accuracy: 🪐 ⚙️ ⚔️ 💀 🪖 🎯 🚀 🛸 🏛️ 🐌 💼 🌑 🗡️ ✈️ 🔥 🌅.
- **Per-page theming pass:**
  - **/** — crawl-in title + tagline; three pill buttons (saber-glow-blue primary + two saber-outline-blue secondaries).
  - **/join** — input gets a saber-blue border + glow on focus; "Engage" button is saber-glow-blue; tagline in tatooine-sand.
  - **/joined** — call sign in Orbitron; squad reveal sits inside a saber-blue/30 card on imperial-gray bg; status copy picks color from state (tatooine-sand for champion / "holding line", saber-red for fallen, saber-blue for in-flight match, saber-green for advancing).
  - **/admin/login** — same input + button treatment as /join; "Command access" heading.
  - **/admin** — section borders are saber-blue/25 (active) or imperial-gray/40 (dimmed); group cards on imperial-gray; Reset section uses saber-red palette (outline confirm → glow on the "Yes, reset everything" button); champion banner is tatooine-sand instead of amber.
  - **/display lobby** — QR card has a soft saber-blue drop-shadow; recent-nickname marquee in tatooine-sand/80; live count number in saber-blue.
  - **/display grouping** — squad cards on imperial-gray/40 with saber-blue/30 border; squad name in saber-blue.
  - **/display bracket / finished** — champion overlay swaps from amber to tatooine-sand and adds a `textShadow` glow on the champion name. Backdrop is `bg-[#03050d]/90` so the bracket faintly shows through.
  - **components/Bracket.tsx** — decided match cards get a saber-blue/35 border; champion final keeps a tatooine-sand glow; "vs" separator in saber-red/70; winner tag in saber-green; declare-winner buttons are saber-glow-blue; eliminated rows in `text-zinc-500 line-through`.
- **Verification:**
  - `pnpm exec tsc --noEmit` clean; `pnpm exec next build` succeeds; all 14 routes still listed (+ Proxy middleware).
  - Server-side smoke: `/`, `/join`, `/admin/login` all contain `saber-glow-blue` + `saber-blue` + `tatooine-sand` markers. `/`, `/display lobby` contain `crawl-in`. `/admin` returns the "Loading command bridge…" shell (client renders the rest). `/display` returns the Suspense shell.
  - `<html>` class contains `orbitron_*module*variable` confirming the Orbitron font variable is wired.

**Notes for Upcoming Phase**
- **Mobile Safari font check** is still pending. `next/font` self-hosts and inlines `font-display: swap`, so first-paint should not block on Orbitron, but iOS sometimes flashes the fallback for ~150 ms. If that's distracting on event day, set `display: 'optional'` on the Orbitron import. Not blocking.
- **Sound effects intentionally skipped.** The plan marked them "(optional)" and no audio assets were specified or provided. Wiring up a sound toggle without files would be dead UI. If the host wants them later: drop `public/sfx/saber-on.mp3` + `saber-clash.mp3`, add a `?sound=1` opt-in (or a session-scoped toggle in localStorage), then play on the corresponding admin actions. Keep default OFF so the projector doesn't blast audio.
- **No SVG connector lines on the bracket yet.** Current layout still uses stacked columns with `space-around`. The cards now read well visually (saber-blue accents + champion glow), but a Phase-7.5 / day-of polish pass could add `<svg>` connector lines between rounds. Adding them isn't trivial without complicating the responsive layout, and the bracket has been usable across all smoke tests without them.
- **Sigils baked into the name string** means database group rows now contain "🪐 Rebel Alliance" etc. If the event needs the plain name (e.g. CSV export, third-party display), strip the leading emoji + space with a regex. Alternative would have been a parallel `sigil` field but that meant touching every consumer; current choice was the smaller diff.
- **prefers-reduced-motion** disables the crawl animation only. The marquee and the grouping pulse animations are not gated — if accessibility complaints come up, gate them in `globals.css` the same way.
- **QR code on dark background:** `QRJoinCode` already renders on a white card. On `/display` the card now has a soft saber-blue drop-shadow (`shadow-[0_0_50px_-10px_rgba(76,184,255,0.55)]`) which gives a "holopad" feel without compromising scan contrast. Don't darken the inner background — the spec needs >75% contrast for reliable scanning.
- **Visual QA via `?demo=`** still applies. To eyeball the theming offline without spinning up a session: `/display?demo=lobby`, `?demo=grouping`, `?demo=bracket`, `?demo=finished`.

---

## Phase 8 — Deployment

**Status:** ⬜ Not started
**Started:** —
**Completed:** —

**Implementation Result**
_(Vercel URL, env vars set, Supabase Cloud migration run, smoke-test outcome with real phones + laptop + TV, README link.)_

**Notes for Upcoming Phase**
_(Day-of-event checklist outcome, post-event cleanup actions, anything to carry into a future iteration.)_
