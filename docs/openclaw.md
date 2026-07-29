# OpenClaw / WhatsApp integration

How the shop's tools reached WhatsApp (event Step 9, ticket S2). Companion to
`docs/agent.md` (the in-app assistant) — read that first if you want the
comparison to make sense.

## What this is, and what it proves

[OpenClaw](https://openclaw.ai) is a free, open-source **personal AI agent that
runs on your own laptop** and acts through apps you already use — here,
WhatsApp. It is not part of this web app and not a cloud service; there is no
OpenClaw account to sign up for.

We gave it a *skill* containing the same four shop actions the in-app assistant
has. The point is not new capability — it can do nothing the assistant can't —
it's **portability**: the tool definitions written for Level 3 work unchanged
inside a completely different agent host. Good tools are an interface, not
something welded into one app.

## The architecture

```
Your phone (WhatsApp)
        │
        ▼  (WhatsApp's own servers)
OpenClaw gateway  ── LaunchAgent on your Mac, port 18790
        │  loads: furniture-shop skill  +  SHOP_API_* env
        │  reasons with: Claude (your ANTHROPIC_API_KEY)
        ▼
Furniture-shop REST API  ── https://day1.training.cognitivo.com.au
```

Note what is **absent**: this app. OpenClaw calls the shop API *directly*. It
never touches Express on 3003, never reads the SQLite database, and never sees
the local product cache. Your app can be stopped and WhatsApp shopping still
works — and conversely, nothing OpenClaw does appears in the app's order
history (only in the shop API's own records).

## What was actually installed

| Piece | Where |
|---|---|
| OpenClaw 2026.7.1-2 | global npm package |
| Gateway daemon | `~/Library/LaunchAgents/ai.openclaw.gateway.plist`, port **18790**, working dir `~/.openclaw` |
| WhatsApp plugin | `@openclaw/whatsapp`, installed from ClawHub on first `channels add` |
| WhatsApp session | `~/.openclaw/credentials/whatsapp` (device-link keys — treat as secret) |
| The skill | `~/.openclaw/skills/furniture-shop/SKILL.md`, copied from `openclaw-skill/` in this repo |
| Shop credentials | `env` block in `~/.openclaw/openclaw.json`: `SHOP_API_BASE_URL`, `SHOP_API_KEY`, `SHOP_API_USER_ID` |
| Model auth | Anthropic API key, entered during `openclaw onboard` |

The repo copy (`openclaw-skill/furniture-shop/SKILL.md`) is the source of
truth; `~/.openclaw/skills/` holds the deployed copy. Edit the repo version and
re-copy.

## How the skill works

`SKILL.md` is a markdown file with YAML frontmatter — a name, a description
that tells the agent *when* the skill is relevant, then instructions and `curl`
examples for each action. There is no code: the agent reads the file and runs
the commands itself, substituting the env vars.

It documents the same four actions as the in-app assistant, with the same
honest caveats:

1. **Search** — `/catalogue/search-index`, exact category matching only; the
   file explicitly tells the agent to filter price/colour/style itself over the
   results and never to imply the API can do it.
2. **Product detail** — `/catalogue/{item_id}`, with a warning to ignore the
   huge base64 image field and never to call plain `/catalogue`.
3. **Balance** — `/users/{id}` with the `X-Api-Key` header.
4. **Place order** — `POST /orders` with the corrected body shape
   (`{user_id, items: [{item_id, quantity}]}` — the flat body in the event
   guide 422s), preceded by a mandatory confirmation step.

Plus the error contract (402 / 404 / 429 / 401-403) and the rule that it can
only ever act as one shop user.

## Safety: weaker than the in-app agent, deliberately noted

The in-app assistant cannot place an unconfirmed order **structurally** — the
server mints a random token on the preview call and only redeems it on a second
call, so no amount of model enthusiasm can skip the step (see `docs/agent.md`).

Over WhatsApp there is **no such latch**: OpenClaw hits the shop API directly,
so "state the item, price and balance, then wait for an explicit yes" is a
*prompt instruction only*. It has held in testing, but it is a softer guarantee
and should be described that way in any demo.

Other things worth knowing:

- OpenClaw runs with real access to your machine and your real WhatsApp
  account; only the furniture-shop skill was granted, per the event's safety
  note.
- The WhatsApp session in `~/.openclaw/credentials/` is equivalent to a linked
  device. Deleting that folder unlinks it.
- Everything stops when the laptop sleeps.

## Operating it

```bash
# all commands need Node ≥24.15 — nvm use 24
openclaw gateway status                 # is the daemon alive?
openclaw channels status                # is WhatsApp linked and healthy?
openclaw gateway restart                # after changing the skill or env
openclaw channels login --channel whatsapp   # re-link (QR); run in a real terminal
```

To use it: open WhatsApp, go to the **Message Yourself** chat, and send
something like "find me a chair under $50". The reply arrives in that chat.

**Re-linking gotcha:** if the QR loop keeps saying "link your device and try
again", delete `~/.openclaw/credentials/whatsapp` and restart the gateway — a
half-finished pairing attempt invalidates new QRs. That was the failure hit
during setup.

**Node version gotcha:** the WhatsApp plugin requires plugin API ≥2026.7.1,
which requires a newer OpenClaw, which requires Node ≥24.15 — the machine was
on 24.8, so Node was upgraded to 24.18 and the gateway service re-installed to
point at it. An old terminal tab on the previous Node will fail confusingly.

## Reproducing from scratch

```bash
npm install -g openclaw
openclaw onboard                        # choose Anthropic auth, paste key
openclaw channels add --channel whatsapp
openclaw channels login --channel whatsapp   # scan QR from your phone
cp -r openclaw-skill/furniture-shop ~/.openclaw/skills/
# add SHOP_API_BASE_URL / SHOP_API_KEY / SHOP_API_USER_ID to the "env"
# object in ~/.openclaw/openclaw.json
openclaw gateway restart
```

Then message yourself on WhatsApp to test.
