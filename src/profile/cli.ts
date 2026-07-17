import "dotenv/config";
import { connect } from "../db.js";
import { buildProfile, formatProfile } from "./buildProfile.js";
import { loadProfileFacts } from "./load.js";

/**
 * Prints a read-only profile of the ingested data:
 *
 *   npm run profile
 */
async function main() {
  const sql = connect();
  try {
    const { activities, races } = await loadProfileFacts(sql);
    console.log(formatProfile(buildProfile(activities, races)));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
