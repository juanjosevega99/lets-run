/** "1:39:24" for >= 1h, "42:20" below. Rounds to whole seconds. */
export function formatDuration(totalS: number): string {
  const t = Math.round(totalS);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/** Pace in min/km as "4:42/km" from meters and seconds. Null when not computable. */
export function formatPace(distanceM: number | null, timeS: number | null): string | null {
  if (!distanceM || !timeS || distanceM <= 0 || timeS <= 0) return null;
  const secPerKm = timeS / (distanceM / 1000);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  const mm = s === 60 ? m + 1 : m;
  const ss = s === 60 ? 0 : s;
  return `${mm}:${String(ss).padStart(2, "0")}/km`;
}

/** ISO date (YYYY-MM-DD) from a Date, in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD from a Postgres DATE column, which postgres.js may hand back as a
 * midnight-UTC Date. String() would render it in LOCAL time and shift a day back
 * (UTC−5) — always go through UTC.
 */
export function dateOnly(value: unknown): string {
  if (value instanceof Date) return isoDate(value);
  return String(value).slice(0, 10);
}
