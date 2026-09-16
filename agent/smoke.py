"""Quick check that Backstage can reach the event data.

    python smoke.py
"""

import asyncio
import json

from assistant import db, tools


async def main() -> None:
    await db.start()
    for name in ("event_overview", "rsvp_report", "reachability", "album_status", "what_needs_attention"):
        result = await tools.execute(name, {}, {"session": {}, "emit": None})
        print(f"--- {name} ---")
        print(json.dumps(result, indent=2, default=str)[:700])
    found = await tools.execute("find_family", {"query": "AYAANSH"}, {"session": {}, "emit": None})
    print("--- find_family ---")
    print(json.dumps(found, indent=2, default=str)[:700])
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
