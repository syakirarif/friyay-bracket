-- FriYAY May 2026 Game Bracket — initial schema, seed, realtime, RLS.
-- Apply against a fresh Supabase Cloud project.

create extension if not exists "pgcrypto";

-- ---------- Tables ----------

create table "group" (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  seed        int  not null,
  eliminated  boolean not null default false
);

create table participant (
  id         uuid primary key default gen_random_uuid(),
  nickname   text not null,
  group_id   uuid references "group"(id) on delete set null,
  joined_at  timestamptz not null default now()
);

create index participant_group_id_idx on participant(group_id);

create table match (
  id               uuid primary key default gen_random_uuid(),
  round            int  not null,
  slot             int  not null,
  group_a_id       uuid references "group"(id) on delete set null,
  group_b_id       uuid references "group"(id) on delete set null,
  winner_group_id  uuid references "group"(id) on delete set null,
  next_match_id    uuid references match(id)  on delete set null
);

create index match_round_idx           on match(round);
create index match_next_match_id_idx   on match(next_match_id);

create table session (
  id                 text primary key check (id = 'current'),
  state              text not null default 'lobby'
                       check (state in ('lobby','grouping','bracket','finished')),
  group_count        int,
  join_base_url      text,
  champion_group_id  uuid references "group"(id) on delete set null,
  updated_at         timestamptz not null default now()
);

-- Keep updated_at fresh on every session mutation.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger session_updated_at
  before update on session
  for each row execute function set_updated_at();

-- ---------- Singleton seed ----------

insert into session (id, state) values ('current', 'lobby')
  on conflict (id) do nothing;

-- ---------- Realtime publication ----------
-- Supabase Cloud auto-creates the `supabase_realtime` publication; we just
-- add the tables we want to broadcast. Re-running will error with
-- "relation is already member of publication" — that's expected.

alter publication supabase_realtime
  add table session, participant, "group", match;

-- ---------- Row-Level Security ----------

alter table session     enable row level security;
alter table participant enable row level security;
alter table "group"     enable row level security;
alter table match       enable row level security;

-- Public can read session/group/match. Mutations are server-side
-- via the service-role key, which bypasses RLS.
create policy "session_public_select"     on session     for select using (true);
create policy "group_public_select"       on "group"     for select using (true);
create policy "match_public_select"       on match       for select using (true);

-- Public can read participants (needed so /joined can render squad-mate lists
-- when groups are revealed).
create policy "participant_public_select" on participant for select using (true);

-- Public can INSERT a participant only while the session is in 'lobby'.
-- API layer validates nickname shape + uniqueness; RLS just gates the state.
create policy "participant_insert_in_lobby" on participant
  for insert
  with check (
    exists (select 1 from session where id = 'current' and state = 'lobby')
  );
