import { config } from "dotenv";
import fs from "node:fs";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
const migration = "drizzle/migrations/0006_knowledge_embedding_2048.sql";
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(fs.readFileSync(migration, "utf8"));
  });
  console.log(`Migration applied: ${migration}`);
} finally {
  await sql.end({ timeout: 2 });
}
