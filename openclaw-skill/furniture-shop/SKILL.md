---
name: furniture-shop
description: >
  Search a furniture catalogue, check the account balance, and place real
  orders at the event furniture shop. Use when the user asks about buying
  furniture, browsing chairs/tables/beds etc., their shop balance, or their
  furniture orders.
---

# Furniture shop skill

You can act on the user's furniture-shop account via its REST API. The base
URL and credentials come from environment variables set in OpenClaw's config:
`SHOP_API_BASE_URL`, `SHOP_API_KEY`, `SHOP_API_USER_ID`.

These are the same four tools as the in-app assistant, with the same rules.

## Tools

### 1. Search the catalogue

The search is EXACT category matching only (case-insensitive) — no fuzzy or
semantic search. For vague requests ("something cosy", "for a kid's room"),
fetch a broader set and apply your own judgement over the results. Never
imply the API can filter by price, colour, or style — filter those yourself
from the returned JSON.

```bash
curl -s "$SHOP_API_BASE_URL/catalogue/search-index?category=Chairs&limit=25"
# categories list:
curl -s "$SHOP_API_BASE_URL/catalogue/categories"
```

Never call plain `/catalogue` — it embeds every product image as base64 and
is extremely slow. Never fetch product images at all; describe products in
text.

### 2. Look up one product

```bash
curl -s "$SHOP_API_BASE_URL/catalogue/<item_id>"
```

Use only when the user wants detail on one specific item. The response
includes a large base64 image field — ignore it; report name, price,
category, colours only.

### 3. Check balance

```bash
curl -s "$SHOP_API_BASE_URL/users/$SHOP_API_USER_ID" -H "X-Api-Key: $SHOP_API_KEY"
```

### 4. Place an order — REAL MONEY, confirmation REQUIRED

`POST /orders` debits a real (event) balance. NON-NEGOTIABLE RULE: before
placing any order, message the user the exact item name, quantity, total
price, and current balance, and WAIT for their explicit yes in a reply.
Never order without it; never retry a failed order without asking.

```bash
curl -s -X POST "$SHOP_API_BASE_URL/orders" \
  -H "X-Api-Key: $SHOP_API_KEY" -H "Content-Type: application/json" \
  -d '{"user_id": "'$SHOP_API_USER_ID'", "items": [{"item_id": "<item_id>", "quantity": 1}]}'
```

Note the body shape: an `items` array of `{item_id, quantity}` — a flat
`{item_id, quantity}` body is rejected with 422.

## Error handling

- 402: insufficient balance — tell the user their balance and the price gap.
- 404: unknown item — say it isn't in the catalogue; suggest a search.
- 429: rate limited — wait the `Retry-After` seconds, then you may retry
  reads (never orders) once.
- 401/403: credentials problem — tell the user to check the skill's env
  configuration; do not retry.

Only ever act for `$SHOP_API_USER_ID` — the key cannot act for anyone else.
