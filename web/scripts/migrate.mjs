import { config } from "dotenv";
import fs from "node:fs";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/migrate.mjs <path-to-sql>");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(fs.readFileSync(file, "utf8"));
  });
  console.log(`Migration applied: ${file}`);
} finally {
  await sql.end({ timeout: 2 });
}
