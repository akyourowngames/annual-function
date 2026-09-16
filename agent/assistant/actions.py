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
