import type { ActivityMeta, Streams } from "../ingest/types.js";

const API_BASE = "https://www.strava.com/api/v3";

export interface StravaSummaryActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

interface StravaStreamSet {
  time?: { data: number[] };
  distance?: { data: number[] };
  altitude?: { data: number[] };
  heartrate?: { data: number[] };
}

/** Maps a Strava API summary activity to the same shape the CSV/FIT/GPX ingestors produce. */
export function mapSummaryActivity(a: StravaSummaryActivity): ActivityMeta {
  return {
    id: a.id,
    name: a.name,
    sportType: a.sport_type ?? a.type,
    startDate: new Date(a.start_date),
    elapsedTimeS: a.elapsed_time ?? null,
    movingTimeS: a.moving_time ?? null,
    distanceM: a.distance ?? null,
    elevationGainM: a.total_elevation_gain ?? null,
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    filename: null,
    raw: a,
  };
}

/** Fills missing channels with nulls so every stream array stays the same length as time. */
export function mapStreams(raw: StravaStreamSet): Streams {
  const timeS = raw.time?.data ?? [];
  const fill = (data: number[] | undefined): (number | null)[] =>
    timeS.map((_, i) => data?.[i] ?? null);
  return {
    timeS,
    distanceM: fill(raw.distance?.data),
    altitudeM: fill(raw.altitude?.data),
    heartrate: fill(raw.heartrate?.data),
  };
}

async function stravaFetch(path: string, accessToken: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 429) {
    throw new Error(
      "Strava API rate limit hit (15-min or daily cap). Wait and re-run `npm run strava:sync`.",
    );
  }
  return res;
}

/** Paginates /athlete/activities, returning everything strictly after `afterEpochS`. */
export async function fetchActivities(
  accessToken: string,
  afterEpochS: number,
): Promise<StravaSummaryActivity[]> {
  const all: StravaSummaryActivity[] = [];
  for (let page = 1; ; page++) {
    const res = await stravaFetch(
      `/athlete/activities?after=${afterEpochS}&per_page=200&page=${page}`,
      accessToken,
    );
    if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as StravaSummaryActivity[];
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}

/** Returns null when the activity has no streams at all (e.g. a manual/indoor entry). */
export async function fetchStreams(accessToken: string, activityId: number): Promise<Streams | null> {
  const res = await stravaFetch(
    `/activities/${activityId}/streams?keys=time,distance,altitude,heartrate&key_by_type=true`,
    accessToken,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Strava streams fetch failed: ${res.status} ${await res.text()}`);
  const raw = (await res.json()) as StravaStreamSet;
  if (!raw.time || raw.time.data.length === 0) return null;
  return mapStreams(raw);
}
