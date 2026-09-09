from fastapi import FastAPI

app = FastAPI(title="Annual Function AI Agent")


@app.get("/health")
def health():
    return {"status": "ok"}
