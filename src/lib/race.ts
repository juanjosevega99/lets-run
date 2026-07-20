import { dateInTimeZone } from "./time.js";

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

export function daysToRace(
  now: Date,
  timeZone: string = process.env.DASHBOARD_TZ ?? "America/Bogota",
): number {
  // This is a calendar countdown, not an elapsed-hours countdown. Using the raw
  // instant made the app lose a day at 19:00 Bogotá time when UTC crossed midnight.
  const today = Date.parse(`${dateInTimeZone(now, timeZone)}T00:00:00Z`);
  const race = Date.parse(`${RACE.dateIso}T00:00:00Z`);
  return Math.ceil((race - today) / 86_400_000);
}
