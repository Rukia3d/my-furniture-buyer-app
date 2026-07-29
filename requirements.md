# Requirements

What the app must do, translated from the event's level criteria to this
specific build. Milestone tickets (GitHub issues M1–M9, S1–S2) carry the
per-step acceptance criteria; this file is the overall contract.

## Level 1 — a normal web app

| Event requirement | What it means here |
|---|---|
| Entity model | User, Product, Order (see `architecture.md`) |
| Web UI | Product list, product detail, login/registration, order history — server-rendered pages |
| User login | Session-based login; multiple users, each seeing only their own data |
| Save data in a database | SQLite: users, orders, cached catalogue survive restarts |
| Workflow logic | A user cannot place an order costing more than their remaining balance — enforced server-side, with a clear message. Double-clicking Buy creates one order, not two |
| Reports | A logged-in user sees their own past orders and total spent |
| Accessible via the internet | ngrok tunnel to port 3003; usable from another device/network |

Products are seeded from the shared read-only MongoDB catalogue (762 real
products, with images and dimensions) rather than invented placeholder data.

## Level 2 — the real furniture-shop API

- Catalogue refreshed from `GET /catalogue/search-index` at server start.
- The **linked user's** balance is always fetched live from `GET /users/{id}`.
- The linked user's Buy button places a real order via `POST /orders`, stores
  the returned `api_order_id` locally, shows confirmation + updated balance,
  and links the PDF invoice.
- Error contract: 402 → "insufficient balance" message; 404 → "item no longer
  available"; 429 → wait per `Retry-After` and retry; 401/403 → configuration
  problem surfaced to the operator, not the shopper. Nothing crashes a page.

## Level 3 — the agent

- A logged-in user types plain English at `/assistant`; the agent chooses
  among four tools: search products, product details, check balance,
  place order.
- Fuzzy judgement ("cheap", "mustard", "for a kid's room") happens in the
  model / local SQL over the cached catalogue — the API only does exact,
  case-insensitive category matches, and tool descriptions must say so.
- **A real order is never placed without the user's explicit confirmation**
  (server-enforced two-step: preview → confirm).
- Failures (insufficient balance, unknown item) are explained
  conversationally with a suggestion, never surfaced as raw errors, and a
  failed order is never retried automatically.
- Conversation memory within a session: "buy the first one" must resolve
  against earlier results.

### Agent evals (safety net)

A scripted eval suite (`npm run eval`) runs the agent against a fixed set of
scenarios using **mocked tools** — never the real API, never real balance —
and asserts on the tool-call trace:

- Balance question → calls `check_balance` only.
- Product search with price constraint → calls `search_products`; reply only
  references returned products.
- Purchase request → produces a preview, does **not** execute.
- Explicit confirmation → executes exactly once.
- "Buy the first one" after a search → resolves the correct item_id.
- Overspend / unknown item → graceful explanation, no automatic retry.
- Irrelevant request ("what's the weather") → no tool calls, polite redirect.

The suite must pass before the agent is considered done (M8), and re-run
after any change to tool descriptions or the system prompt. It doubles as
the Haiku-vs-Sonnet comparison harness if Haiku underperforms.

## Identity model (Option A) — the design decision everything hangs on

The event API grants exactly one user_id + API key, which can only act as
itself. The app therefore supports:

- **Local users** — any number; registration form or seed script; balance and
  orders live entirely in SQLite. They exercise every Level 1 behaviour.
- **One linked user** — a seeded account flagged as mapping to the event API
  user. Their balance and orders go through the real API (Level 2/3). The API
  key stays in `.env` and is never stored per-user in the database.

## Out of scope (deliberate)

- No shopping cart — orders go straight from product page or agent.
- No admin UI, password reset, or email.
- Stretch goals (S1 vector RAG sidecar, S2 OpenClaw/WhatsApp) only after
  M1–M9 are verified working.
