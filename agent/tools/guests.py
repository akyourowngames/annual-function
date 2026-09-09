"""Guest tools. Backend enforces guest_limit; agent only requests."""

from config import NEXTJS_BASE_URL


def register_guest(invitation_code: str, guest_name: str, relation: str | None = None) -> dict:
    """Register a guest via Next.js backend (TODO: HTTP POST)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/guests",
        "invitation_code": invitation_code,
        "guest_name": guest_name,
        "relation": relation,
    }


def check_registration(invitation_code: str) -> dict:
    """Check registration status via Next.js backend (TODO)."""
    return {
        "todo": True,
        "nextjs_endpoint": f"{NEXTJS_BASE_URL}/api/guests?invitation_code={invitation_code}",
    }
