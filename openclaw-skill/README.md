# OpenClaw furniture-shop skill (ticket S2)

Packages the same four shop tools as the in-app assistant as a skill for
[OpenClaw](https://openclaw.ai), so you can shop via your own WhatsApp.

**This folder is the source of truth for the skill; `~/.openclaw/skills/` holds
the deployed copy.** For how the whole integration fits together — architecture,
what was installed where, safety differences, and the setup gotchas we hit —
see [`../docs/openclaw.md`](../docs/openclaw.md).

## Setup (manual, ~10 min)

1. **Install OpenClaw** (review what it asks for — it's a personal agent
   with real access to your machine):

   ```bash
   npm install -g openclaw
   openclaw onboard
   ```

2. **Connect WhatsApp** per OpenClaw's own docs (QR scan from your phone).

3. **Install this skill** — copy the folder into OpenClaw's skills directory:

   ```bash
   cp -r openclaw-skill/furniture-shop ~/.openclaw/skills/
   ```

4. **Give it the credentials** — add to OpenClaw's environment (its config
   file or the shell it runs from), using the same values as this app's
   `.env`:

   ```
   SHOP_API_BASE_URL=…  SHOP_API_KEY=…  SHOP_API_USER_ID=…
   ```

5. **Restrict permissions**: grant OpenClaw only this skill — not broader
   machine access it offers. Orders here spend the real event balance.

6. **Test from WhatsApp**: "find me a chair under $50", then a purchase —
   it must state item + price + balance and wait for your explicit yes
   before ordering.

## Safety notes

- The confirm-before-purchase rule here is prompt-enforced only — unlike the
  in-app assistant there is no server-side token latch, because OpenClaw
  calls the shop API directly. Treat it accordingly.
- Anything OpenClaw does through WhatsApp is really happening on your
  account.
