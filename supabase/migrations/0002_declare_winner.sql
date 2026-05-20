-- Phase 5: atomic winner / undo functions.
-- Multi-row updates need to happen in one transaction, which the JS client
-- can't express; route handlers call these via supabase.rpc(…).

-- declare_winner(p_match_id, p_winner_group_id)
--   1. Stamp winner_group_id on the match.
--   2. Mark loser group eliminated.
--   3. Advance winner into next match's first empty slot, or finalize
--      the session if this was the final.

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
     set winner_group_id = p_winner_group_id
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

-- undo_winner(p_match_id)
--   Reverse declare_winner only when the downstream match (if any) has not
--   itself been decided. If the next round is already locked in, refuse.

create or replace function undo_winner(p_match_id uuid)
returns void as $$
declare
  v_match           match%ROWTYPE;
  v_loser_group_id  uuid;
  v_next            match%ROWTYPE;
begin
  select * into v_match from match where id = p_match_id for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if v_match.winner_group_id is null then
    raise exception 'Match has no winner to undo' using errcode = 'P0001';
  end if;

  if v_match.next_match_id is not null then
    select * into v_next from match where id = v_match.next_match_id for update;
    if v_next.winner_group_id is not null then
      raise exception 'Later rounds already decided — reset the bracket instead'
        using errcode = 'P0001';
    end if;
  end if;

  v_loser_group_id := case
    when v_match.winner_group_id = v_match.group_a_id then v_match.group_b_id
    else v_match.group_a_id
  end;

  update "group" set eliminated = false where id = v_loser_group_id;
  update match    set winner_group_id = null where id = p_match_id;

  if v_match.next_match_id is not null then
    update match
       set group_a_id = case when group_a_id = v_match.winner_group_id then null else group_a_id end,
           group_b_id = case when group_b_id = v_match.winner_group_id then null else group_b_id end
     where id = v_match.next_match_id;
  else
    update session
       set state = 'bracket',
           champion_group_id = null
     where id = 'current';
  end if;
end;
$$ language plpgsql;
