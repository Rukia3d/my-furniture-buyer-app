"""Vector RAG product Q&A sidecar (Step 8 / ticket S1).

Reads the product catalogue from the main app's SQLite database, embeds one
chunk per product with a local embedding model (no API key needed), and
answers open-ended questions by retrieving the closest products and asking
Claude to answer from that context only.

Run:  .venv/bin/uvicorn main:app --port 8000
Killing this process never affects the main app — it degrades gracefully.
"""
import json
import math
import os
import re
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
TOP_K_RETRIEVE = 8   # default for the /retrieve inspection endpoint
TOP_K_GENERATE = 25  # context for /ask — wide enough to dodge the recall ceiling
VECTOR_WEIGHT = 0.65 # hybrid score: cosine similarity vs keyword (IDF) overlap

STOPWORDS = {"a", "an", "the", "of", "in", "on", "for", "with", "and", "or",
             "is", "are", "do", "you", "your", "have", "what", "whats", "most",
             "any", "anything", "like", "me", "my", "i", "we", "our", "to", "that"}


def tokenize(text: str):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS]

app = FastAPI(title="Furniture catalogue Q&A")
embedder = TextEmbedding("BAAI/bge-small-en-v1.5")
claude = Anthropic()

products: list = []
vectors: np.ndarray = np.zeros((0, 384))
token_sets: list = []   # per-product token set, for keyword scoring
idf: dict = {}          # token -> inverse document frequency


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


def build_index() -> None:
    global products, vectors, token_sets, idf
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

    # Keyword index: IDF over per-product token sets.
    token_sets = [set(tokenize(c)) for c in chunks]
    df: dict = {}
    for ts in token_sets:
        for t in ts:
            df[t] = df.get(t, 0) + 1
    n = max(len(token_sets), 1)
    idf = {t: math.log(n / c) for t, c in df.items()}
    print(f"Indexed {len(products)} products")


@app.on_event("startup")
def startup() -> None:
    build_index()


@app.post("/reload")
def reload_index():
    """Rebuild the index — called by the app after its catalogue refresh."""
    build_index()
    return {"ok": True, "indexed": len(products)}


class Question(BaseModel):
    question: str
    k: int = 0  # optional override for how many matches to return (/retrieve)


@app.get("/health")
def health():
    return {"ok": True, "indexed": len(products)}


@app.post("/retrieve")
def retrieve(q: Question):
    """Retrieval only — used to test recall without generation."""
    return {"matches": _retrieve(q.question, q.k or TOP_K_RETRIEVE)}


def _retrieve(question: str, k: int):
    # Hybrid score: dense cosine similarity blended with IDF keyword overlap —
    # the keyword half rescues exact terms (colours, product names) that thin
    # structured chunks under-represent in embedding space.
    qvec = np.array(list(embedder.embed([question])))[0]
    qvec /= np.linalg.norm(qvec)
    dense = vectors @ qvec

    qtokens = [t for t in tokenize(question) if t in idf]
    max_lex = sum(idf[t] for t in qtokens) or 1.0
    lex = np.array([
        sum(idf[t] for t in qtokens if t in ts) / max_lex
        for ts in token_sets
    ])

    scores = VECTOR_WEIGHT * dense + (1 - VECTOR_WEIGHT) * lex
    top = np.argsort(scores)[::-1][:k]
    return [
        {"score": round(float(scores[i]), 3), "chunk": product_chunk(products[i]),
         "item_id": products[i]["item_id"]}
        for i in top
    ]


@app.post("/ask")
def ask(q: Question):
    matches = _retrieve(q.question, TOP_K_GENERATE)
    context = "\n".join(f"- {m['chunk']}" for m in matches)
    response = claude.messages.create(
        model=MODEL,
        max_tokens=500,
        system=(
            "You answer questions about a furniture shop's catalogue. Answer ONLY from "
            "the product context provided — if it doesn't contain the answer, say the "
            "retrieved products don't cover it (the full catalogue may still have it). "
            "The context is a wide candidate set: filter it yourself to what the "
            "question actually asks. Mention product names, item ids and prices. Be "
            "brief and helpful."
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
