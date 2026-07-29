// The Level 3 agent: an Anthropic tool-calling loop over four shop tools.
// Tool implementations are injected, so the eval suite can swap in mocks
// and assert on the call trace without touching real data or the real API.

const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_ROUNDS = 8;
const PENDING_ORDER_TTL_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = `You are the shopping assistant for a furniture shop. You help the
logged-in customer find products, check their balance, and place orders, using only your tools.

Rules:
- The catalogue tools do the filtering (category, price, colour). For fuzzy requests
  ("cosy", "for a kid's room", "Scandinavian"), fetch candidate products and apply your own
  judgement over the results. Never claim the shop can search by anything the tools don't offer.
- Categories must match the catalogue's category names exactly; use search_products without a
  category rather than guessing a name that might not exist.
- Placing an order is a two-step process: your first place_order call returns a confirmation
  preview. Relay it (item, quantity, total, balance) and STOP — wait for the customer to
  clearly agree in their next message before calling place_order again with the confirm_token.
  Never invent a confirm_token. If they decline, drop it.
- If a tool reports an error (insufficient balance, unavailable item), explain it in plain,
  friendly language and suggest an alternative. Never retry a failed order on your own.
- Keep replies short and conversational. Prices in dollars. Refer to products by name.
- Whenever you mention or recommend a specific product, include its id exactly in the form
  (item 12345678) right after the product name — the shop UI turns these into preview cards.
- You only act for the logged-in customer; you cannot see other customers' data.
- For questions unrelated to furniture shopping, politely say it's outside what you can help
  with — do not call tools for it.`;

const TOOLS = [
  {
    name: 'search_products',
    description:
      'Search the furniture catalogue. Filters: exact category name (case-insensitive), price range, ' +
      'colour, and a text match on the product name. There is NO fuzzy/semantic search — for vague ' +
      'requests, fetch a broader set and judge the results yourself. Returns up to `limit` products ' +
      'without images.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Exact category name, e.g. "Chairs", "Beds", "Tables & desks"' },
        max_price: { type: 'number' },
        min_price: { type: 'number' },
        colour: { type: 'string', description: 'A single colour word, e.g. "mustard"' },
        name_contains: { type: 'string', description: 'Substring of the product name, e.g. "bookcase"' },
        limit: { type: 'integer', description: 'Max results, default 10, max 25' },
      },
    },
  },
  {
    name: 'get_product_details',
    description: 'Full details for one product by its item_id: price, colours, and dimensions (cm).',
    input_schema: {
      type: 'object',
      properties: { item_id: { type: 'string' } },
      required: ['item_id'],
    },
  },
  {
    name: 'check_balance',
    description: "The logged-in customer's current balance in dollars. Takes no parameters.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'place_order',
    description:
      'Place an order for the logged-in customer. Two-step: call WITHOUT confirm_token first to get ' +
      'a preview for the customer to approve; after they clearly agree in a later message, call again ' +
      'WITH the confirm_token from the preview. Tokens come only from previews — never make one up.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        quantity: { type: 'integer', description: 'Default 1' },
        confirm_token: { type: 'string', description: 'Only after the customer has approved the preview' },
      },
      required: ['item_id'],
    },
  },
];

