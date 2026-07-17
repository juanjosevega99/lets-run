// Descriptive-only data profile: counts and coverage of the ingested data, so F1
// can be written with the raw material in view. Deliberately makes NO modeling
// decisions (no stress scores, no "HR means TRIMP applies") — that judgment is F1's,
// the hand-written AI-free zone. This file only reports what exists.

export interface ActivityFacts {
  id: number;
  sportType: string;
  startDate: Date;
  hasStreams: boolean;
  hasHr: boolean;
  hasAltitude: boolean;
  hasDistanceStream: boolean;
}

export interface RaceFacts {
  id: number;
  activityId: number | null;
}

export interface Profile {
  totalActivities: number;
  dateRange: { from: Date; to: Date } | null;
  byType: { type: string; count: number }[];
  withStreams: number;
  withHr: number;
  withAltitude: number;
  withDistanceStream: number;
  races: { total: number; matched: number; unmatched: number };
}

export function buildProfile(activities: ActivityFacts[], races: RaceFacts[]): Profile {
  const byTypeMap = new Map<string, number>();
  let withStreams = 0;
  let withHr = 0;
  let withAltitude = 0;
  let withDistanceStream = 0;
  let from: Date | null = null;
  let to: Date | null = null;

  for (const a of activities) {
    byTypeMap.set(a.sportType, (byTypeMap.get(a.sportType) ?? 0) + 1);
    if (a.hasStreams) withStreams++;
    if (a.hasHr) withHr++;
    if (a.hasAltitude) withAltitude++;
    if (a.hasDistanceStream) withDistanceStream++;
    if (from === null || a.startDate < from) from = a.startDate;
    if (to === null || a.startDate > to) to = a.startDate;
  }

  const byType = [...byTypeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const matched = races.filter((r) => r.activityId !== null).length;

  return {
    totalActivities: activities.length,
    dateRange: from && to ? { from, to } : null,
    byType,
    withStreams,
    withHr,
    withAltitude,
    withDistanceStream,
    races: { total: races.length, matched, unmatched: races.length - matched },
  };
}

export function formatProfile(p: Profile): string {
  const lines: string[] = [];
  const pct = (n: number) => (p.totalActivities === 0 ? "0%" : `${Math.round((100 * n) / p.totalActivities)}%`);
  const range = p.dateRange
    ? `${isoDate(p.dateRange.from)} → ${isoDate(p.dateRange.to)}`
    : "no activities";

  lines.push("lets-run data profile");
  lines.push("─".repeat(40));
  lines.push(`activities:        ${p.totalActivities}   (${range})`);
  lines.push(`with GPS/streams:  ${p.withStreams}   (${pct(p.withStreams)})`);
  lines.push(`  with heart rate: ${p.withHr}   (${pct(p.withHr)} of all)`);
  lines.push(`  with elevation:  ${p.withAltitude}   (${pct(p.withAltitude)} of all)`);
  lines.push(`  with distance:   ${p.withDistanceStream}   (${pct(p.withDistanceStream)} of all)`);
  lines.push("");
  lines.push("by type:");
  const typeWidth = Math.max(0, ...p.byType.map((t) => t.type.length));
  for (const t of p.byType) {
    lines.push(`  ${t.type.padEnd(typeWidth)}  ${t.count}`);
  }
  lines.push("");
  lines.push(`races (backtest set): ${p.races.total}`);
  lines.push(`  matched to an activity: ${p.races.matched}`);
  lines.push(`  unmatched:              ${p.races.unmatched}`);
  return lines.join("\n");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
