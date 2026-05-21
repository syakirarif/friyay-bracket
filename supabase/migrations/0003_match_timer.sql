-- Phase 9: per-match timer.
--   session.match_duration_seconds  : admin-configured default (seconds)
--   match.started_at                 : NULL = idle, set when admin clicks Start
--   match.duration_seconds           : snapshot of session default at start time
--                                      (so editing the global default mid-match
--                                       doesn't change an already-running clock)

alter table session
  add column if not exists match_duration_seconds int not null default 300;

alter table match
  add column if not exists started_at       timestamptz;

alter table match
  add column if not exists duration_seconds int;

-- Update declare_winner: also clear the timer fields on the winning match.
-- All other behavior identical to 0002.

create or replace function declare_winner(
  p_match_id uuid,
  p_winner_group_id uuid
) returns void as $$
declare
  v_match           match%ROWTYPE;
  v_loser_group_id  uuid;
  v_next            match%ROWTYPE;
begin
  select * into v_match from match where id = p_match_id for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if v_match.winner_group_id is not null then
    raise exception 'Match already decided' using errcode = 'P0001';
  end if;
  if v_match.group_a_id is null or v_match.group_b_id is null then
    raise exception 'Match has no opponents yet' using errcode = 'P0001';
  end if;
  if p_winner_group_id <> v_match.group_a_id
     and p_winner_group_id <> v_match.group_b_id then
    raise exception 'Winner is not a participant in this match' using errcode = 'P0001';
  end if;

  v_loser_group_id := case
    when p_winner_group_id = v_match.group_a_id then v_match.group_b_id
    else v_match.group_a_id
  end;

  update match
     set winner_group_id  = p_winner_group_id,
         started_at       = null,
         duration_seconds = null
   where id = p_match_id;

  update "group"
     set eliminated = true
   where id = v_loser_group_id;

  if v_match.next_match_id is not null then
    select * into v_next from match where id = v_match.next_match_id for update;
    if v_next.group_a_id is null then
      update match set group_a_id = p_winner_group_id where id = v_match.next_match_id;
    elsif v_next.group_b_id is null then
      update match set group_b_id = p_winner_group_id where id = v_match.next_match_id;
    else
      raise exception 'Next match has no empty slot' using errcode = 'P0001';
    end if;
  else
    update session
       set state = 'finished',
           champion_group_id = p_winner_group_id
     where id = 'current';
  end if;
end;
$$ language plpgsql;
