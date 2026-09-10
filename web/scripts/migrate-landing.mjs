import {config} from 'dotenv';
import fs from 'node:fs';
import postgres from 'postgres';
config({path:'.env.local',quiet:true});
const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:10});
try{await sql.unsafe(fs.readFileSync('drizzle/migrations/0002_landing_content.sql','utf8'));console.log('Editable landing content column added. Existing event data preserved.');}finally{await sql.end({timeout:2});}
