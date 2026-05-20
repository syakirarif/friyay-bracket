# FriYAY May 2026 Game Bracket

> *May the FriYAY be with You!*

A live-event web app: host shows a QR, audience joins from phones with nicknames, app randomly assigns them to Star Wars-themed squads, then runs a single-elimination bracket between those squads in real time.

Authoritative design + history: [implementation_plan.md](implementation_plan.md).

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- Supabase Postgres + Realtime
- `qrcode.react` · `zod` · `next/font` (Orbitron)
- Hosting: Vercel (web) + Supabase Cloud (DB)

## Routes

| Path | Audience | Auth |
|---|---|---|
| `/` | anyone | — |
| `/join` | phone | — |
| `/joined` | phone | localStorage participant id |
| `/admin/login` | host | password |
| `/admin` | host | admin cookie (gated by `proxy.ts`) |
| `/display` | big screen | — |
| `/api/join` | public | — |
| `/api/admin/*` | host | admin cookie |

## First-time setup

1. **Create a Supabase project** at https://supabase.com/dashboard.
2. **Apply the migrations** in order via the project's SQL Editor:
   - [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) — schema, indices, seed, Realtime publication, RLS policies.
   - [supabase/migrations/0002_declare_winner.sql](supabase/migrations/0002_declare_winner.sql) — atomic `declare_winner` + `undo_winner` Postgres functions.
3. **Copy `.env.example` to `.env.local`** and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` — bare project URL, **no `/rest/v1/` suffix**.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key.
   - `SUPABASE_SERVICE_ROLE_KEY` — keep server-side only.
   - `ADMIN_PASSWORD` — host login.
   - `ADMIN_COOKIE_SECRET` — long random string for HMAC-signing the admin cookie.
   - `NEXT_PUBLIC_BASE_URL` — origin used to build the QR's join URL. Local dev: `http://localhost:3000`. Production: the Vercel URL.
4. **Install + run**:
   ```bash
   pnpm install
   pnpm dev
   ```
   Open http://localhost:3000.

## Deploy to Vercel

1. Push to GitHub.
2. Import the repo at https://vercel.com/new.
3. Add the six env vars above in **Project Settings → Environment Variables**. Set `NEXT_PUBLIC_BASE_URL` to your deployed origin (e.g. `https://friyay-bracket.vercel.app`).
4. Apply both `supabase/migrations/*.sql` files to the production Supabase project (or the same one you used in dev) via the SQL Editor. Realtime publication is set up by the migration itself.
5. Smoke-test on real hardware: laptop on `/admin/login`, TV/projector on `/display`, ≥2 phones on the QR code.

## Operations

### Start a fresh session
Click **Reset session** on `/admin`, or:
```bash
curl -X POST https://<host>/api/admin/reset -b "admin_auth=<value>"
```
Wipes participants, groups, and matches; returns the session to `lobby`.

### Rotate the admin password
1. Change `ADMIN_PASSWORD` in Vercel env vars (Production environment).
2. Optionally rotate `ADMIN_COOKIE_SECRET` at the same time — this immediately invalidates every issued admin cookie, forcing the host to re-login.
3. Redeploy (Vercel does this automatically on env var change).

### View logs
- **Vercel runtime logs**: https://vercel.com/<team>/friyay-bracket/logs (filter by route, e.g. `/api/admin/match/[id]/winner`).
- **Supabase logs**: https://supabase.com/dashboard/project/<ref>/logs/postgres-logs — useful when a Postgres function (`declare_winner` / `undo_winner`) surfaces a domain error.
- **Client errors**: open the host laptop devtools console while running the event.

### Visual QA without a real session
`/display` supports `?demo=lobby|grouping|bracket|finished` — injects fake data so the layout can be reviewed without coordinating live phones.

## Day-of-event checklist

- [ ] Laptop fully charged + plugged in.
- [ ] Confirm Wi-Fi capacity for ~50 simultaneous phone joins (router or hotspot — DCs/coworking guest Wi-Fi is usually fine, but verify).
- [ ] Open `/display` on the projector laptop **before** the audience arrives. Pre-load means no flash of blank during the intro.
- [ ] Dry-run with the host 30 minutes before showtime: 5–10 throwaway joins → close registration → assign 4 squads → generate bracket → click one winner → click reset. Catches both network and UX issues.
- [ ] Confirm QR scan range from the back of the room. Default 420 px; bump `size={520}` in [components/QRJoinCode.tsx](components/QRJoinCode.tsx) if a back-row phone struggles.
- [ ] If using a corporate laptop with TLS interception, set `NEXT_PUBLIC_BASE_URL` to the deployed URL (not localhost) so the QR works for phones on the venue Wi-Fi.
- [ ] Bookmark `/admin/login` on the host laptop; type the password once before the event so it's in autofill.

## Local dev notes

- **Stale dev process on port 3456:** `next dev` on Windows sometimes survives Ctrl-C / harness stop. Find the PID with `netstat -ano | findstr :3456` and `taskkill /PID <pid> /F`, or nuke them all with `taskkill /f /im node.exe`.
- **Corporate TLS interception** (we saw this on Accenture's network): pnpm and Node's `fetch` both reject the registry / Supabase certs.
  - For pnpm: `pnpm config set strict-ssl false` (or install the corp root CA).
  - For Node scripts hitting Supabase: prefix with `NODE_TLS_REJECT_UNAUTHORIZED=0`.
  - Neither is needed in CI / Vercel.
- **pnpm 11 auto deps-check** can fail with `ERR_PNPM_IGNORED_BUILDS`: `pnpm config set verify-deps-before-run false`.

## Project layout

```
app/
  page.tsx            landing
  join/page.tsx       audience nickname form
  joined/page.tsx     audience confirmation + live status
  admin/login/        host password form (server action)
  admin/page.tsx      host control bridge
  display/page.tsx    big-screen view (demo mode via ?demo=)
  api/
    join/             public — register participant
    admin/            host-only (gated by proxy.ts)
components/
  Bracket.tsx         shared bracket renderer (admin + display)
  QRJoinCode.tsx
lib/
  adminAuth.ts        HMAC cookie sign/verify (Edge-safe)
  db.ts               typed Supabase helpers (service-role)
  groupNames.ts       16 themed squad names with sigils
  realtime.ts         channel name constants
  supabase/           lazy server + browser clients
proxy.ts              admin cookie gate (formerly middleware.ts)
supabase/migrations/  schema + functions
public/
  stars.svg           starfield background tile
```

## Post-event

Optional: export participants and bracket data to CSV before clicking **Reset**. Not in scope for the v1 app — run a quick SQL query against Supabase if needed:

```sql
select p.nickname, g.name as squad, g.eliminated
from participant p
left join "group" g on g.id = p.group_id
order by g.seed, p.joined_at;
```
