# Project: FriYAY May 2026 Game Bracket

**Tagline:** *May the FriYAY be with You!*

Live-event web app: host shows a QR, audience joins from phones with nicknames, app randomly assigns them to themed Star Wars squads, then runs a single-elimination bracket between those squads in real time.

## Status

Phases 1–7 complete; Phase 8 code-side prep done (rename to `proxy.ts`, README, git init at `main` / commit `3f4752a`). Live deploy to Vercel pending the host. Per-phase journal in [implementation_plan.md](implementation_plan.md).

## Source-of-truth docs

| Doc | What lives there |
|---|---|
| [implementation_plan.md](implementation_plan.md) | Design, data model, route table, per-phase journal entries with decisions + workarounds. **Treat as source of truth; update on scope change.** |
| [README.md](README.md) | Ops runbook: setup, deploy, env vars, day-of-event checklist, local-dev workarounds. |
| This file | Quick reference for future Claude sessions. |

## Locked decisions (do not re-litigate without the user)
- **Each group = one team** in the bracket. Declaring a winner advances the whole squad.
- **Group sizes may differ by ±1** when audience count doesn't divide evenly.
- **Admin auth:** single password from `ADMIN_PASSWORD` env var, gated by [proxy.ts](proxy.ts) (Edge runtime, HMAC-signed cookie via [lib/adminAuth.ts](lib/adminAuth.ts)).
- **Bracket size:** restricted to powers of 2 — admin picks **2, 4, 8, or 16** groups.
- **Single global session** at any time; admin can reset to start a fresh round.
- **Three UIs:** `/join` + `/joined` (audience phones), `/admin` (host laptop), `/display` (big-screen, read-only).
- **`session.state ∈ {lobby, grouping, bracket, finished}`.** No `grouped` sub-state — group existence is the readiness gate from `grouping` to bracket generation.
- **Atomic multi-row writes via Postgres functions**, not the JS client: `declare_winner` and `undo_winner` in [supabase/migrations/0002_declare_winner.sql](supabase/migrations/0002_declare_winner.sql). They use `FOR UPDATE` row locks + SQLSTATE `P0001`/`P0002` for domain/not-found errors, mapped to HTTP 409/404 by the route handlers.
- **Group names with sigils** baked into the string itself (e.g. `"🪐 Rebel Alliance"`) in [lib/groupNames.ts](lib/groupNames.ts) — DB rows store the full string. Strip the leading emoji + space if a plain name is needed.

## Stack

- Next.js 16.2.6 (App Router, Turbopack) · React 19.2.4 · TypeScript 5.9 · Tailwind v4
- Supabase JS 2.106 (`@supabase/supabase-js` + `@supabase/ssr`) — Postgres + Realtime
- `qrcode.react`, `zod`, `server-only`
- `next/font` (self-hosted Orbitron for headings)
- pnpm 11 · Hosting: Vercel + Supabase Cloud

## Realtime channels (defined in [lib/realtime.ts](lib/realtime.ts))

| Constant | Channel | Listeners |
|---|---|---|
| `CHANNELS.session` | `session:current` | `session` table |
| `CHANNELS.participants` | `participants:all` | `participant` table |
| `CHANNELS.bracket` | `bracket:all` | `group` + `match` tables |

`/joined`, `/admin`, `/display` all subscribe to the same three and coarse-refetch on any event.

## Theme tokens (in [app/globals.css](app/globals.css) via Tailwind v4 `@theme inline`)

`saber-blue` (primary), `saber-red` (destructive), `saber-green` (advancing), `imperial-gray` (surfaces), `tatooine-sand` (highlights/champion). Utility classes: `saber-glow-{blue,red}` and `saber-outline-{blue,red}` for hover-glow buttons. `.crawl-in` keyframe on landing + display lobby (motion-reduce safe). Starfield: [public/stars.svg](public/stars.svg) tiled with a radial gradient.

## Env vars

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Bare origin only** — no `/rest/v1/` suffix. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Keep inside files that import `"server-only"` (`lib/db.ts`, `lib/supabase/server.ts`, API routes). Never reach the browser. |
| `ADMIN_PASSWORD` | Host login. |
| `ADMIN_COOKIE_SECRET` | Long random string. HMAC-SHA256 key for the admin cookie. |
| `NEXT_PUBLIC_BASE_URL` | Origin used to build the QR's join URL. Local: `http://localhost:3000`. Production: Vercel origin. The QR `falls back to window.location.origin` at runtime, so a stale value still works on the same host. |

## File layout (after Phase 8)

