import { config } from "dotenv";
import type { Config } from "drizzle-kit";

config({ path: ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // NOTE: no sslmode/options here on purpose. Supavisor (pooler :6543)
    // presents a chain Windows pg rejects (SELF_SIGNED_CERT_IN_CHAIN);
    // trust is configured below via `ssl` instead (drizzle-kit passes
    // this through to the pg driver).
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  },
} satisfies Config;
