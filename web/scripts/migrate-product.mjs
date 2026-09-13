import {config} from 'dotenv';
import fs from 'node:fs';
import postgres from 'postgres';
config({path:'.env.local',quiet:true});
const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10});
const migration='drizzle/migrations/0004_whatsapp_sessions.sql';
try { await sql.begin(async tx=>{await tx.unsafe(fs.readFileSync(migration,'utf8'));}); console.log(`Migration applied: ${migration}`); }
finally { await sql.end({timeout:2}); }
