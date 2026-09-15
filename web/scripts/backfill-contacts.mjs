import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });
// Rebuild invitation_contacts from chat sessions (families who verified before
// contact capture existed, or on another instance).
try {
  const rows = await sql`
    select distinct on (invitation_code) invitation_code, wa_id
    from whatsapp_sessions
    where invitation_code is not null
      and (wa_id like 'tg:%' or wa_id like 'wa:%')
      and invitation_code in (select invitation_code from invitations)
    order by invitation_code, last_user_msg_at desc
  `;
  let n = 0;
  for (const r of rows) {
    const channel = r.wa_id.startsWith("tg:") ? "telegram" : "whatsapp";
    const address = r.wa_id.slice(3);
    await sql`
      insert into invitation_contacts (invitation_code, channel, address)
      values (${r.invitation_code}, ${channel}, ${address})
      on conflict (invitation_code) do update
        set channel = excluded.channel, address = excluded.address, updated_at = now()
    `;
    n++;
  }
  const count = await sql`select count(*)::int as n from invitation_contacts`;
  console.log(`backfilled ${n} contact(s); invitation_contacts now ${count[0].n}`);
} finally {
  await sql.end({ timeout: 2 });
}