// Default tool implementations — real services. The eval harness passes its own.
function realToolImpls() {
  const db = require('../db/db');
  const account = require('./account');
  return {
    async search_products(input) {
      const limit = Math.min(Math.max(input.limit || 10, 1), 25);
      const clauses = [];
      const params = [];
      if (input.category) { clauses.push('LOWER(category) = LOWER(?)'); params.push(input.category); }
      if (input.max_price != null) { clauses.push('price <= ?'); params.push(input.max_price); }
      if (input.min_price != null) { clauses.push('price >= ?'); params.push(input.min_price); }
      if (input.colour) { clauses.push("LOWER(colours) LIKE '%' || LOWER(?) || '%'"); params.push(input.colour); }
      if (input.name_contains) { clauses.push("LOWER(product_name) LIKE '%' || LOWER(?) || '%'"); params.push(input.name_contains); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT item_id, product_name, price, category, colours
        FROM products ${where} ORDER BY price LIMIT ?
      `).all(...params, limit);
      return { count: rows.length, products: rows.map(r => ({ ...r, colours: JSON.parse(r.colours || '[]') })) };
    },
    async get_product_details(input) {
      const row = db.prepare(`
        SELECT item_id, product_name, price, category, colours, depth, height, width
        FROM products WHERE item_id = ?
      `).get(input.item_id);
      if (!row) return { error: 'not_found', message: 'No product with that item_id.' };
      return { ...row, colours: JSON.parse(row.colours || '[]') };
    },
    async check_balance(input, user) {
      const balance = await account.getBalance(user);
      return { balance };
    },
    async execute_order(user, itemId, quantity) {
      try {
        const r = await account.placeOrder(user, itemId, quantity);
        return {
          status: 'success',
          product_name: r.product.product_name,
          total: r.total,
          remaining_balance: r.remainingBalance,
        };
      } catch (err) {
        if (err instanceof account.OrderError) return { error: err.code, message: err.message };
        throw err;
      }
    },
  };
}

// A conversation with tool access for one user. Holds message history and
// the pending-order token — the server-side latch that makes an unconfirmed
// purchase impossible regardless of what the model does.
class AgentSession {
  constructor(user, toolImpls = realToolImpls(), client = new Anthropic()) {
    this.user = user;
    this.impls = toolImpls;
    this.client = client;
    this.messages = [];
    this.pendingOrder = null;
  }

  async runTool(name, input) {
    if (name === 'search_products') return this.impls.search_products(input, this.user);
    if (name === 'get_product_details') return this.impls.get_product_details(input, this.user);
    if (name === 'check_balance') return this.impls.check_balance(input, this.user);
    if (name === 'place_order') return this.placeOrder(input);
    return { error: 'unknown_tool', message: `No tool named ${name}` };
  }

  async placeOrder(input) {
    const quantity = Math.min(Math.max(parseInt(input.quantity, 10) || 1, 1), 10);

    // Step 2: a valid, unexpired token executes the order.
    if (input.confirm_token) {
      const p = this.pendingOrder;
      if (!p || p.token !== input.confirm_token || Date.now() > p.expiresAt) {
        this.pendingOrder = null;
        return {
          error: 'invalid_confirmation',
          message: 'That confirmation is not valid (expired or unknown). Start again with a new preview.',
        };
      }
      this.pendingOrder = null;
      return this.impls.execute_order(this.user, p.itemId, p.quantity);
    }

    // Step 1: build a preview and mint the token.
    const details = await this.impls.get_product_details({ item_id: input.item_id }, this.user);
    if (details.error) return details;
    const balanceInfo = await this.impls.check_balance({}, this.user);
    const total = details.price * quantity;
    const token = crypto.randomBytes(8).toString('hex');
    this.pendingOrder = {
      token,
      itemId: input.item_id,
      quantity,
      expiresAt: Date.now() + PENDING_ORDER_TTL_MS,
    };
    return {
      status: 'needs_confirmation',
      confirm_token: token,
      product_name: details.product_name,
      quantity,
      unit_price: details.price,
      total,
      current_balance: balanceInfo.balance,
      instruction: 'Show this to the customer and wait for their clear approval in their NEXT message before confirming.',
    };
  }

  async send(userText, onTrace = () => {}) {
    this.messages.push({ role: 'user', content: userText });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: this.messages,
      });

      this.messages.push({ role: 'assistant', content: response.content });
      const toolUses = response.content.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0 || response.stop_reason !== 'tool_use') {
        return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      }

      const results = [];
      for (const call of toolUses) {
        onTrace({ tool: call.name, input: call.input });
        let result;
        try {
          result = await this.runTool(call.name, call.input);
        } catch (err) {
          result = { error: 'tool_failed', message: err.message };
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      }
      this.messages.push({ role: 'user', content: results });
    }
    return 'Sorry — that took too many steps. Could you rephrase or narrow down what you need?';
  }
}

module.exports = { AgentSession, TOOLS, SYSTEM_PROMPT, realToolImpls };
