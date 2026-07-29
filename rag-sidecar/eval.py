"""Retrieval eval for the RAG sidecar (ticket R1).

Each case: a question and the item_id(s) that MUST appear in the top-K
retrieved (K = the /ask generation context size). Requires the sidecar
running on RAG_URL (default http://localhost:8000).

Run: npm run eval:rag
"""
import json
import os
import sys
import urllib.request

RAG_URL = os.environ.get("RAG_URL", "http://localhost:8000").rstrip("/")
K = 25  # must match TOP_K_GENERATE in main.py

# (question, acceptable expected item_ids — any one in top-K passes)
CASES = [
    ("what is your most affordable option in blue?", ["40365371"]),          # Children's chair $23.60, blue
    ("a blue table for a kid's room", ["90365180"]),                          # Children's table, blue
    ("dressing table with a mirror", ["30374413"]),
    ("a desk chair for a child", ["59337670", "60441779"]),
    ("bar table", ["00368814"]),
    ("a big wardrobe combination", ["9325047"]),
    ("back cushion for a sofa", ["40411047"]),
    ("a simple cheap desk", ["30213076"]),
    ("a mattress for a double bed", ["00102065"]),
    ("children's stool", ["60248418", "50357785"]),
]


def retrieve(question: str):
    req = urllib.request.Request(
        f"{RAG_URL}/retrieve",
        data=json.dumps({"question": question, "k": K}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["matches"]


def main() -> int:
    failed = 0
    for question, expected in CASES:
        ids = [m["item_id"] for m in retrieve(question)]
        hit = next((e for e in expected if e in ids), None)
        if hit:
            print(f"  PASS  {question!r} -> {hit} at rank {ids.index(hit) + 1}")
        else:
            failed += 1
            print(f"  FAIL  {question!r} -> none of {expected} in top {K}")
            print(f"        got: {ids[:8]}...")
    total = len(CASES)
    print(f"\n{total - failed}/{total} passed (recall@{K})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
