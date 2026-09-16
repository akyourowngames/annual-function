"""Start Backstage.

Use this instead of `uvicorn main:app`: on Windows, uvicorn's CLI installs a
Proactor event loop, which psycopg's async connections cannot use. Here we build
the loop ourselves — a selector loop on Windows — and run the server inside it.

    python serve.py
"""

import asyncio
import sys

import uvicorn

import config
from main import app


def main() -> None:
    server = uvicorn.Server(
        uvicorn.Config(app, host=config.HOST, port=config.PORT, log_level="info")
    )
    if sys.platform == "win32":
        loop = asyncio.SelectorEventLoop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(server.serve())
        finally:
            loop.close()
    else:
        asyncio.run(server.serve())


if __name__ == "__main__":
    main()
