import "dotenv/config";
import { connect } from "../db.js";
import { syncStrava } from "./sync.js";

/**
 * F0b incremental sync — thin CLI wrapper around syncStrava(). The same function
 * backs the dashboard's refresh button, so both paths behave identically.
 *
 *   npm run strava:sync
 */
async function main() {
  const sql = connect();
  try {
    await syncStrava(sql, (line) => console.log(line));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
