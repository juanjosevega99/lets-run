import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "../src/db.js";

const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;

async function main() {
  const sql = connect();
  try {
    await sql`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await sql`select filename from schema_migrations`).map((r) => r.filename as string),
    );

    for (const file of files) {
      if (applied.has(file)) continue;
      const contents = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`applying ${file}...`);
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
    }
    console.log("migrations up to date");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
