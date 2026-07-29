# CLAUDE.md — standing instructions for this project

## What this project is

A buyer's app for a furniture shop, built during a one-day hackathon (Day 1).
A user logs in, browses a real product catalogue, and places orders against a
real (event-only) balance. By Level 3, a chat agent lets them type what they
want in plain English instead of clicking buttons.

Read `requirements.md` for what the app must do and `architecture.md` for how
it's built (entity model, identity design, services). Work is tracked as GitHub
issues on this repo — one issue per milestone, each with "done when" criteria.

## Stack (decided — do not change without asking)

- **Node.js + Express**, EJS server-rendered templates, vanilla JS only where
  needed (Buy button, chat box). No React, no build step, no TypeScript.
- **SQLite** for users, orders, and the cached product catalogue.
- **express-session** cookie sessions + **bcrypt** password hashes.
- **Anthropic SDK** for the Level 3 agent. Model ID comes from `.env`
  (`ANTHROPIC_MODEL`, default `claude-haiku-4-5`).
- Optional Step 8 RAG lives in a separate Python FastAPI sidecar (port 8000),
  called server-to-server. Nothing in this app may hard-depend on it.

## Ports

- Express: **3003** — always read from `PORT` in `.env`, never hardcoded.
- RAG sidecar (if built): **8000** (`RAG_URL` in `.env`).
- 3000, 4000, 5000, 7000, 8081 are taken/reserved on this machine. Never use them.

## Secrets — non-negotiable

- The repo is **public**. Every secret (furniture-shop API key, MongoDB
  connection string, session secret, Anthropic API key) lives in `.env` only.
- `.env` must be in `.gitignore` from the first commit that creates it;
  `.env.example` (with placeholder values, real port numbers) is committed.
- Never print secrets in logs, error messages, or commit messages.

## External services

- **Furniture-shop API** (base URL in `.env`): balance, orders, invoices are
  ALWAYS live calls — never cached. Catalogue browsing uses
  `/catalogue/search-index`; NEVER call plain `/catalogue` (huge base64
  payloads, strict rate limit). Product images come from the MongoDB
  `image_url` field, never base64 endpoints.
- **Shared MongoDB** (read-only, catalogue only): initial product seed,
  images, dimensions.

## Rules that must hold all day

- Overspend blocking and duplicate-order guarding are **server-side** rules;
  UI-only checks are not enough.
- The agent's `place_order` tool must never execute a purchase without the
  user's explicit confirmation, enforced in tool code (pending-token pattern
  per `architecture.md`) — not by prompt instructions alone.
- API errors (401/402/403/404/429) must surface as friendly messages, never
  crashes or raw error dumps.
- Plain-English commit messages. Commit at every working milestone, not in
  one big batch.
- **Every completed ticket ends with a push**: commit referencing the issue
  (e.g. "Auth with sessions and seeded users (closes #3)"), `git push`, and
  confirm the issue is closed on GitHub. Never leave a finished ticket
  unpushed.
- One milestone at a time; verify in the browser before moving on.
- Three eval suites guard the app — `npm run eval` (agent), `npm run eval:rag`
  (RAG retrieval), `npm run test:e2e` (browser). `docs/evals.md` is the
  tracking document: every scenario is listed there, and any change to a
  suite MUST update that file in the same commit. Re-run the relevant suite
  after touching what it guards (see the "re-run after" notes in the doc).
