/**
 * The competitive target — display constants sourced from PRD §0 "The target".
 * If the PRD numbers change (e.g. after pulling 2024/2025 bracket data), update BOTH.
 */
export const RACE = {
  name: "Patagonia Running Festival 21K (Huemul)",
  dateIso: "2027-04-24",
  distanceM: 21097.5,
  bracket: "Varones 18-29",
  /** Win the bracket: beat the 2026 bracket-winning time. */
  targetTimeS: 5834, // 1:37:14
  benchmarks2026: [
    { label: "1st 18-29 (2nd overall)", timeS: 5834 },
    { label: "2nd 18-29", timeS: 7148 }, // 1:59:08
    { label: "3rd 18-29", timeS: 7215 }, // 2:00:15
    { label: "1st overall (30-39)", timeS: 5556 }, // 1:32:36
  ],
} as const;

export function daysToRace(now: Date): number {
  const race = new Date(`${RACE.dateIso}T00:00:00Z`);
  return Math.ceil((race.getTime() - now.getTime()) / 86_400_000);
}
