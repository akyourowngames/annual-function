"""Shared config loaded from environment variables."""

import os

from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")
NEXTJS_BASE_URL = os.getenv("NEXTJS_BASE_URL", "http://localhost:3000")
AGENT_PORT = int(os.getenv("AGENT_PORT", "8000"))
