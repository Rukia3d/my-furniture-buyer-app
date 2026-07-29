# How the shopping assistant (agent) works

Plain-English documentation of the Level 3 agent behind `/assistant`, plus its
eval suite. Code: `services/agent.js`, `routes/agent.js`, `evals/run.js`.

## The loop, step by step

1. The customer types a message on `/assistant`; the browser POSTs it to
   `/assistant/message`.
2. The server appends it to the conversation history and sends the whole
   history to Claude (`ANTHROPIC_MODEL` from `.env`, currently Haiku 4.5)
   together with a system prompt and a menu of **tools** — descriptions of
   actions the model may request.
3. Claude either answers in plain text (done — reply goes back to the browser)
   or asks to run one or more tools. Tool requests are executed **by our
   server code**, results are appended to the history, and we call Claude
   again. This repeats (max 8 rounds) until it produces a text answer.
4. The reply plus the full history (including tool calls and results) is
   saved, so follow-ups like "buy the first one" resolve correctly.

The model never touches anything directly — it can only *ask* for one of the
tools below, and our code decides what actually happens.

## The tools and where their data really comes from

| Tool | What the model asks | What actually runs |
|---|---|---|
| `search_products` | "products matching category/price/colour/name" | **SQL over our local `products` table** — not a live API call. The table holds the same 762 products, seeded from the shared MongoDB (images, dimensions) and re-synced from the shop API's `search-index` at every server start. Local SQL gives us price/colour filters the API doesn't have, immunity to rate limits, and no images near the model. |
| `get_product_details` | "everything about item X" | Same local table (price, colours, dimensions). |
| `check_balance` | "customer's balance" | The account service: **live `GET /users/{id}` on the shop API** for the linked user; the local DB balance for demo users. No parameters — identity always comes from the logged-in session, never from the model. |
| `place_order` | "buy item X" | Two-step latch (below). Execution goes through the account service: **live `POST /orders` on the shop API** for the linked user (real money, real invoice); local transaction for demo users. |
| `answer_catalogue_question` (only when `RAG_URL` is set) | "open-ended question about the catalogue" | HTTP call to the Python RAG sidecar: semantic (embedding) search over all products, answer generated from the retrieved chunks only. For vague asks exact filters can't express. |

So: **catalogue reading is served from our local cache; money operations
(balance, orders) are always live API calls.** That split is deliberate — the
cache is refreshed from the API at boot (which is also where Level 2's "call
the external API" is visibly exercised), while anything involving money is
never cached.

## The confirm-before-purchase latch

`place_order` is physically incapable of spending money on its first call:

1. First call (no `confirm_token`) → our code builds a preview (item, quantity,
   total, current balance), generates a **random token**, stores it server-side
   with a 5-minute expiry, and returns `needs_confirmation`.
2. The agent relays the preview and stops. Nothing was charged.
3. Only if the customer clearly agrees in their **next message** does the model
   call `place_order` again with that token. Our code checks it matches the
   stored one; only then does the real order execute. The token is single-use.

The guarantee is structural, not behavioural: the token is random and known
only to the server, so a confused or overeager model cannot invent a valid one.
Prompt instructions ("wait for approval") shape the conversation; the token
makes the money-safety not depend on them.

## Conversation memory

Each user's conversation (display log + full model history) is persisted in
the `agent_conversations` SQLite table after every turn, so chats survive
server restarts. History is capped at the most recent 60 messages (trimmed so
it never starts mid-tool-call). "Clear chat" on the page deletes it. The
in-flight pending-order token is memory-only and expires in 5 minutes.

## Error handling

Tool failures come back as structured results (`{error, message}`) — e.g.
insufficient balance with exact amounts, unknown item, rate-limited. The
system prompt tells the agent to explain these in plain language, suggest
alternatives, and **never retry a failed order on its own**. A model/API
outage returns a friendly "try again" from the route, never a crash.

## The eval suite (`npm run eval`)

Runs the REAL agent loop with the REAL model, but against **mocked tools** —
a tiny fake catalogue and fake balance — so no real data or money is ever
touched. Each scenario asserts on the **tool-call trace** (which tools were
requested, with what inputs, and what got executed), which is deterministic —
unlike judging reply wording. Seven scenarios:

1. **Balance question calls `check_balance` only** — no unnecessary tools.
2. **Price-constrained search** uses `search_products`; the reply mentions
   only products the tool actually returned (no invented or over-budget items).
3. **A purchase request previews but does NOT execute** — zero executions
   recorded in the mock after "buy the Aria chair".
4. **Explicit confirmation executes exactly once** — not zero, not twice.
5. **"Buy the first one"** after a search resolves to an item that was
   actually in the results.
6. **Overspend is explained, never auto-retried** — at most one execution
   attempt, balance unchanged, reply explains in plain language.
7. **Off-topic request calls no tools** — the weather question gets a polite
   redirect, zero tool calls.

Exit code is non-zero on any failure. Re-run after ANY change to tool
descriptions or the system prompt, and when switching models (results do not
transfer between models — the suite is what makes a model swap safe).
