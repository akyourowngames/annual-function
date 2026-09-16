"""Executing confirmed actions against the Next.js backend.

The assistant never writes to the database. It calls the same APIs the staff
workspace uses, so every business rule, validation and audit stays in one place.
"""

import time
from typing import Any

import httpx

from config import ADMIN_ACCESS_KEY, NEXTJS_BASE_URL

_cookies: dict[str, str] | None = None
_cookies_at = 0.0
_COOKIE_TTL = 600


async def _session_cookies() -> dict[str, str]:
    global _cookies, _cookies_at
    if _cookies and (time.time() - _cookies_at) < _COOKIE_TTL:
        return _cookies
    if not ADMIN_ACCESS_KEY:
        raise RuntimeError("ADMIN_ACCESS_KEY is not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{NEXTJS_BASE_URL}/api/auth", json={"accessKey": ADMIN_ACCESS_KEY}
        )
        if res.status_code != 200:
            raise RuntimeError(f"Could not sign in to the workspace (HTTP {res.status_code})")
        _cookies = dict(client.cookies)
        _cookies_at = time.time()
        return _cookies


async def warm() -> bool:
    """Sign in early so the first confirmed action is instant."""
    try:
        await _session_cookies()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _call(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    cookies = await _session_cookies()
    async with httpx.AsyncClient(timeout=60, cookies=cookies) as client:
        res = await client.request(method, f"{NEXTJS_BASE_URL}{path}", json=payload)
        try:
            data = res.json()
        except Exception:  # noqa: BLE001
            data = {}
        if res.status_code >= 400:
            raise RuntimeError(data.get("error") or f"HTTP {res.status_code}")
        return data


async def send_announcement(body: str, audience: str = "all") -> dict[str, Any]:
    created = await _call(
        "POST", "/api/announcements", {"body": body, "audience": audience, "action": "send"}
    )
    announcement = created.get("announcement") or {}
    ann_id = announcement.get("id")
    sent = int(announcement.get("sent") or 0)
    failed = int(announcement.get("failed") or 0)
    remaining = int((created.get("result") or {}).get("remaining") or 0)
    guard = 0
    while ann_id and remaining > 0 and guard < 80:
        batch = await _call("PATCH", "/api/announcements", {"id": ann_id, "action": "send-batch"})
        result = batch.get("result") or {}
        sent += int(result.get("sent") or 0)
        failed += int(result.get("failed") or 0)
        remaining = int(result.get("remaining") or 0)
        guard += 1
    return {"sent": sent, "failed": failed, "remaining": remaining}


async def reply_to_ticket(ticket_id: str, message: str) -> dict[str, Any]:
    res = await _call(
        "PATCH", "/api/tickets", {"id": ticket_id, "action": "reply", "message": message}
    )
    return {"delivered": bool(res.get("delivered")), "status": (res.get("ticket") or {}).get("status")}


async def set_gallery(enabled: bool) -> dict[str, Any]:
    res = await _call("PATCH", "/api/album", {"galleryEnabled": bool(enabled)})
    return {"galleryEnabled": res.get("galleryEnabled")}


async def check_in_family(code: str) -> dict[str, Any]:
    invitation = await _call("GET", f"/api/invitations?code={code}")
    token = (invitation.get("invitation") or {}).get("qrToken")
    if not token:
        raise RuntimeError(f"No invitation found for {code}")
    guests = [g for g in (invitation.get("guests") or []) if g.get("status") != "checked_in"]
    checked = 0
    for guest in guests:
        try:
            await _call("POST", "/api/check-in", {"qrToken": token, "guestId": guest["id"]})
            checked += 1
        except Exception:  # noqa: BLE001 — stop at the first refusal
            break
    return {"checked_in": checked, "student": invitation.get("studentName"), "code": code}


async def set_guest_limit(
    *, scope: str, class_name: str | None = None, limit: int
) -> dict[str, Any]:
    """Change the guest allowance for everyone, or for one class."""
    payload: dict[str, Any] = {"guestLimit": int(limit)}
    if scope == "class" and class_name:
        payload["className"] = class_name
    else:
        payload["audience"] = "all"
    res = await _call("PATCH", "/api/admin", payload)
    invitation = res.get("invitation") or {}
    return {
        "updated": int(invitation.get("updated") or 0),
        "skipped": invitation.get("skipped") or [],
        "limit": int(limit),
    }


async def send_invitations(*, scope: str, class_name: str | None = None) -> dict[str, Any]:
    """Bulk-send passes to everyone, or to one class (batched, like the UI)."""
    audience = f"class:{class_name}" if scope == "class" and class_name else "all"
    sent = failed = remaining = 0
    guard = 0
    while guard < 80:
        res = await _call("POST", "/api/admin/deliver", {"audience": audience})
        result = res.get("result") or {}
        sent += int(result.get("sent") or 0)
        failed += int(result.get("failed") or 0)
        remaining = int(result.get("remaining") or 0)
        if remaining <= 0:
            break
        guard += 1
    return {"sent": sent, "failed": failed, "remaining": remaining, "audience": audience}


async def create_student(
    *, admission: str, name: str, class_name: str, guest_limit: int | None = None
) -> dict[str, Any]:
    """Add a student and their invitation record. Nothing is ever sent."""
    payload: dict[str, Any] = {
        "admissionNumber": admission,
        "name": name,
        "className": class_name,
    }
    if guest_limit is not None:
        payload["guestLimit"] = int(guest_limit)
    res = await _call("POST", "/api/invitations", payload)
    student = res.get("student") or {}
    invitation = res.get("invitation") or {}
    return {
        "name": student.get("name") or name,
        "admission": student.get("admissionNumber") or admission,
        "className": student.get("className") or class_name,
        "code": invitation.get("code"),
        "guestLimit": invitation.get("guestLimit"),
        "created": bool(res.get("created")),
        "sent": False,
    }


async def regenerate_pass(code: str) -> dict[str, Any]:
    """Replace a leaked or lost pass. The old code stops working."""
    res = await _call("PATCH", "/api/admin", {"code": code, "regenerate": True})
    invitation = res.get("invitation") or {}
    return {"oldCode": code, "code": invitation.get("invitationCode") or ""}


async def set_invitation_status(code: str, active: bool) -> dict[str, Any]:
    res = await _call(
        "PATCH", "/api/admin", {"code": code, "status": "active" if active else "disabled"}
    )
    return {"code": code, "status": (res.get("invitation") or {}).get("status")}


async def add_guest(code: str, name: str, relationship: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"code": code, "name": name}
    if relationship:
        payload["relationship"] = relationship
    res = await _call("POST", "/api/guests", payload)
    return {
        "name": (res.get("guest") or {}).get("name") or name,
        "code": code,
        "registered": res.get("registered"),
        "remaining": res.get("remaining"),
    }


async def remove_guest(code: str, guest_name: str) -> dict[str, Any]:
    """Remove a guest by name — resolved against the invitation's own list."""
    invitation = await _call("GET", f"/api/invitations?code={code}")
    guests = invitation.get("guests") or []
    wanted = (guest_name or "").strip().lower()
    matches = [g for g in guests if wanted and wanted in (g.get("name") or "").lower()]
    if not matches:
        raise RuntimeError(f"No guest called {guest_name} is on {code}")
    if len(matches) > 1:
        raise RuntimeError(f"More than one guest on {code} matches {guest_name}")
    guest = matches[0]
    await _call("DELETE", "/api/guests", {"code": code, "guestId": guest["id"]})
    return {"code": code, "removed": guest.get("name")}


async def rename_guest(
    code: str, current_name: str, new_name: str, relationship: str | None = None
) -> dict[str, Any]:
    """Change a guest's name — how a parent registered as the wrong person is fixed.

    The current guest is resolved against the invitation's own list, so a name
    that matches nobody, or matches two people, is refused rather than guessed.
    """
    invitation = await _call("GET", f"/api/invitations?code={code}")
    guests = invitation.get("guests") or []
    wanted = (current_name or "").strip().lower()
    matches = [g for g in guests if wanted and wanted in (g.get("name") or "").lower()]
    if not matches:
        raise RuntimeError(f"No guest called {current_name} is on {code}")
    if len(matches) > 1:
        raise RuntimeError(f"More than one guest on {code} matches {current_name}")
    guest = matches[0]
    payload: dict[str, Any] = {"code": code, "guestId": guest["id"], "name": new_name}
    if relationship:
        payload["relationship"] = relationship
    res = await _call("PATCH", "/api/guests", payload)
    changed = res.get("guest") or {}
    return {
        "code": code,
        "was": guest.get("name"),
        "name": changed.get("name") or new_name,
        "relationship": changed.get("relationship"),
        "registered": res.get("registered"),
        "remaining": res.get("remaining"),
    }


async def resend_pass(code: str) -> dict[str, Any]:
    res = await _call("POST", "/api/admin/deliver", {"codes": [code]})
    result = res.get("result") or {}
    return {
        "code": code,
        "sent": int(result.get("sent") or 0),
        "failed": int(result.get("failed") or 0),
        "unreachable": int(result.get("unreachable") or 0),
    }
