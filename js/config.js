/**
 * Task catalog — single source of truth for names, emoji, and durations.
 * ids are stable; do not change once shipped.
 */
export const TASKS = [
  { id: "rabbit", name: "Rabbit", emoji: "🐰", durationSeconds: 60 },
  { id: "monkey", name: "Monkey", emoji: "🐵", durationSeconds: 60 },
  { id: "grandma", name: "Grandma", emoji: "👵", durationSeconds: 60 },
  { id: "ishu", name: "ISHU", emoji: "🗣️", durationSeconds: 60 },
  { id: "ruler", name: "Ruler", emoji: "📏", durationSeconds: 120 },
  { id: "chew-right", name: "Chew right", emoji: "👉", durationSeconds: 120 },
  { id: "chew-left", name: "Chew left", emoji: "👈", durationSeconds: 120 },
];

export function getTaskById(id) {
  return TASKS.find((t) => t.id === id) ?? null;
}
