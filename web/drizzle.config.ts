import { config } from "dotenv";
import type { Config } from "drizzle-kit";

config({ path: ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Supavisor (pooler :6543) presents a chain Windows TLS rejects
    // (SELF_SIGNED_CERT_IN_CHAIN). `?sslmode=require` in the URL makes BOTH
    // drivers skip cert verification: pg-connection-string (drizzle-kit's
    // 'pg' driver) AND postgres.js (app runtime in lib/db/index.ts) both map
    // sslmode=require -> rejectUnauthorized: false.
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
