import fs from 'node:fs';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
console.log('Configured keys:', fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(x => /^[A-Z_]+=/.test(x)).map(x => x.split('=')[0]).join(', '));
console.log('Node:', process.version);
const postgres = (await import('postgres')).default;
const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 8, max: 1 });
try {
  const rows = await sql`select event_name, event_date, start_time, venue, dress_code, parking_info, entry_info from event_settings limit 1`;
  console.log('Event settings:', JSON.stringify(rows));
  console.log('Database reachable');
} catch (e) { console.log('Database check:', e.code ?? e.message); process.exitCode = 1; }
finally { await sql.end({ timeout: 1 }); }
