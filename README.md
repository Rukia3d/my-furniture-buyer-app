# My Furniture Buyer App

A buyer's app for a furniture shop, built for Day 1 of a hackathon. A user logs in,
browses a real product catalogue, and places orders against a real (event-only)
balance — and by Level 3, can simply type what they want ("find me a mustard accent
chair under $500") and an AI agent does the searching and ordering for them.

## Stack

- **Node.js + Express** (port 3003), EJS server-rendered pages
- **SQLite** — users, orders, cached product catalogue
- **Shared MongoDB** (read-only) — initial catalogue seed, product images and dimensions
- **Furniture-shop REST API** — live balance, real orders, invoices
- **Anthropic SDK** (Claude Haiku 4.5) — the Level 3 agent with four tools
- **ngrok** — public access to the running app
- Optional Step 8: Python FastAPI sidecar (port 8000) for vector RAG product Q&A

## Design decisions

- **Identity (Option A):** many local app users, each with a local balance; exactly one
  user is *linked* to the event API account. Local users exercise the Level 1 logic;
  the linked user exercises the real API.
- **Product table as cache:** catalogue seeded from MongoDB (images, dimensions),
  refreshed from the API's `search-index` at server start. Balance and orders are
  never cached — always live.
- **Orders mirrored locally** with `api_order_id` when placed through the real API.
- **Confirm-before-purchase enforced in tool code**, not in the prompt: `place_order`
  returns a preview first and only executes when the user's follow-up confirms.
- No cart — orders go straight from the product page or the agent.

## Status

Project setup in progress — see the repo issues for the milestone plan.
