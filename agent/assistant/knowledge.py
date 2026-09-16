"""Knowledge retrieval — pgvector over the staff-uploaded documents.

Mirrors the app's hybrid approach: semantic search with NIM embeddings, then a
plain substring fallback so a missing embedding never blocks an answer.
"""

from typing import Any

from config import EMBED_API_KEY, EMBED_BASE_URL, EMBED_MODEL

from assistant import db, llm


async def _embed(text: str) -> list[float] | None:
    if not EMBED_API_KEY:
        return None
    try:
        res = await llm.client().post(
            f"{EMBED_BASE_URL}/embeddings",
            headers={"Authorization": f"Bearer {EMBED_API_KEY}"},
            json={
                "model": EMBED_MODEL,
                "input": [text],
                "input_type": "query",
                "encoding_format": "float",
            },
            timeout=8,
        )
        if res.status_code != 200:
            return None
        return res.json()["data"][0]["embedding"]
    except Exception:  # noqa: BLE001 — retrieval is best-effort
        return None


async def search(question: str, limit: int = 5) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    vector = await _embed(question)
    if vector:
        literal = "[" + ",".join(f"{x:.6f}" for x in vector) + "]"
        try:
            found = await db.rows(
                "select s.title as source, c.content as content "
                "from knowledge_chunks c join knowledge_sources s on s.id = c.source_id "
                "where c.embedding is not null "
                "order by c.embedding <=> %s::halfvec limit %s",
                (literal, limit),
            )
            hits = [
                {"source": r["source"], "content": (r["content"] or "")[:1200]}
                for r in found
            ]
        except Exception:  # noqa: BLE001
            hits = []
    if not hits:
        try:
            found = await db.rows(
                "select s.title as source, c.content as content "
                "from knowledge_chunks c join knowledge_sources s on s.id = c.source_id "
                "where c.content ilike %s order by length(c.content) asc limit %s",
                (f"%{question}%", limit),
            )
            hits = [
                {"source": r["source"], "content": (r["content"] or "")[:1200]}
                for r in found
            ]
        except Exception:  # noqa: BLE001
            hits = []
    return hits
