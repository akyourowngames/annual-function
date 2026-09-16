"""Async Postgres access. Read-only queries for the assistant.

One small pool, autocommit, no prepared statements (Supabase transaction
pooler), with a tiny TTL cache so repeated questions are instant.
"""

import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from config import CACHE_TTL, DATABASE_URL

_pool: AsyncConnectionPool | None = None
_cache: dict[str, tuple[float, Any, float]] = {}

# Node-only connection options that libpq does not understand. Supabase's
# connection string ships them for node-postgres; psycopg must not see them.
_DROP_PARAMS = {"uselibpqcompat", "pgbouncer", "connection_limit", "pool_timeout", "schema"}


def _conninfo(url: str) -> str:
    if "?" not in url:
        return url
    parts = urlsplit(url)
    kept = [(k, v) for k, v in parse_qsl(parts.query) if k not in _DROP_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


async def start() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        _pool = AsyncConnectionPool(
            _conninfo(DATABASE_URL),
            min_size=1,
            max_size=6,
            open=False,
            kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None},
        )
        await _pool.open(wait=True)
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    pool = await start()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            return await cur.fetchall() or []


async def one(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    result = await rows(sql, params)
    return result[0] if result else None


async def scalar(sql: str, params: tuple = ()):
    row = await one(sql, params)
    return next(iter(row.values())) if row else None


def cached(key: str):
    """Return a cached value if it is still fresh, else None."""
    hit = _cache.get(key)
    if hit and (time.monotonic() - hit[0]) < hit[2]:
        return hit[1]
    return None


def remember(key: str, value, ttl: float | None = None):
    _cache[key] = (time.monotonic(), value, ttl if ttl is not None else CACHE_TTL)
    return value
