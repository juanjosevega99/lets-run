/**
 * Shared page shell + nav for the three PRD screens (Now / This week / Trajectory).
 * Functional, not "Apple-grade" — polish is gated behind F-A/F-B per PRD §1 F-C.
 */
export function layout(title: string, activePath: string, body: string): string {
  const tabs: [string, string][] = [
    ["/", "Now"],
    ["/week", "This week"],
    ["/trajectory", "Trajectory"],
  ];
  const nav = tabs
    .map(([href, label]) => {
      const active = href === activePath ? ' class="active"' : "";
      return `<a href="${href}"${active}>${label}</a>`;
    })
    .join("");

  // The Sunday action: sync Strava → recompute fitness → regenerate next week.
  const refresh = `<button id="refresh" type="button">Sync &amp; replan</button>
<span id="refresh-status" class="sub"></span>
<pre id="refresh-log" hidden></pre>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 1.25rem;
         max-width: 760px; margin-inline: auto; }
  nav { display: flex; gap: .25rem; margin-bottom: 1.5rem; border-bottom: 1px solid
        color-mix(in srgb, currentColor 15%, transparent); }
  nav a { padding: .5rem .9rem; text-decoration: none; color: inherit; opacity: .6;
          border-bottom: 2px solid transparent; }
  nav a.active { opacity: 1; border-bottom-color: seagreen; font-weight: 600; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  h2 { font-size: .95rem; text-transform: uppercase; letter-spacing: .05em; opacity: .6;
       border-bottom: 1px solid currentColor; padding-bottom: .3rem; margin-top: 2rem; }
  .big { font-size: 2.2rem; font-weight: 700; line-height: 1.1; }
  .sub { opacity: .65; font-size: .9rem; margin: .15rem 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
           gap: .75rem; margin: .75rem 0; }
  .card { border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
          border-radius: 8px; padding: .75rem; }
  .card .v { font-size: 1.4rem; font-weight: 600; }
  .card .k { font-size: .8rem; opacity: .65; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid
           color-mix(in srgb, currentColor 12%, transparent); }
  th { opacity: .6; font-weight: 500; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { opacity: .7; font-size: .9rem; border: 1px dashed
           color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px;
           padding: .9rem; }
  .target { border-left: 4px solid seagreen; padding: .5rem .9rem; margin: .75rem 0; }
  code { background: color-mix(in srgb, currentColor 12%, transparent);
         padding: .1rem .3rem; border-radius: 3px; }
  svg { max-width: 100%; height: auto; }
  footer { opacity: .5; font-size: .8rem; margin-top: 2.5rem; }
  .actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap;
             margin: 0 0 1.5rem; }
  button { font: inherit; font-size: .9rem; padding: .45rem .9rem; border-radius: 6px;
           border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
           background: color-mix(in srgb, seagreen 18%, transparent); color: inherit;
           cursor: pointer; }
  button:hover:not(:disabled) { background: color-mix(in srgb, seagreen 30%, transparent); }
  button:disabled { opacity: .55; cursor: progress; }
  #refresh-log { font-size: .78rem; line-height: 1.45; white-space: pre-wrap;
                 max-height: 15rem; overflow-y: auto; padding: .6rem .75rem; margin: 0 0 1.5rem;
                 border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
                 background: color-mix(in srgb, currentColor 6%, transparent); }
</style>
</head>
<body>
<nav>${nav}</nav>
<div class="actions">${refresh}</div>
${body}
<footer>lets-run · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</footer>
<script>
(function () {
  var btn = document.getElementById("refresh");
  var status = document.getElementById("refresh-status");
  var logEl = document.getElementById("refresh-log");
  btn.addEventListener("click", async function () {
    btn.disabled = true;
    status.textContent = "syncing Strava, recomputing fitness, replanning…";
    logEl.hidden = true;
    try {
      var res = await fetch("/actions/refresh", { method: "POST" });
      var data = await res.json();
      logEl.textContent = (data.log || []).join("\\n") + (data.error ? "\\n" + data.error : "");
      logEl.hidden = false;
      if (data.ok) {
        status.textContent = "done — reloading…";
        setTimeout(function () { location.reload(); }, 900);
        return;
      }
      status.textContent = "failed at step: " + (data.failedStep || "unknown");
    } catch (e) {
      status.textContent = "request failed: " + e.message;
    }
    btn.disabled = false;
  });
})();
</script>
</body>
</html>`;
}
