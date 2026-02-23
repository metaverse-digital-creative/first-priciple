#!/usr/bin/env node
/**
 * MECHA API Bridge v2 — with API Key auth + free tier limits
 * 
 * Tiers:
 *   - No key:     10 messages/day (demo)
 *   - Free key:   50 messages/day
 *   - Pro key:    unlimited ($29/mo)
 * 
 * Usage:
 *   node api-bridge.js
 *   PORT=3000 node api-bridge.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 18800;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';
const KEYS_FILE = path.join(__dirname, 'data', 'api-keys.json');

// ── API Keys Store ──
let apiKeys = {};
try {
  apiKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
} catch {
  apiKeys = {
    "_demo": { tier: "demo", limit: 10, name: "Anonymous" },
    "mecha-free-beta-2026": { tier: "free", limit: 50, name: "Beta Tester" },
    "mecha-pro-ck-001": { tier: "pro", limit: 999999, name: "CK (Admin)" }
  };
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(apiKeys, null, 2));
}

// ── Usage Tracking (daily reset) ──
const usage = new Map(); // key: `${apiKey}:${date}` → count

function getUsageKey(apiKey) {
  const date = new Date().toISOString().slice(0, 10);
  return `${apiKey}:${date}`;
}

function checkUsage(apiKey) {
  const key = getUsageKey(apiKey);
  const config = apiKeys[apiKey] || apiKeys['_demo'];
  const count = usage.get(key) || 0;
  return { count, limit: config.limit, remaining: config.limit - count, tier: config.tier };
}

function incrementUsage(apiKey) {
  const key = getUsageKey(apiKey);
  usage.set(key, (usage.get(key) || 0) + 1);
}

// Clean old usage entries daily
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key] of usage) {
    if (!key.endsWith(today)) usage.delete(key);
  }
}, 3600000);

// ── CORS ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400'
};

function json(res, status, body, extra = {}) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}

// ── Agent Call ──
function callAgent(agentId, sessionId, message) {
  try {
    const escaped = message.replace(/'/g, "'\\''");
    const cmd = `${OPENCLAW_BIN} agent --agent "${agentId}" --session-id "${sessionId}" --message '${escaped}' --timeout 120 --json 2>/dev/null`;
    const result = execSync(cmd, { encoding: 'utf8', timeout: 130000, maxBuffer: 1024 * 1024 });
    try {
      const parsed = JSON.parse(result);
      return { ok: true, reply: parsed.reply || parsed.message || result.trim() };
    } catch {
      return { ok: true, reply: result.trim() };
    }
  } catch (err) {
    console.error(`[agent-error] ${agentId}:`, err.message?.slice(0, 200));
    return { ok: false, reply: '抱歉，agent 暫時無法回應。請稍後再試。' };
  }
}

// ── Request Handler ──
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // Health
  if (req.method === 'GET' && req.url === '/api/v1/health') {
    return json(res, 200, { status: 'ok', agent: 'mecha', uptime: process.uptime() });
  }

  // Pricing info
  if (req.method === 'GET' && req.url === '/api/v1/pricing') {
    return json(res, 200, {
      tiers: {
        demo: { price: 'Free', limit: '10 messages/day', features: ['Chat with MECHA AI', 'First Principles coaching'] },
        free: { price: 'Free (with API key)', limit: '50 messages/day', features: ['Everything in Demo', 'Session persistence', 'Priority responses'] },
        pro: { price: '$29/month', limit: 'Unlimited', features: ['Everything in Free', 'Unlimited messages', '@validate idea pipeline', 'Daily intelligence digest', 'Priority support'] }
      },
      signup: 'https://metaverse-digital-creative.github.io/pricing'
    });
  }

  // Usage check
  if (req.method === 'GET' && req.url === '/api/v1/usage') {
    const apiKey = req.headers['x-api-key'] || '_demo';
    const u = checkUsage(apiKey);
    return json(res, 200, { tier: u.tier, used: u.count, limit: u.limit, remaining: u.remaining });
  }

  // Chat
  if (req.method === 'POST' && req.url === '/api/v1/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { agentId, sessionId, message } = JSON.parse(body);
        if (!message?.trim()) return json(res, 400, { error: 'message required' });

        // Auth
        const apiKey = req.headers['x-api-key'] || '_demo';
        if (apiKey !== '_demo' && !apiKeys[apiKey]) {
          return json(res, 401, { error: 'invalid API key' });
        }

        // Usage limit
        const u = checkUsage(apiKey);
        if (u.remaining <= 0) {
          return json(res, 429, {
            error: 'daily limit reached',
            tier: u.tier,
            limit: u.limit,
            upgrade: u.tier === 'demo'
              ? 'Get a free API key for 50 messages/day: https://metaverse-digital-creative.github.io/pricing'
              : 'Upgrade to Pro for unlimited: https://metaverse-digital-creative.github.io/pricing'
          });
        }

        const agent = 'mecha'; // Only mecha allowed
        const session = sessionId || `anon-${Date.now()}`;

        console.log(`[chat] tier=${u.tier} used=${u.count}/${u.limit} session=${session.slice(0,8)} msg="${message.slice(0,50)}"`);

        incrementUsage(apiKey);
        const result = callAgent(agent, session, message);

        return json(res, 200, {
          reply: result.reply,
          sessionId: session,
          usage: { tier: u.tier, used: u.count + 1, limit: u.limit, remaining: u.remaining - 1 }
        });

      } catch (err) {
        console.error('[parse-error]', err.message);
        return json(res, 400, { error: 'invalid request body' });
      }
    });
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`
🤖 MECHA API Bridge v2
   Port: ${PORT}
   
   Endpoints:
   POST /api/v1/chat      Chat with MECHA AI
   GET  /api/v1/health     Health check
   GET  /api/v1/pricing    Pricing tiers
   GET  /api/v1/usage      Check your usage
   
   Tiers:
   demo    10 msg/day   (no key)
   free    50 msg/day   (X-API-Key header)
   pro     unlimited    ($29/mo)
   
   Expose: cloudflared tunnel --url http://localhost:${PORT}
`);
});
