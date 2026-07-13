import { parse } from "csv-parse/sync";
import type { ActivityMeta } from "./types.js";

/**
 * Parses the activities.csv from a Strava bulk export.
 *
 * Quirks handled here:
 * - The export has DUPLICATE column headers ("Distance", "Elapsed Time" appear twice:
 *   first the formatted value, then a raw one). We keep every column by suffixing
 *   repeats ("Distance", "Distance_2") and read from the FIRST occurrence, whose units
 *   are stable (Distance in km, times in seconds).
 *   NOTE: assumed units pending verification against the real export — if the backfill
 *   numbers look off by x1000, this is the first place to look.
 * - Dates look like "Jul 7, 2018, 5:04:11 PM" and are UTC without saying so.
 */
export function parseActivitiesCsv(csv: string): ActivityMeta[] {
  const rows: string[][] = parse(csv, {
    relax_column_count: true,
    skip_empty_lines: true,
  });
  const header = rows[0];
  if (!header) return [];

  const names = dedupeHeader(header);
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    names.forEach((name, i) => {
      row[name] = cells[i] ?? "";
    });
    return toMeta(row);
  });
}

function dedupeHeader(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  });
}

function toMeta(row: Record<string, string>): ActivityMeta {
  const id = num(row["Activity ID"]);
  if (id === null) {
    throw new Error(`activities.csv row without Activity ID: ${JSON.stringify(row)}`);
  }
  const distanceKm = num(row["Distance"]);
  return {
    id,
    name: row["Activity Name"]?.trim() || "(untitled)",
    sportType: row["Activity Type"]?.trim() || "Unknown",
    startDate: parseExportDate(row["Activity Date"] ?? ""),
    elapsedTimeS: num(row["Elapsed Time"]),
    movingTimeS: num(row["Moving Time"]),
    distanceM: distanceKm === null ? null : distanceKm * 1000,
    elevationGainM: num(row["Elevation Gain"]),
    avgHr: num(row["Average Heart Rate"]),
    maxHr: num(row["Max Heart Rate"]),
    filename: row["Filename"]?.trim() || null,
    raw: row,
  };
}

/** Strava export dates are UTC, formatted like "Jul 7, 2018, 5:04:11 PM". */
export function parseExportDate(value: string): Date {
  const d = new Date(`${value} UTC`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`unparseable Activity Date: "${value}"`);
  }
  return d;
}

function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
