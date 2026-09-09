"""Pydantic schemas shared by the agent API."""

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class InvitationLookup(BaseModel):
    student_id: str = Field(description="School student ID, e.g. 10234")


class GuestRegisterRequest(BaseModel):
    invitation_code: str
    guest_name: str
    relation: str | None = None


class TicketCreateRequest(BaseModel):
    student_id: str | None = None
    subject: str
    description: str


class AgentChatRequest(BaseModel):
    message: str
    student_id: str | None = None


class AgentChatResponse(BaseModel):
    reply: str
    tool_calls: list[str] = []
