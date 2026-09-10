import {config} from 'dotenv';
import fs from 'node:fs';
import postgres from 'postgres';
config({path:'.env.local',quiet:true});
const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10});
try { await sql.begin(async tx=>{await tx.unsafe(fs.readFileSync('drizzle/migrations/0001_event_knowledge.sql','utf8'));}); console.log('Product migration applied: event knowledge and lookup indexes.'); }
finally { await sql.end({timeout:2}); }
