import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

export function connect(url: string | undefined = process.env.DATABASE_URL): Sql {
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  return postgres(url, {
    // Compatible with Supabase's transaction pooler (pgbouncer/supavisor).
    prepare: false,
    // On Vercel a warm instance keeps this client — and its sockets — between
    // requests, while the pooler silently drops connections that sit idle. With no
    // idle timeout the next request wrote into a dead socket and hung until the
    // platform killed it at 60s (a 504 with no error of its own). Closing idle
    // connections well before the pooler does, and capping their lifetime, means a
    // warm instance reconnects instead of hanging.
    idle_timeout: 20,
    max_lifetime: 60 * 15,
    // And if a connection does fail to open, fail in seconds — not at the platform cap.
    connect_timeout: 10,
  });
}
