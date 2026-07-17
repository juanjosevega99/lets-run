export interface ActivityMeta {
  id: number;
  name: string;
  sportType: string;
  startDate: Date;
  elapsedTimeS: number | null;
  movingTimeS: number | null;
  distanceM: number | null;
  elevationGainM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Path of the track file inside the export, e.g. "activities/123.fit.gz". Null for gym etc. */
  filename: string | null;
  /** Full original record (CSV row or API JSON), kept verbatim in activities.raw */
  raw: unknown;
}

/**
 * Parallel arrays, one entry per track point.
 * Null entries mean the sensor/value was missing at that point.
 */
export interface Streams {
  timeS: number[];
  distanceM: (number | null)[];
  altitudeM: (number | null)[];
  heartrate: (number | null)[];
}
