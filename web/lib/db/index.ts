import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
export type Db = PostgresJsDatabase<typeof schema>;
let _db: Db | null = null;
/**
 * Lazy singleton. Throws a helpful error when DATABASE_URL is missing
 * (paste the Supabase Postgres connection string into web/.env.local).
 * Lazy so `next build` / lint don't crash without env configured.
 */
export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase Postgres connection string to web/.env.local",
    );
  }
  // Supabase's transaction pooler does not preserve named prepared statements.
  // Disabling them also covers COMMIT, so a retried COMMIT cannot mask rollback.
  _db = drizzle(postgres(url, { prepare: false }), { schema });
  return _db;
}
