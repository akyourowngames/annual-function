# annual. — web

The product itself. A paper-theatre landing page at `/`, family invitations at
`/portal`, and the staff workspace at `/admin`.

```bash
npm ci
cp .env.example .env.local   # add your Supabase + database credentials
npm run dev                  # → http://localhost:3000
```

Everything worth knowing — database setup, staff access, roster import,
landing-page editing, and the verification suite — lives in
[docs/running-the-product.md](../docs/running-the-product.md). The project
story and architecture map live in the [root README](../README.md).

Built with Next.js, TypeScript, Tailwind CSS, Drizzle ORM, and Supabase
PostgreSQL. Verified with Playwright (`npm run test:e2e`).
