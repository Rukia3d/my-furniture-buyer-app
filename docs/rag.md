# How the RAG product Q&A works, and how it was built

Companion to `docs/agent.md` and `docs/evals.md`. Code: `rag-sidecar/main.py`
(~170 lines — genuinely readable in one sitting).

## The problem it solves

The agent's `search_products` tool is exact SQL: category, price range,
colour, name substring. It cannot answer "something like a Scandinavian side
table but cheaper" or "your most affordable option in blue" — questions where
no field expresses the intent. RAG (Retrieval-Augmented Generation) answers
by *meaning*: find the products semantically closest to the question, then
have Claude answer from those and nothing else.

## The pipeline, step by step

**At startup (and on every /reload):**

1. **Read** all 762 products from the main app's SQLite (read-only).
2. **Chunk** — one text chunk per product, e.g.
   `"Bar table (item 00368814). category: Bar furniture. price: $398.
   colours: black. dimensions: width 80cm x height 105cm"`.
   One-product-per-chunk is the guide's own hint: the catalogue already comes
   in natural units, so no arbitrary splitting.
3. **Embed** every chunk with a local model (fastembed,
   `BAAI/bge-small-en-v1.5`) into a 384-number vector that encodes its
   meaning. Vectors are L2-normalised and kept in one NumPy matrix
   (762 × 384) in RAM — at this scale a vector database would be pure
   overhead.
4. **Keyword-index** every chunk too: its set of tokens, plus an IDF weight
   per token (rare words like "mustard" count more than common ones like
   "table").

**At question time (`POST /ask`):**

5. **Embed the question** with the same model.
6. **Score every product** with a hybrid:
   `score = 0.65 × cosine_similarity + 0.35 × keyword_overlap(IDF-weighted)`.
   The dense half catches meaning ("for a kid's room" ≈ "children's"); the
   keyword half rescues exact terms (colours, product names) that our terse
   structured chunks under-represent in embedding space.
7. **Retrieve the top 25** chunks — wide on purpose, see "recall ceiling"
   below.
8. **Generate**: Claude (Haiku, same `.env` model as the agent) gets ONLY
   those 25 chunks as context, with a system prompt ordering it to answer
   from them alone, filter them to what was actually asked, and admit when
   they don't cover the question. The response returns the answer plus the
   source item_ids.

**Integration:** the sidecar is a separate Python FastAPI process on
port 8000. The Express app exposes it to the agent as the fifth tool
(`answer_catalogue_question`), offered to the model only when `RAG_URL` is
set. Kill the sidecar and the shop runs fine — the tool just disappears.
After the app's boot-time catalogue refresh it POSTs `/reload` so the index
re-embeds fresh data.

## Why it was built this way — the actual decision trail

- **Separate Python service** (your call, early in planning): isolates the
  experiment — if RAG breaks, Levels 1–3 are untouched — and was decided
  before we knew Node could have done it too.
- **SQLite as source, not the guide's PDF**: same content richer (dimensions),
  and the guide never actually included the PDF's URL. Cost: the
  PDF-extraction exercise was skipped.
- **Local embeddings, not an API**: Claude doesn't do embeddings; hosted ones
  (Voyage etc.) need another key, and you didn't want personal keys in play.
  fastembed runs a small ONNX model locally — free, keyless, ~20s to index
  762 products. Side effect: your Python 3.14 was too new for its runtime,
  so the sidecar lives in a Python 3.9 venv.
- **Hybrid scoring came later** (ticket R3): pure cosine was demonstrably
  weak on exact words — our chunks are terse facts, not prose, so embeddings
  under-weight tokens like "blue". IDF keyword overlap fixed the eval's
  colour/name cases.
- **Top-25, not top-8** (ticket R2): with top-8, "most affordable option in
  blue" retrieved zero blue products (9 exist) and the model — correctly
  obeying its answer-only-from-context rule — wrongly told the user none
  existed. That's the classic *recall ceiling*: generation can't be right
  about things retrieval never showed it. Widening to 25 and telling the
  model to filter fixed it; the regression is now eval case #1.
- **Retrieval evals** (ticket R1): 10 question→known-product pairs asserting
  recall@25 against the live `/retrieve` endpoint — listed in
  `docs/evals.md`. Free to run (no generation involved).
- **`/reload` hook** (ticket R4): the index used to go stale after catalogue
  refreshes until sidecar restart.

## Numbers worth knowing

- 762 chunks, 384 dims → the whole "vector store" is ~1.2 MB of floats.
- Scoring a question is one matrix multiply — sub-millisecond.
- Answer latency is dominated by the Claude call (~1–3 s).
- Retrieval eval: 10/10 at recall@25 (6 cases rank #1).

## Honest limitations that remain

- Generation *wording* isn't scored — only retrieval is.
- Chunks have no prose (the catalogue has none), so "style" questions lean on
  names and categories; a richer catalogue would embed better.
- 0.65/0.35 weights were tuned by eval-passing, not systematic sweep.
- The techniques in Anthropic's Contextual Retrieval writeup (chunk
  enrichment, reranking) are documented-but-not-implemented next steps.
