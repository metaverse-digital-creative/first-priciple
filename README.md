# MECHA-DASH

> 機器人出去上班 · 替老闆賺錢 — Robot Deployment Command Center

**The 113KB brain finally has hands.**

## What This Is

A deployment command center that turns robot-as-a-worker strategy into revenue. 5 panels, one mission: make money first, compound toward the platform.

## Panels

| Panel | Purpose | Bottleneck It Solves |
|---|---|---|
| **DEPLOY** | 5-step factory onboarding wizard | "How do I start?" |
| **EARN** | Real-time robot earnings dashboard | "Is this making money?" |
| **ENGAGE** | Desire Engine loop runner | "How do I keep the boss hooked?" |
| **COMPOUND** | Deployment learning tracker | "What did we learn?" |
| **PITCH** | Visual ROI proposal generator | "How do I close the next deal?" |

## MECHA AI (Built-in Agent)

Bottom-right chat widget connects to MECHA AI — an agent that helps you deploy, earn, and think in first principles.

### Setup

1. Start the API bridge:
```bash
node api-bridge.js
```

2. Start a Cloudflare Tunnel (or use localhost):
```bash
cloudflared tunnel --url http://localhost:18800
```

3. Update `MECHA_CONFIG.endpoint` in `index.html` with your tunnel URL.

4. Open `index.html` — chat widget appears bottom-right.

### Configuration

In `index.html`:
```javascript
window.MECHA_CONFIG = {
  endpoint: 'https://your-tunnel-url.trycloudflare.com',
  agentId: 'mecha',
  title: 'MECHA AI',
  subtitle: 'First Principles • Deploy • Earn'
};
```

## Run

```bash
open index.html
```

No framework. No npm. No build step. Opens in browser, works on factory floor.

## First Principles

1. Start with the thing that makes money fastest
2. Identify the biggest cost/bottleneck
3. Vertically integrate that one thing
4. Use that control to make everyone else dependent on you
5. Turn the dependency into a platform

## Architecture

```
MECHA-DASH (browser, zero dependencies)
  ├── index.html      — 5-panel UI
  ├── app.js          — state management + rendering
  ├── styles.css      — glassmorphic dark theme
  ├── mecha-chat.js   — AI chat widget (drop-in)
  ├── api-bridge.js   — HTTP bridge to agent backend
  ├── email-bridge.js — email intelligence integration
  ├── email-os/       — 6-agent email automation
  └── data/           — seed deployments + research data
```

## Origin

Built by stripping 21 Antigravity IDE projects to their atoms and extracting only what ships revenue.
