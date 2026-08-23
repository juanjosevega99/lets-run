/** Shared shell for the athlete-facing dashboard. */
export function layout(title: string, activePath: string, body: string): string {
  const tabs: [string, string][] = [
    ["/", "Overview"],
    ["/week", "Plan"],
    ["/zones", "Zones"],
    ["/trajectory", "Progress"],
  ];
  const nav = tabs
    .map(([href, label]) => {
      const active = href === activePath ? ' class="active" aria-current="page"' : "";
      return `<a href="${href}"${active}>${label}</a>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#143f35">
<title>${title}</title>
<style>
  :root {
    color-scheme: light;
    --ink: #17312b;
    --ink-strong: #102a24;
    --muted: #68736e;
    --muted-strong: #52615b;
    --pine: #143f35;
    --pine-soft: #e6efeb;
    --orange: #e7623b;
    --accent-text: #b74427;
    --orange-soft: #fff0e9;
    --paper: #f4f5f1;
    --surface: #ffffff;
    --surface-soft: #f8faf7;
    --line: #dce2dd;
    --line-strong: #c9d2cc;
    --shadow: 0 14px 42px rgba(23, 49, 43, .08);
    --radius: 20px;
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); scroll-behavior: smooth; }
  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    color: var(--ink);
    background:
      radial-gradient(circle at 88% -5%, rgba(231, 98, 59, .09), transparent 25rem),
      var(--paper);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "tnum" 1;
  }
  a, button, summary { -webkit-tap-highlight-color: transparent; }
  a { color: inherit; }
  button { font: inherit; }
  :focus-visible { outline: 3px solid rgba(231, 98, 59, .38); outline-offset: 3px; }
  .skip-link {
    position: fixed; left: 1rem; top: .75rem; z-index: 100; transform: translateY(-160%);
    padding: .6rem .85rem; border-radius: 10px; color: white; background: var(--pine);
  }
  .skip-link:focus { transform: translateY(0); }
  .site-header {
    position: sticky; top: 0; z-index: 20;
    border-bottom: 1px solid rgba(220, 226, 221, .9);
    background: rgba(244, 245, 241, .92);
    backdrop-filter: blur(16px);
  }
  .header-inner {
    width: min(1120px, calc(100% - 2.5rem)); min-height: 76px; margin-inline: auto;
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 1.25rem;
  }
  .brand { display: inline-flex; align-items: center; gap: .72rem; width: max-content; text-decoration: none; }
  .brand-mark {
    width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center;
    color: white; border-radius: 12px; background: var(--pine); box-shadow: 0 7px 18px rgba(20, 63, 53, .18);
  }
  .brand-mark svg { width: 26px; height: 26px; }
  .brand-copy { display: grid; line-height: 1.1; }
  .brand-copy strong { color: var(--ink-strong); font-size: .96rem; letter-spacing: -.01em; }
  .brand-copy span { margin-top: .24rem; color: var(--muted); font-size: .69rem; letter-spacing: .08em; text-transform: uppercase; }
  nav { display: flex; align-items: center; gap: .25rem; padding: .25rem; border: 1px solid var(--line); border-radius: 999px; background: rgba(255, 255, 255, .75); }
  nav a {
    min-height: 38px; display: inline-flex; align-items: center; padding: .4rem .9rem;
    border-radius: 999px; color: var(--muted-strong); font-size: .86rem; font-weight: 650; text-decoration: none;
  }
  nav a:hover { color: var(--pine); background: var(--pine-soft); }
  nav a.active { color: white; background: var(--pine); box-shadow: 0 5px 12px rgba(20, 63, 53, .16); }
  .header-actions { justify-self: end; display: flex; align-items: center; gap: .7rem; }
  #refresh {
    min-height: 42px; padding: .55rem .9rem; border: 1px solid var(--pine); border-radius: 12px;
    color: white; background: var(--pine); cursor: pointer; font-size: .84rem; font-weight: 700;
    box-shadow: 0 7px 16px rgba(20, 63, 53, .14); transition: transform .16s ease, background .16s ease;
  }
  #refresh:hover:not(:disabled) { transform: translateY(-1px); background: #0e352c; }
  #refresh:disabled { opacity: .62; cursor: progress; }
  #refresh[data-busy="true"]::before { content: ""; display: inline-block; width: .7rem; height: .7rem; margin-right: .5rem; border: 2px solid rgba(255,255,255,.4); border-top-color: white; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sync-feedback { width: min(1120px, calc(100% - 2.5rem)); margin: .75rem auto 0; }
  #refresh-status { color: var(--muted-strong); font-size: .86rem; }
  #refresh-details { margin-top: .55rem; }
  #refresh-log {
    max-height: 15rem; overflow-y: auto; margin: .5rem 0 0; padding: .75rem .9rem;
    border: 1px solid var(--line); border-radius: 12px; color: var(--muted-strong); background: var(--surface);
    font: .78rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
  }
  main { width: min(1120px, calc(100% - 2.5rem)); margin-inline: auto; padding: 3.2rem 0 4.5rem; }
  h1, h2, h3, p { margin-top: 0; }
  h1 { max-width: 18ch; margin-bottom: .75rem; color: var(--ink-strong); font-size: clamp(2rem, 4vw, 3.35rem); line-height: 1.04; letter-spacing: -.045em; }
  h2 { margin-bottom: .35rem; color: var(--ink-strong); font-size: clamp(1.3rem, 2.2vw, 1.7rem); line-height: 1.2; letter-spacing: -.025em; }
  h3 { margin-bottom: .35rem; color: var(--ink-strong); font-size: 1rem; line-height: 1.3; }
  p { margin-bottom: 1rem; }
  .eyebrow { margin: 0 0 .65rem; color: var(--accent-text); font-size: .76rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
  .sub, .section-copy { color: var(--muted); }
  .sub { font-size: .87rem; }
  .page-head { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1.7rem; }
  .page-head h1 { margin-bottom: 0; }
  .page-head .section-copy { max-width: 38rem; margin: 0; }
  .panel { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: 0 1px 0 rgba(23, 49, 43, .02); }
  .overview-hero {
    position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(290px, .75fr);
    min-height: 390px; margin-bottom: 3.2rem; border: 0; color: white; background: var(--pine); box-shadow: var(--shadow);
  }
  .overview-hero::after { content: ""; position: absolute; right: -9rem; bottom: -13rem; width: 28rem; height: 28rem; border: 1px solid rgba(255,255,255,.11); border-radius: 50%; box-shadow: 0 0 0 4rem rgba(255,255,255,.025), 0 0 0 8rem rgba(255,255,255,.02); }
  .hero-copy { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; padding: clamp(1.7rem, 4vw, 3.25rem); }
  .hero-copy h1 { max-width: 14ch; color: white; }
  .hero-kicker { margin-bottom: 1rem; color: #bcd1c9; font-size: .88rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .hero-meta { color: #c7d7d1; }
  .countdown { display: flex; align-items: baseline; gap: .7rem; margin-top: 2.2rem; }
  .countdown strong { font-size: clamp(3.3rem, 8vw, 5.75rem); line-height: .8; letter-spacing: -.07em; }
  .countdown span { color: #c7d7d1; font-size: .92rem; }
  .goal-card { position: relative; z-index: 1; align-self: stretch; margin: 1rem; padding: 1.65rem; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; background: rgba(255,255,255,.09); backdrop-filter: blur(8px); }
  .goal-card .eyebrow { color: #ffab90; }
  .goal-time { margin: .3rem 0 .1rem; font-size: clamp(2.25rem, 5vw, 3.25rem); font-weight: 800; line-height: 1; letter-spacing: -.055em; }
  .goal-label { color: #c7d7d1; font-size: .85rem; }
  .hero-metrics { display: grid; gap: .85rem; margin-top: 1.65rem; }
  .hero-metric { padding-top: .9rem; border-top: 1px solid rgba(255,255,255,.14); }
  .hero-metric span { display: block; color: #bcd1c9; font-size: .75rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .hero-metric strong { display: block; margin-top: .1rem; font-size: 1.23rem; }
  .hero-metric small { display: block; margin-top: .18rem; color: #ffb59d; font-size: .75rem; }
  .section-block { margin-top: 3.2rem; }
  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 1.25rem; margin-bottom: 1.1rem; }
  .section-heading p { max-width: 38rem; margin: 0; }
  .coach-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(270px, .75fr); gap: 1rem; }
  .next-session, .week-glance, .chart-panel, .goal-strip, .coach-note { padding: clamp(1.25rem, 3vw, 1.8rem); }
  .next-session { position: relative; overflow: hidden; }
  .next-session::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--orange); }
  .session-topline, .panel-topline { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1.2rem; }
  .session-date { color: var(--muted); font-size: .86rem; font-weight: 700; }
  .session-title { margin-bottom: .45rem; font-size: clamp(1.35rem, 3vw, 1.85rem); }
  .session-description { max-width: 48rem; margin: 0; color: var(--muted-strong); }
  .session-dose { margin: 1.4rem 0 .35rem; color: var(--ink-strong); font-size: 2.1rem; font-weight: 800; line-height: 1; letter-spacing: -.04em; }
  .pill { display: inline-flex; align-items: center; min-height: 27px; padding: .25rem .58rem; border-radius: 999px; color: var(--pine); background: var(--pine-soft); font-size: .72rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
  .pill--accent { color: #a33a1d; background: var(--orange-soft); }
  .pill--muted { color: var(--muted-strong); background: #edf0ed; }
  .glance-list { display: grid; gap: 1rem; margin: 1.1rem 0 0; }
  .glance-item { display: flex; justify-content: space-between; gap: 1rem; padding-top: .85rem; border-top: 1px solid var(--line); }
  .glance-item span { color: var(--muted); font-size: .86rem; }
  .glance-item strong { color: var(--ink-strong); text-align: right; }
  .insight-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .insight-card { min-height: 170px; padding: 1.35rem; }
  .insight-card .k { color: var(--muted); font-size: .8rem; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
  .insight-card .v { margin: .65rem 0 .25rem; color: var(--ink-strong); font-size: 1.85rem; font-weight: 800; line-height: 1; letter-spacing: -.04em; }
  .insight-card p { margin: .65rem 0 0; color: var(--muted); font-size: .87rem; }
  /* ---- zone view ---- */
  .zone-answer { display: grid; grid-template-columns: 1fr 1fr; gap: 0; overflow: hidden; margin-top: 1rem; }
  .zone-answer-cell { padding: 1.3rem 1.35rem; }
  .zone-answer-cell + .zone-answer-cell { border-left: 1px solid var(--line); }
  .zone-answer-cell .k { color: var(--muted); font-size: .78rem; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
  .zone-answer-v { margin: .5rem 0 .3rem; font-size: 2.05rem; font-weight: 800; line-height: 1; letter-spacing: -.04em; color: var(--pine); font-variant-numeric: tabular-nums; }
  .zone-answer-cell--accent .zone-answer-v { color: #1f6d4c; }
  .zone-unit { font-size: .46em; font-weight: 700; color: var(--muted); letter-spacing: 0; }
  .zone-answer-cell p { margin: 0; color: var(--muted); font-size: .84rem; }

  .ladder { display: flex; flex-direction: column; gap: .55rem; }
  .zone-row {
    display: grid; grid-template-columns: 4px minmax(0, 1fr) auto; gap: 0 .9rem; align-items: center;
    padding: .85rem 1rem .85rem .8rem; border: 1px solid var(--line); border-radius: 14px; background: var(--surface);
  }
  .zone-accent { align-self: stretch; width: 4px; min-height: 34px; border-radius: 2px; background: var(--line-strong); }
  .zone-row--recovery  .zone-accent { background: #2a78d6; }
  .zone-row--easy      .zone-accent { background: #1f7d57; }
  .zone-row--moderate  .zone-accent { background: #d98a3d; }
  .zone-row--threshold .zone-accent { background: #c2452f; }
  .zone-row--target { border-color: #1f7d57; background: rgba(31,125,87,.07); }
  .zone-row--target h3 { color: #1f6d4c; }
  .zone-main h3 { margin: 0 0 .12rem; font-size: .96rem; }
  .zone-main p { margin: 0; color: var(--muted); font-size: .83rem; }
  .zone-tag { margin-left: .5rem; vertical-align: .1em; }
  .zone-nums { text-align: right; display: flex; flex-direction: column; gap: .1rem; white-space: nowrap; }
  .zone-nums strong { font-size: .95rem; font-variant-numeric: tabular-nums; }
  .zone-nums span { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; }

  .zone-trend { margin-top: .9rem; padding: .8rem .6rem .4rem; overflow-x: auto; }
  .zone-trend svg { display: block; width: 100%; height: auto; min-width: 300px; }
  .zone-trend-bar { fill: #d98a3d; }
  .zone-trend-bar--hit { fill: #1f7d57; }
  .zone-trend-target { stroke: #1f7d57; stroke-width: 1.5; stroke-dasharray: 5 4; }
  .zone-trend-axis { stroke: var(--line-strong); stroke-width: 1; }
  .zone-trend-tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }

  .zone-runs { display: flex; flex-direction: column; gap: .8rem; }
  .zone-run { display: flex; flex-direction: column; gap: .35rem; }
  .zone-run-meta { display: flex; justify-content: space-between; align-items: baseline; gap: .75rem; font-size: .82rem; }
  .zone-run-date { font-weight: 750; color: var(--muted-strong); }
  .zone-run-stat { color: var(--muted); font-size: .79rem; font-variant-numeric: tabular-nums; }
  .zone-stack { display: flex; gap: 2px; height: 26px; border-radius: 6px; overflow: hidden; background: var(--surface-soft); }
  .zone-seg { display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden; }
  .zone-seg span { color: white; font-size: .69rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .zone-seg--recovery  { background: #2a78d6; }
  .zone-seg--easy      { background: #1f7d57; }
  .zone-seg--moderate  { background: #d98a3d; }
  .zone-seg--threshold { background: #c2452f; }
  .zone-legend { display: flex; flex-wrap: wrap; gap: .4rem 1rem; margin-bottom: .2rem; }
  .zone-legend-item { display: inline-flex; align-items: center; gap: .38rem; color: var(--muted-strong); font-size: .78rem; font-variant-numeric: tabular-nums; }
  .zone-swatch { width: 11px; height: 11px; border-radius: 3px; flex: none; }
  .zone-combined { margin-top: 1rem; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: .55rem; }
  .zone-combined h3 { margin: 0; font-size: .95rem; }
  .zone-combined .sub { margin: 0; font-size: .85rem; }

  .readiness-card { border-left: 4px solid var(--line-strong); }
  .readiness-card.tone-calm { border-left-color: #2f8f6b; }
  .readiness-card.tone-warn { border-left-color: #d98a3d; }
  .readiness-card.risk-building_base { border-left-color: var(--line-strong); }
  .readiness-card.risk-low { border-left-color: #2f8f6b; }
  .readiness-card.risk-optimal { border-left-color: #1f7d57; }
  .readiness-card.risk-low .v, .readiness-card.risk-optimal .v { color: #1f6d4c; }
  .readiness-card.risk-elevated { border-left-color: #d98a3d; }
  .readiness-card.risk-elevated .v { color: #b56a1e; }
  .readiness-card.risk-high { border-left-color: #cc4b37; background: var(--orange-soft); }
  .readiness-card.risk-high .v { color: #b23a22; }
  .empty { margin: 0; padding: 1.1rem 1.2rem; border: 1px dashed var(--line-strong); border-radius: 14px; color: var(--muted-strong); background: var(--surface-soft); }
  details { border-radius: 14px; }
  details > summary { min-height: 44px; display: flex; align-items: center; gap: .5rem; color: var(--muted-strong); cursor: pointer; font-size: .88rem; font-weight: 750; list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::after { content: "+"; margin-left: auto; color: var(--muted); font-size: 1.1rem; font-weight: 500; }
  details[open] > summary::after { content: "−"; }
  .details-panel { margin-top: 1rem; padding: .6rem 1.2rem 1rem; border: 1px solid var(--line); background: rgba(255,255,255,.62); }
  .details-body { padding: .35rem 0 .15rem; }
  .technical-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin: .8rem 0; }
  .technical-value { padding: .75rem; border-radius: 12px; background: var(--surface-soft); }
  .technical-value strong { display: block; color: var(--ink-strong); font-size: 1.15rem; }
  .technical-value span { color: var(--muted); font-size: .76rem; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
  table { width: 100%; border-collapse: collapse; font-size: .87rem; }
  th, td { padding: .7rem .85rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  th { color: var(--muted); background: var(--surface-soft); font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  code { padding: .12rem .32rem; border-radius: 5px; color: var(--muted-strong); background: #edf0ed; font-size: .84em; }
  .freshness { display: flex; align-items: center; gap: .5rem; margin: 1rem 0 0; color: var(--muted); font-size: .8rem; }
  .freshness::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #4d917b; }
  .plan-summary { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: 1rem; }
  .schedule-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
  .day-card { min-height: 210px; padding: 1rem .9rem; border: 1px solid var(--line); border-radius: 16px; background: rgba(255,255,255,.72); }
  .day-card--key { border-color: rgba(231,98,59,.48); background: linear-gradient(180deg, var(--orange-soft), white 42%); box-shadow: 0 10px 28px rgba(231,98,59,.09); }
  .day-name { display: block; color: var(--ink-strong); font-size: .86rem; font-weight: 800; }
  .day-date { display: block; margin-top: .08rem; color: var(--muted); font-size: .73rem; }
  .day-sessions { display: grid; gap: .65rem; margin-top: 1rem; }
  .planned-session { padding-top: .7rem; border-top: 1px solid var(--line); }
  .planned-session:first-child { padding-top: 0; border-top: 0; }
  .planned-session--strength { margin-inline: -.25rem; padding: .65rem; border: 0; border-radius: 10px; background: var(--surface-soft); }
  .planned-session h3 { margin: .32rem 0 .28rem; font-size: .88rem; }
  .planned-session p { margin: 0; color: var(--muted-strong); font-size: .86rem; line-height: 1.48; }
  .planned-dose { display: block; margin-top: .45rem; color: var(--ink-strong); font-size: .8rem; font-weight: 800; }
  .open-day { margin-top: 1rem; color: var(--muted); font-size: .78rem; }
  .coach-note { margin-top: 1rem; display: grid; grid-template-columns: auto 1fr; gap: .9rem; align-items: start; background: var(--pine-soft); border-color: #ccddd6; }
  .coach-note-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; color: white; background: var(--pine); font-weight: 800; }
  .coach-note p { margin: .25rem 0 0; color: var(--muted-strong); }
  .logged-list { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--surface); }
  .logged-row { display: grid; grid-template-columns: 4rem minmax(0, 1fr) auto; gap: 1rem; align-items: center; padding: .9rem 1rem; border-bottom: 1px solid var(--line); }
  .logged-row:last-child { border-bottom: 0; }
  .logged-day { color: var(--muted); font-size: .78rem; font-weight: 800; text-transform: uppercase; }
  .logged-name strong, .logged-name span { display: block; }
  .logged-name span { color: var(--muted); font-size: .78rem; }
  .logged-stats { color: var(--muted-strong); font-size: .83rem; text-align: right; }
  .goal-strip { display: grid; grid-template-columns: 1.4fr repeat(3, minmax(0, 1fr)); gap: 1.2rem; align-items: center; margin-bottom: 1rem; }
  .goal-strip h2 { margin: 0; }
  .goal-strip .goal-copy p { margin: .35rem 0 0; color: var(--muted); font-size: .84rem; }
  .compact-metric { padding-left: 1.1rem; border-left: 1px solid var(--line); }
  .compact-metric span { display: block; color: var(--muted); font-size: .73rem; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
  .compact-metric strong { display: block; margin-top: .2rem; color: var(--ink-strong); font-size: 1.25rem; }
  .chart-panel { overflow: hidden; }
  .chart-wrap { min-width: 0; margin-top: 1.2rem; overflow-x: auto; overscroll-behavior-inline: contain; }
  .chart-wrap svg { display: block; width: 100%; min-width: 600px; height: auto; overflow: visible; }
  .chart-grid { stroke: var(--line); stroke-width: 1; }
  .chart-bar { fill: #78a294; }
  .chart-bar--latest { fill: var(--orange); }
  .chart-ref { stroke: var(--pine); stroke-width: 1.5; stroke-dasharray: 6 5; }
  .chart-label { fill: var(--muted); font-size: 10px; }
  .chart-ref-label { fill: var(--pine); font-size: 10px; font-weight: 700; }
  footer { width: min(1120px, calc(100% - 2.5rem)); margin: 0 auto 2rem; color: var(--muted); font-size: .76rem; }

  @media (max-width: 940px) {
    .header-inner { grid-template-columns: auto 1fr auto; }
    .brand-copy span { display: none; }
    .overview-hero { grid-template-columns: 1fr .72fr; }
  }
  @media (max-width: 720px) {
    .site-header { position: static; }
    .header-inner { width: min(100% - 1.25rem, 1120px); min-height: auto; grid-template-columns: 1fr auto; gap: .75rem; padding: .7rem 0 .55rem; }
    .brand-mark { width: 35px; height: 35px; }
    .header-actions { grid-column: 2; grid-row: 1; }
    #refresh { min-height: 40px; padding-inline: .72rem; }
    nav { grid-column: 1 / -1; grid-row: 2; width: 100%; display: grid; grid-template-columns: repeat(4, 1fr); }
    nav a { justify-content: center; min-height: 40px; padding-inline: .4rem; }
    .sync-feedback, main, footer { width: min(100% - 1.25rem, 1120px); }
    main { padding: 2rem 0 3.5rem; }
    .page-head, .section-heading { display: block; }
    .page-head .section-copy, .section-heading p { margin-top: .6rem; }
    .overview-hero { grid-template-columns: 1fr; min-height: 0; margin-bottom: 2.5rem; }
    .overview-hero::after { right: -15rem; bottom: -15rem; }
    .hero-copy { min-height: 335px; }
    .goal-card { margin: 0 1rem 1rem; }
    .coach-grid, .insight-grid { grid-template-columns: 1fr; }
    .insight-card { min-height: 0; }
    .technical-grid { grid-template-columns: repeat(2, 1fr); }
    .schedule-grid { grid-template-columns: repeat(2, 1fr); }
    .zone-answer { grid-template-columns: 1fr; }
    .zone-answer-cell + .zone-answer-cell { border-left: 0; border-top: 1px solid var(--line); }
    .goal-strip { grid-template-columns: 1fr 1fr; }
    .goal-copy { grid-column: 1 / -1; }
    .compact-metric { padding-left: 0; border-left: 0; }
  }
  @media (max-width: 560px) {
    /* Phones (incl. iPhone 16 Pro Max at 440pt) get a single-column agenda. A 2-up grid
       stretches a short day (e.g. a strength-only Monday) to match a taller neighbour,
       leaving a big half-empty card; full-width, content-height rows read as a clean
       schedule instead. */
    .schedule-grid { grid-template-columns: 1fr; }
    .day-card { min-height: 0; }
  }
  @media (max-width: 430px) {
    .brand-copy { display: none; }
    .hero-copy { min-height: 310px; }
    .countdown { margin-top: 1.4rem; }
    .technical-grid { grid-template-columns: 1fr 1fr; }
    .logged-row { grid-template-columns: 3rem minmax(0, 1fr); gap: .65rem; }
    .logged-stats { grid-column: 2; text-align: left; }
    .goal-strip { grid-template-columns: 1fr 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/" aria-label="lets-run overview">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none"><path d="M4 23 11 12l4 6 4-9 9 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 26c5-3 9-3 13 0 3 2 7 2 11-1" stroke="#ffab90" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="brand-copy"><strong>lets-run</strong><span>Patagonia 21K</span></span>
    </a>
    <nav aria-label="Primary">${nav}</nav>
    <div class="header-actions"><button id="refresh" type="button">Update training</button></div>
  </div>
</header>
<section id="refresh-feedback" class="sync-feedback" hidden>
  <span id="refresh-status" role="status" aria-live="polite"></span>
  <details id="refresh-details" hidden><summary>Technical details</summary><pre id="refresh-log"></pre></details>
</section>
<main id="main">${body}</main>
<footer>lets-run · updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</footer>
<script>
(function () {
  var btn = document.getElementById("refresh");
  var feedback = document.getElementById("refresh-feedback");
  var status = document.getElementById("refresh-status");
  var details = document.getElementById("refresh-details");
  var logEl = document.getElementById("refresh-log");
  btn.addEventListener("click", async function () {
    btn.disabled = true;
    btn.dataset.busy = "true";
    feedback.hidden = false;
    details.hidden = true;
    status.textContent = "Updating activities, fitness, and next week’s plan…";
    try {
      var res = await fetch("/actions/refresh", { method: "POST" });
      var data = await res.json();
      logEl.textContent = (data.log || []).join("\\n") + (data.error ? "\\n" + data.error : "");
      details.hidden = !logEl.textContent;
      if (data.ok) {
        status.textContent = "Training is up to date. Reloading…";
        setTimeout(function () { location.reload(); }, 700);
        return;
      }
      details.open = true;
      status.textContent = "Update stopped at " + (data.failedStep || "an unknown step") + ".";
    } catch (e) {
      status.textContent = "Could not update training: " + e.message;
    }
    btn.disabled = false;
    btn.dataset.busy = "false";
  });
  var chart = document.querySelector(".chart-wrap");
  function alignChartToLatest() {
    if (chart && chart.scrollWidth > chart.clientWidth) chart.scrollLeft = chart.scrollWidth;
  }
  if (document.readyState === "complete") {
    requestAnimationFrame(alignChartToLatest);
  } else {
    addEventListener("load", function () { requestAnimationFrame(alignChartToLatest); }, { once: true });
  }
})();
</script>
</body>
</html>`;
}
