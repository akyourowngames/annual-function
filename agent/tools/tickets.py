"""Support ticket tools (via Next.js backend)."""

from config import NEXTJS_BASE_URL


def create_ticket(subject: str, description: str, student_id: str | None = None) -> dict:
    """Create a support ticket via Next.js backend (TODO: HTTP POST)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/tickets",
        "subject": subject,
        "description": description,
        "student_id": student_id,
    }


def check_ticket_status(ticket_id: str) -> dict:
    """Check ticket status via Next.js backend (TODO)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/tickets?id={ticket_id}",
    }
