"""Vector RAG product Q&A sidecar (Step 8 / ticket S1).

Reads the product catalogue from the main app's SQLite database, embeds one
chunk per product with a local embedding model (no API key needed), and
answers open-ended questions by retrieving the closest products and asking
Claude to answer from that context only.

Run:  .venv/bin/uvicorn main:app --port 8000
Killing this process never affects the main app — it degrades gracefully.
"""
import json
import os
import sqlite3
from pathlib import Path

import numpy as np
from anthropic import Anthropic
from fastapi import FastAPI
from fastembed import TextEmbedding
from pydantic import BaseModel

# Load the main app's .env (one level up) for the Anthropic key.
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
for line in ENV_PATH.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "app.sqlite"
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
TOP_K = 8

app = FastAPI(title="Furniture catalogue Q&A")
embedder = TextEmbedding("BAAI/bge-small-en-v1.5")
claude = Anthropic()

products: list = []
vectors: np.ndarray = np.zeros((0, 384))


def product_chunk(p: dict) -> str:
    """One retrieval chunk per product — natural unit for this catalogue."""
    dims = " x ".join(
        f"{label} {p[key]}cm"
        for label, key in (("width", "width"), ("height", "height"), ("depth", "depth"))
        if p[key]
    )
    colours = ", ".join(json.loads(p["colours"] or "[]"))
    parts = [
        f"{p['product_name']} (item {p['item_id']})",
        f"category: {p['category']}",
        f"price: ${p['price']}",
    ]
    if colours:
        parts.append(f"colours: {colours}")
    if dims:
        parts.append(f"dimensions: {dims}")
    return ". ".join(parts)


@app.on_event("startup")
def build_index() -> None:
    global products, vectors
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT item_id, product_name, price, category, colours, depth, height, width FROM products"
    )]
    conn.close()
    products = rows
    chunks = [product_chunk(p) for p in rows]
    vectors = np.array(list(embedder.embed(chunks)))
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    print(f"Indexed {len(products)} products")


class Question(BaseModel):
    question: str


@app.get("/health")
def health():
    return {"ok": True, "indexed": len(products)}


@app.post("/retrieve")
def retrieve(q: Question):
    """Retrieval only — used to eyeball result quality without generation."""
    return {"matches": _retrieve(q.question)}


def _retrieve(question: str):
    qvec = np.array(list(embedder.embed([question])))[0]
    qvec /= np.linalg.norm(qvec)
    scores = vectors @ qvec
    top = np.argsort(scores)[::-1][:TOP_K]
    return [
        {"score": round(float(scores[i]), 3), "chunk": product_chunk(products[i]),
         "item_id": products[i]["item_id"]}
        for i in top
    ]


@app.post("/ask")
def ask(q: Question):
    matches = _retrieve(q.question)
    context = "\n".join(f"- {m['chunk']}" for m in matches)
    response = claude.messages.create(
        model=MODEL,
        max_tokens=500,
        system=(
            "You answer questions about a furniture shop's catalogue. Answer ONLY from "
            "the product context provided — if it doesn't contain the answer, say so "
            "plainly. Mention product names and prices. Be brief and helpful."
        ),
        messages=[{
            "role": "user",
            "content": f"Product context:\n{context}\n\nQuestion: {q.question}",
        }],
    )
    return {
        "answer": response.content[0].text,
        "sources": [m["item_id"] for m in matches],
    }
