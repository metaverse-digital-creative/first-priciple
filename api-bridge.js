#!/usr/bin/env node
/**
 * MECHA API Bridge
 * Lightweight HTTP server that bridges MECHA-DASH chat widget → OpenClaw agent.
 * 
 * Runs on Mac Mini, exposed via Cloudflare Tunnel.
 * 
 * Usage:
 *   node api-bridge.js                    # default port 18800
 *   PORT=3000 node api-bridge.js          # custom port
 * 
 * Endpoints:
 *   POST /api/v1/chat   { agentId, sessionId, message } → { reply }
 *   GET  /api/v1/health  → { status: "ok" }
 */

const http = require('http');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 18800;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';

// ── CORS headers ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── Agent call via OpenClaw CLI ──
function callAgent(agentId, sessionId, message) {
  try {
    const escaped = message.replace(/'/g, "'\\''");
    const cmd = `${OPENCLAW_BIN} agent --agent "${agentId}" --session-id "${sessionId}" --message '${escaped}' --timeout 120 --json 2>/dev/null`;
    
    const result = execSync(cmd, {
      encoding: 'utf8',
      timeout: 130000,
      maxBuffer: 1024 * 1024
    });

    // Parse response — openclaw agent --json returns structured output
    try {
      const parsed = JSON.parse(result);
      // Extract reply text from various possible formats
      const reply = parsed.reply
        || parsed.message
        || (parsed.result?.payloads?.map(p => p.text).filter(Boolean).join('\n'))
        || result.trim();
      return { ok: true, reply };
    } catch {
      // If JSON parse fails, use raw output
      return { ok: true, reply: result.trim() };
    }
  } catch (err) {
    console.error(`[agent-error] ${agentId}:`, err.message);
    return { ok: false, reply: '抱歉，agent 暫時無法回應。請稍後再試。' };
  }
}

// ── Rate limiting (simple in-memory) ──
const rateLimits = new Map();
const RATE_LIMIT = 20; // requests per minute per session
const RATE_WINDOW = 60000;

function checkRate(sessionId) {
  const now = Date.now();
  const record = rateLimits.get(sessionId) || { count: 0, resetAt: now + RATE_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW;
  }
  
  record.count++;
  rateLimits.set(sessionId, record);
  
  return record.count <= RATE_LIMIT;
}

// Clean up rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimits) {
    if (now > val.resetAt + RATE_WINDOW) rateLimits.delete(key);
  }
}, 300000);

// ── Request handler ──
const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // Health check
  if (req.method === 'GET' && req.url === '/api/v1/health') {
    return json(res, 200, { status: 'ok', agent: 'mecha', uptime: process.uptime() });
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/api/v1/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { agentId, sessionId, message } = JSON.parse(body);

        if (!message || !message.trim()) {
          return json(res, 400, { error: 'message required' });
        }

        const agent = agentId || 'mecha';
        const session = sessionId || 'anonymous-' + Date.now();

        // Validate agent — only allow mecha
        if (agent !== 'mecha') {
          return json(res, 403, { error: 'unauthorized agent' });
        }

        // Rate limit
        if (!checkRate(session)) {
          return json(res, 429, { error: 'rate limited', retry_after: 60 });
        }

        console.log(`[chat] session=${session.slice(0,8)} msg="${message.slice(0,50)}..."`);

        const result = callAgent(agent, session, message);
        return json(res, 200, { reply: result.reply, sessionId: session });

      } catch (err) {
        console.error('[parse-error]', err.message);
        return json(res, 400, { error: 'invalid request body' });
      }
    });
    return;
  }

  // 404
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`\n🤖 MECHA API Bridge running on port ${PORT}`);
  console.log(`   POST /api/v1/chat    → Chat with agent`);
  console.log(`   GET  /api/v1/health  → Health check\n`);
  console.log(`   Expose via: cloudflared tunnel --url http://localhost:${PORT}\n`);
});
