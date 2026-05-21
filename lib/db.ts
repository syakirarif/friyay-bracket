import "server-only";

import { getSupabaseAdmin } from "./supabase/server";

// ---------- Types ----------

export type SessionState = "lobby" | "grouping" | "bracket" | "finished";

export interface Session {
  id: "current";
  state: SessionState;
  group_count: number | null;
  join_base_url: string | null;
  champion_group_id: string | null;
  match_duration_seconds: number;
  updated_at: string;
}

export interface Participant {
  id: string;
  nickname: string;
  group_id: string | null;
  joined_at: string;
}

export interface Group {
  id: string;
  name: string;
  seed: number;
  eliminated: boolean;
}

export interface Match {
  id: string;
  round: number;
  slot: number;
  group_a_id: string | null;
  group_b_id: string | null;
  winner_group_id: string | null;
  next_match_id: string | null;
  started_at: string | null;
  duration_seconds: number | null;
}

// ---------- Helpers ----------

export async function getSession(): Promise<Session> {
  const { data, error } = await getSupabaseAdmin()
    .from("session")
    .select("*")
    .eq("id", "current")
    .single();
  if (error) throw error;
  return data as Session;
}

export async function listParticipants(): Promise<Participant[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("participant")
    .select("*")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Participant[];
}

export async function getParticipant(id: string): Promise<Participant | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("participant")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Participant | null;
}

export async function listGroups(): Promise<Group[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("group")
    .select("*")
    .order("seed", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Group[];
}

export async function listMatches(): Promise<Match[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("match")
    .select("*")
    .order("round", { ascending: true })
    .order("slot", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Match[];
}
