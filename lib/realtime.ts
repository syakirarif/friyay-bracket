// Centralized Supabase Realtime channel names.
// All three UIs (/join+/joined, /admin, /display) subscribe to the same
// channels so we only update names in one place.

export const CHANNELS = {
  session: "session:current",
  participants: "participants:all",
  bracket: "bracket:all",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
