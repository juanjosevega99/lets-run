import "dotenv/config";
import { connect } from "../db.js";
import { rebuildFitness } from "./rebuild.js";

/**
 * Thin CLI wrapper around rebuildFitness(). The dashboard's refresh button calls the
 * same function, so both paths behave identically.
 *
 *   npm run fitness:rebuild
 */
async function main() {
  const sql = connect();
  try {
    await rebuildFitness(sql, (line) => console.log(line));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
