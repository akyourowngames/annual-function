"""Event info / knowledge-base lookup (pgvector retrieval comes later)."""


def get_event_information(question: str) -> dict:
    """Answer event FAQs from the knowledge base (TODO: pgvector)."""
    return {"todo": True, "question": question, "answer": None}
