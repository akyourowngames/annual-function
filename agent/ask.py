"""Ask Backstage from the terminal.

    python ask.py "give me the brief"
    python ask.py "who hasn't replied?" "find Ayaansh Rai"
"""

import asyncio
import sys
import time

from assistant import db, session as sessions
from main import run_turn

# Windows consoles default to cp1252 and choke on the model's punctuation.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


async def main(questions: list[str]) -> None:
    await db.start()
    session_id = sessions.new()

    async def emit(event: dict) -> None:
        if event.get("type") == "tool":
            print(f"   · {event.get('label')}")

    for question in questions:
        started = time.perf_counter()
        out = await run_turn(session_id, question, emit)
        took = (time.perf_counter() - started) * 1000
        tools = ", ".join(out["tools"]) or "none"
        print(f"\n> {question}\n{out['text']}\n   [{took:.0f} ms · {out['model']} · {tools}]")

    await db.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["Give me the brief."]))
