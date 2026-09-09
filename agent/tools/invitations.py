"""Invitation tools. These call Next.js APIs; they never touch the DB directly."""

from config import NEXTJS_BASE_URL


def get_invitation(student_id: str) -> dict:
    """Fetch invitation via Next.js backend (TODO: HTTP call)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/invitations?student_id={student_id}",
    }


def generate_invitation(student_id: str) -> dict:
    """Request invitation PDF/QR generation via Next.js backend (TODO)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/invitations",
        "student_id": student_id,
    }


def check_guest_limit(invitation_code: str) -> dict:
    """Check guest limit/remaining via Next.js backend (TODO)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/guests?invitation_code={invitation_code}",
    }
