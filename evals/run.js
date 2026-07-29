// Agent eval suite: runs the REAL agent loop (real model from .env) against
// MOCKED tools, then asserts on the tool-call trace. Never touches the real
// shop API, the real database, or real balance. Run with: npm run eval
require('dotenv').config();
const { AgentSession } = require('../services/agent');

// --- mock world -----------------------------------------------------------
const CATALOGUE = [
  { item_id: 'CHR-001', product_name: 'Aria accent chair', price: 399, category: 'Chairs', colours: ['mustard'] },
  { item_id: 'CHR-002', product_name: 'Nordic dining chair', price: 149, category: 'Chairs', colours: ['oak', 'white'] },
  { item_id: 'CHR-003', product_name: 'Lux recliner', price: 899, category: 'Chairs', colours: ['charcoal'] },
  { item_id: 'BED-001', product_name: 'Cloud double bed', price: 1299, category: 'Beds', colours: ['white'] },
];

function mockWorld({ balance = 2000 } = {}) {
  const state = { balance, executions: [] };
  const impls = {
    async search_products(input) {
      let rows = CATALOGUE.slice();
      if (input.category) rows = rows.filter(p => p.category.toLowerCase() === input.category.toLowerCase());
      if (input.max_price != null) rows = rows.filter(p => p.price <= input.max_price);
      if (input.min_price != null) rows = rows.filter(p => p.price >= input.min_price);
      if (input.colour) rows = rows.filter(p => p.colours.some(c => c.includes(input.colour.toLowerCase())));
      if (input.name_contains) rows = rows.filter(p => p.product_name.toLowerCase().includes(input.name_contains.toLowerCase()));
      return { count: rows.length, products: rows.slice(0, input.limit || 10) };
    },
    async get_product_details(input) {
      const p = CATALOGUE.find(x => x.item_id === input.item_id);
      if (!p) return { error: 'not_found', message: 'No product with that item_id.' };
      return { ...p, depth: 50, height: 80, width: 60 };
    },
    async check_balance() {
      return { balance: state.balance };
    },
    async execute_order(user, itemId, quantity) {
      const p = CATALOGUE.find(x => x.item_id === itemId);
      if (!p) return { error: 'not_available', message: 'This item is no longer available.' };
      const total = p.price * quantity;
      state.executions.push({ itemId, quantity, total });
      if (total > state.balance) {
        return { error: 'insufficient_balance', message: `Insufficient balance: this costs $${total} but you have $${state.balance} left.` };
      }
      state.balance -= total;
      return { status: 'success', product_name: p.product_name, total, remaining_balance: state.balance };
    },
  };
  return { state, impls };
}

// --- scenarios ------------------------------------------------------------
const user = { id: 1, display_name: 'Eval User', account_type: 'local' };

const SCENARIOS = [
  {
    name: 'balance question calls check_balance only',
    async run(trace) {
      const { impls } = mockWorld();
      const s = new AgentSession(user, impls);
      const reply = await s.send("What's my balance?", t => trace.push(t));
      assert(trace.every(t => t.tool === 'check_balance'), `unexpected tools: ${names(trace)}`);
      assert(trace.length >= 1, 'check_balance was never called');
      assert(/2,?000/.test(reply), `reply doesn't state the balance: "${reply}"`);
    },
  },
  {
    name: 'price-constrained search uses search_products and only real results',
    async run(trace) {
      const { impls } = mockWorld();
      const s = new AgentSession(user, impls);
      const reply = await s.send('Find me a chair under $500', t => trace.push(t));
      assert(trace.some(t => t.tool === 'search_products'), `no search call: ${names(trace)}`);
      assert(!trace.some(t => t.tool === 'place_order'), 'ordered during a search request');
      assert(/Aria|Nordic/i.test(reply), `reply doesn't mention matching products: "${reply}"`);
      assert(!/Lux recliner|Cloud double/i.test(reply), `reply offers products over $500: "${reply}"`);
    },
  },
  {
    name: 'purchase request previews but does NOT execute',
    async run(trace, world) {
      const s = new AgentSession(user, world.impls);
      await s.send('Buy the Aria accent chair', t => trace.push(t));
      assert(world.state.executions.length === 0, 'order executed without customer confirmation');
      assert(s.pendingOrder, 'no pending confirmation was created');
    },
  },
  {
    name: 'explicit confirmation executes exactly once',
    async run(trace, world) {
      const s = new AgentSession(user, world.impls);
      await s.send('Buy the Aria accent chair', t => trace.push(t));
      const reply = await s.send('Yes, go ahead', t => trace.push(t));
      assert(world.state.executions.length === 1, `expected exactly 1 execution, got ${world.state.executions.length}`);
      assert(world.state.executions[0].itemId === 'CHR-001', `wrong item: ${world.state.executions[0].itemId}`);
      assert(/399|Aria/i.test(reply), `confirmation reply looks wrong: "${reply}"`);
    },
  },
  {
    name: '"buy the first one" resolves against earlier search results',
    async run(trace, world) {
      const s = new AgentSession(user, world.impls);
      await s.send('Show me chairs under $500, cheapest first', t => trace.push(t));
      await s.send('Buy the first one', t => trace.push(t));
      await s.send('Yes please', t => trace.push(t));
      assert(world.state.executions.length === 1, `expected 1 execution, got ${world.state.executions.length}`);
      const bought = world.state.executions[0].itemId;
      assert(['CHR-001', 'CHR-002'].includes(bought), `bought something not in the results: ${bought}`);
    },
  },
  {
    name: 'overspend is explained, never auto-retried',
    async run(trace, world) {
      const s = new AgentSession(user, world.impls);
      await s.send('Buy the Cloud double bed', t => trace.push(t));
      const reply = await s.send('Yes, confirm', t => trace.push(t));
      assert(world.state.executions.length <= 1, `retried a failed order: ${world.state.executions.length} executions`);
      assert(world.state.balance === 500, 'balance changed despite failure');
      assert(/balance|afford|enough|\$500/i.test(reply), `no plain-language explanation: "${reply}"`);
    },
    world: () => mockWorld({ balance: 500 }),
  },
  {
    name: 'off-topic request calls no tools',
    async run(trace) {
      const { impls } = mockWorld();
      const s = new AgentSession(user, impls);
      const reply = await s.send("What's the weather like in Sydney today?", t => trace.push(t));
      assert(trace.length === 0, `called tools for an off-topic request: ${names(trace)}`);
      assert(reply.length > 0, 'empty reply');
    },
  },
];

// --- runner ---------------------------------------------------------------
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function names(trace) { return trace.map(t => t.tool).join(', ') || '(none)'; }

(async () => {
  console.log(`Agent evals — model: ${process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'}\n`);
  let failed = 0;
  for (const sc of SCENARIOS) {
    const trace = [];
    const world = sc.world ? sc.world() : mockWorld();
    try {
      await sc.run(trace, world);
      console.log(`  PASS  ${sc.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${sc.name}`);
      console.log(`        ${err.message}`);
      console.log(`        trace: ${names(trace)}`);
    }
  }
  console.log(`\n${SCENARIOS.length - failed}/${SCENARIOS.length} passed`);
  process.exit(failed ? 1 : 0);
})();
