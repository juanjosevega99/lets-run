import { parse } from "csv-parse/sync";

export interface RaceRecord {
  name: string;
  raceDate: string; // YYYY-MM-DD
  distanceM: number;
  officialTimeS: number;
  terrain: "road" | "trail" | "track";
  elevationGainM: number | null;
  resultsUrl: string | null;
  notes: string | null;
}

const TERRAINS = new Set(["road", "trail", "track"]);

/**
 * Parses the hand-maintained race inventory CSV (T0) into validated records.
 * Uses human-friendly units (km, H:MM:SS) and converts to storage units (m, s).
 * Comment lines (starting with #) and blank lines are ignored. Throws with the
 * offending row on any invalid field — a silently-dropped race would quietly
 * shrink the backtest set, which is worse than a loud failure.
 */
export function parseRacesCsv(csv: string): RaceRecord[] {
  const rows: Record<string, string>[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    comment: "#",
  });

  return rows.map((row, i) => toRecord(row, i + 2)); // +2: header is line 1, data starts at 2
}

function toRecord(row: Record<string, string>, line: number): RaceRecord {
  const name = req(row, "name", line);
  const terrain = req(row, "terrain", line).toLowerCase();
  if (!TERRAINS.has(terrain)) {
    fail(line, `terrain must be road|trail|track, got "${row["terrain"]}"`);
  }

  return {
    name,
    raceDate: parseDate(req(row, "date", line), line),
    distanceM: parseKm(req(row, "distance_km", line), line) * 1000,
    officialTimeS: parseClock(req(row, "official_time", line), line),
    terrain: terrain as RaceRecord["terrain"],
    elevationGainM: optionalNum(row["elevation_gain_m"], "elevation_gain_m", line),
    resultsUrl: opt(row["results_url"]),
    notes: opt(row["notes"]),
  };
}

function parseDate(value: string, line: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(line, `date must be YYYY-MM-DD, got "${value}"`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) fail(line, `invalid date "${value}"`);
  return value;
}

function parseKm(value: string, line: number): number {
  const n = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) fail(line, `distance_km must be a positive number, got "${value}"`);
  return n;
}

/** Accepts H:MM:SS or MM:SS, returns total seconds. */
export function parseClock(value: string, line: number): number {
  const parts = value.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
    fail(line, `official_time must be H:MM:SS or MM:SS, got "${value}"`);
  }
  const nums = parts.map(Number);
  const [h, m, s] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  if (m! > 59 || s! > 59) fail(line, `minutes/seconds must be 0-59 in "${value}"`);
  return h! * 3600 + m! * 60 + s!;
}

function req(row: Record<string, string>, key: string, line: number): string {
  const v = row[key]?.trim();
  if (!v) fail(line, `missing required column "${key}"`);
  return v!;
}

function opt(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function optionalNum(value: string | undefined, key: string, line: number): number | null {
  const v = value?.trim();
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) fail(line, `${key} must be a number if present, got "${value}"`);
  return n;
}

function fail(line: number, message: string): never {
  throw new Error(`races CSV line ${line}: ${message}`);
}
