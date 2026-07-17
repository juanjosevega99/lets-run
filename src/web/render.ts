import type { Profile } from "../profile/buildProfile.js";

export interface RaceDisplay {
  name: string;
  raceDate: string; // YYYY-MM-DD
  distanceKm: number;
  officialTimeS: number;
  terrain: string;
}

/**
 * Renders the read-only dashboard (F2.5): what already computes from ingested data.
 * No prediction/plan yet — those wait for F1/F2. Self-contained HTML, mobile-friendly,
 * no external assets, so it works the same on laptop and phone.
 */
export function renderDashboard(profile: Profile, races: RaceDisplay[]): string {
  const range = profile.dateRange
    ? `${iso(profile.dateRange.from)} → ${iso(profile.dateRange.to)}`
    : "no activities yet";
  const pct = (n: number) => (profile.totalActivities === 0 ? 0 : Math.round((100 * n) / profile.totalActivities));

  const coverage = [
    ["with GPS/streams", profile.withStreams],
    ["with heart rate", profile.withHr],
    ["with elevation", profile.withAltitude],
    ["with distance", profile.withDistanceStream],
  ] as const;

  const coverageRows = coverage
    .map(
      ([label, n]) => `
      <div class="bar-row">
        <span class="bar-label">${esc(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct(n)}%"></span></span>
        <span class="bar-num">${n} · ${pct(n)}%</span>
      </div>`,
    )
    .join("");

  const typeRows = profile.byType
    .map((t) => `<tr><td>${esc(t.type)}</td><td class="num">${t.count}</td></tr>`)
    .join("");

  const raceSection =
    races.length === 0
      ? `<p class="empty">No races imported yet. This is the backtest set (T0) — fill
         <code>races.csv</code> with official times and run <code>npm run races:import</code>.</p>`
      : `<table>
           <thead><tr><th>date</th><th>race</th><th class="num">km</th><th class="num">time</th><th>terrain</th></tr></thead>
           <tbody>${races
             .map(
               (r) => `<tr>
                 <td>${esc(r.raceDate)}</td>
                 <td>${esc(r.name)}</td>
                 <td class="num">${r.distanceKm.toFixed(1)}</td>
                 <td class="num">${fmtTime(r.officialTimeS)}</td>
                 <td>${esc(r.terrain)}</td>
               </tr>`,
             )
             .join("")}</tbody>
         </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lets-run</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 1.5rem;
         max-width: 720px; margin-inline: auto; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub { opacity: .65; margin: 0 0 1.5rem; font-size: .9rem; }
  section { margin-bottom: 2rem; }
  h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em; opacity: .6;
       border-bottom: 1px solid currentColor; padding-bottom: .3rem; }
  .big { font-size: 2rem; font-weight: 600; }
  .bar-row { display: grid; grid-template-columns: 8.5rem 1fr auto; gap: .6rem;
             align-items: center; margin: .4rem 0; font-size: .9rem; }
  .bar-track { background: color-mix(in srgb, currentColor 15%, transparent); border-radius: 3px; height: .7rem; }
  .bar-fill { display: block; height: 100%; background: seagreen; border-radius: 3px; }
  .bar-num { font-variant-numeric: tabular-nums; opacity: .8; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid
           color-mix(in srgb, currentColor 12%, transparent); }
  th { opacity: .6; font-weight: 500; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { opacity: .7; font-size: .9rem; }
  code { background: color-mix(in srgb, currentColor 12%, transparent); padding: .1rem .3rem; border-radius: 3px; }
  footer { opacity: .5; font-size: .8rem; margin-top: 2rem; }
</style>
</head>
<body>
  <h1>lets-run</h1>
  <p class="sub">read-only data view · prediction &amp; plan come after F1/F2</p>

  <section>
    <h2>Activities</h2>
    <p class="big">${profile.totalActivities}</p>
    <p class="sub">${esc(range)}</p>
    ${coverageRows}
  </section>

  <section>
    <h2>By type</h2>
    <table><tbody>${typeRows}</tbody></table>
  </section>

  <section>
    <h2>Races · backtest set (${races.length})</h2>
    ${raceSection}
  </section>

  <footer>lets-run · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</footer>
</body>
</html>`;
}

function fmtTime(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