```
app/
  page.tsx                       landing (crawl animation)
  join/page.tsx                  audience nickname form
  joined/page.tsx                audience live status
  admin/login/{page,actions}.ts  password form + server action
  admin/page.tsx                 host control bridge
  display/page.tsx               big screen (?demo=lobby|grouping|bracket|finished)
  api/
    join/route.ts                public — register
    admin/
      start-grouping/route.ts
      generate-groups/route.ts
      generate-bracket/route.ts
      reset/route.ts
      match/[id]/winner/route.ts   → rpc declare_winner
      match/[id]/undo/route.ts     → rpc undo_winner
components/
  Bracket.tsx                    shared (admin | display modes)
  QRJoinCode.tsx
lib/
  adminAuth.ts                   HMAC sign/verify (Edge-safe Web Crypto)
  db.ts                          typed helpers ("server-only")
  groupNames.ts                  16 themed squad names with sigils
  realtime.ts                    channel constants
  supabase/{server,browser}.ts   lazy factories
proxy.ts                         admin cookie gate (formerly middleware.ts)
supabase/migrations/
  0001_init.sql                  schema + RLS + realtime + seed
  0002_declare_winner.sql        atomic winner/undo functions
public/stars.svg                 starfield tile
scripts/
  verify-phase2.mjs              schema + Realtime smoke
  verify-phase5.mjs              bracket flow (24-check)
  smoke-phase5.sh                bracket setup helper
```

## Verification commands

```bash
pnpm exec tsc --noEmit              # type-check (silent = clean)
pnpm exec next build                # production build
NODE_TLS_REJECT_UNAUTHORIZED=0 node --env-file=.env.local scripts/verify-phase2.mjs
ADMIN_COOKIE=<value> NODE_TLS_REJECT_UNAUTHORIZED=0 node --env-file=.env.local scripts/verify-phase5.mjs
```

The verify scripts hit the live Supabase project (corp TLS workaround needed on Accenture network). They're re-runnable; phase 5 needs a populated bracket — run `scripts/smoke-phase5.sh` first.

## Dev-environment workarounds (recurring on this machine)

- **pnpm TLS interception** (Accenture): `pnpm config set strict-ssl false`.
- **Node `fetch` TLS interception**: prefix scripts with `NODE_TLS_REJECT_UNAUTHORIZED=0`. The Next dev server reading `.env.local` also needs this when calling Supabase.
- **pnpm 11 auto deps-check** errors on `ERR_PNPM_IGNORED_BUILDS` (sharp, unrs-resolver): `pnpm config set verify-deps-before-run false`.
- **Stale `next dev` on Windows** survives Ctrl-C and harness `TaskStop`. Find PID: `netstat -ano | findstr :3456`. Kill: `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F` (or nuke all: `taskkill /f /im node.exe`).
- **All four workarounds are dev-only** — never apply in CI / Vercel.

## What's intentionally deferred (with recipes in the journal)

- **SVG connector lines** between bracket rounds (Phase 5 / Phase 7 note). Functional without; visual polish only.
- **Sound effects** for declare-winner / generate-bracket (Phase 7 note). Plan marked optional; no audio assets specified.
- **`UNIQUE INDEX (lower(nickname))`** on `participant` (Phase 3 note). Race window between dup check and insert is rare at event scale.
- **CSV export** of participants + squads before reset (Phase 8 note). One-line SQL in the README.

## Conventions when changing the code

- **Edits to `session.state`'s allowed values must update the CHECK constraint** in `0001_init.sql` (currently `lobby | grouping | bracket | finished`).
- **Adding a column referenced from a Phase ≥5 surface** = bump migration number, don't edit `0001_init.sql` in place (already deployed). Example: `champion_group_id` was added in Phase 2 *before* deploy and lives in `0001`; anything after deploy needs a new file.
- **API routes mutate via the service-role client** (`getSupabaseAdmin()`), which bypasses RLS. Don't add `SECURITY DEFINER` to Postgres functions unless anon needs to call them.
- **Middleware/proxy must stay Edge-compatible** — only Web Crypto + `TextEncoder` in `lib/adminAuth.ts`. Don't import Node's `crypto` or anything from `lib/db.ts` from `proxy.ts`.
- **All three live views (`/joined`, `/admin`, `/display`) refetch coarsely** on any Realtime event. Keep that pattern — surgical state updates are not worth the complexity at ≤50 rows.
- **Dev port is 3456** by session convention (3000 was taken). Just `pnpm dev` for the event.

---

# Behavioral Guideline

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->