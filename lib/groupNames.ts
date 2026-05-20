// 16 themed squad names with sigils. The bracket caps at 16 groups, so this
// list must stay at least that long. Order is the round-robin pick order used
// by /api/admin/generate-groups. The sigil emoji is part of the persisted
// name string, so /display and /joined render it automatically.

export const GROUP_NAMES: readonly string[] = [
  "🪐 Rebel Alliance",
  "⚙️ Galactic Empire",
  "⚔️ Jedi Order",
  "💀 Sith Order",
  "🪖 Mandalorians",
  "🎯 Bounty Hunters",
  "🚀 Resistance",
  "🛸 First Order",
  "🏛️ Old Republic",
  "🐌 Hutt Cartel",
  "💼 Trade Federation",
  "🌑 Black Sun",
  "🗡️ Knights of Ren",
  "✈️ Rogue Squadron",
  "🔥 Inquisitorius",
  "🌅 Crimson Dawn",
] as const;
