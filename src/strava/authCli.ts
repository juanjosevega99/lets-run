import "dotenv/config";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildAuthorizeUrl, exchangeCodeForTokens } from "./oauth.js";

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const ENV_PATH = new URL("../../.env", import.meta.url).pathname;

/**
 * One-time OAuth handshake for F0b (incremental sync). Requires STRAVA_CLIENT_ID and
 * STRAVA_CLIENT_SECRET already in .env (from registering an app at
 * strava.com/settings/api). Opens the Strava consent screen; you click Authorize;
 * this catches the redirect on localhost, exchanges the code, and writes
 * STRAVA_REFRESH_TOKEN + STRAVA_ATHLETE_ID back into .env.
 *
 *   npm run strava:auth
 */
async function main() {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");

  const authorizeUrl = buildAuthorizeUrl(clientId, REDIRECT_URI);
  console.log(`Opening browser for Strava authorization...\nIf it doesn't open, visit:\n  ${authorizeUrl}\n`);
  spawn("open", [authorizeUrl], { stdio: "ignore", detached: true }).unref();

  const code = await waitForCallback();
  console.log("Got authorization code, exchanging for tokens...");
  const tokens = await exchangeCodeForTokens(clientId, clientSecret, code);

  await upsertEnv({
    STRAVA_REFRESH_TOKEN: tokens.refreshToken,
    STRAVA_ATHLETE_ID: tokens.athleteId !== null ? String(tokens.athleteId) : "",
  });

  console.log(`Authorized athlete ${tokens.athleteId}. Refresh token saved to .env.`);
  console.log("Run `npm run strava:sync` to pull activities.");
}

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        error
          ? `<p>Authorization failed: ${error}. You can close this tab.</p>`
          : `<p>Authorized. You can close this tab and go back to the terminal.</p>`,
      );

      server.close();
      if (error) reject(new Error(`Strava authorization denied: ${error}`));
      else if (!code) reject(new Error("Strava callback had no code"));
      else resolve(code);
    });
    server.listen(PORT);
  });
}

async function upsertEnv(values: Record<string, string>): Promise<void> {
  const existing = await readFile(ENV_PATH, "utf8").catch(() => "");
  const lines = existing.split("\n").filter((l) => l.length > 0);
  const keys = new Set(Object.keys(values));

  const kept = lines.filter((line) => {
    const key = line.split("=")[0];
    return !keys.has(key ?? "");
  });
  const added = Object.entries(values).map(([k, v]) => `${k}=${v}`);

  await writeFile(ENV_PATH, [...kept, ...added].join("\n") + "\n", { mode: 0o600 });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env (see .env.example)`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
