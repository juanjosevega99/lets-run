import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

export function connect(url: string | undefined = process.env.DATABASE_URL): Sql {
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  // prepare:false keeps this compatible with Supabase's transaction pooler (pgbouncer)
  return postgres(url, { prepare: false });
}
