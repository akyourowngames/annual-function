# Annual Function — Digital Invitation & AI Helpdesk

Monorepo:

```text
annual-function/
├── web/    ← Next.js (TypeScript, Tailwind, App Router, Turbopack, @/*)
└── agent/  ← Python + FastAPI (OpenAI agent, tools, knowledge)
```

## Web (Next.js)

```bash
cd web
npm install
npm run dev
```

Opens the Next.js starter. Business rules + APIs live here.

## Agent (Python + FastAPI)

```bash
cd agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Health check:

```text
GET http://127.0.0.1:8000/health -> {"status": "ok"}
```

Rule: the agent requests actions; Next.js + PostgreSQL validate them
(e.g. guest_limit). No duplicate business logic.

Next: Supabase + Drizzle + real database schema shared by both sides.
