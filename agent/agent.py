"""Agent entrypoint. Orchestrates intent -> tool -> response.

Business rules live in Next.js + PostgreSQL. The agent only requests
actions through tools; it never writes to the database directly.
"""

from models.schemas import AgentChatRequest, AgentChatResponse


class AnnualFunctionAgent:
    def chat(self, request: AgentChatRequest) -> AgentChatResponse:
        # TODO: wire OpenAI Responses API + tool calling here.
        return AgentChatResponse(
            reply="Agent not wired yet. Next step: Supabase + Drizzle schema.",
            tool_calls=[],
        )
