# MECHA-DASH

> 機器人出去上班 · 替老闆賺錢 — Robot Deployment Command Center

**The 113KB brain finally has hands.**

## What This Is

A deployment command center that turns robot-as-a-worker strategy into revenue. 5 panels, one mission: make money first, compound toward the platform.

## Run

```bash
open index.html
```

No framework. No npm. No build step. Opens in browser, works on factory floor.

**MECHA AI chat widget (bottom-right) works out of the box** — it connects to our hosted agent service. Just open and chat.

## Panels

| Panel | Purpose | Bottleneck It Solves |
|---|---|---|
| **DEPLOY** | 5-step factory onboarding wizard | "How do I start?" |
| **EARN** | Real-time robot earnings dashboard | "Is this making money?" |
| **ENGAGE** | Desire Engine loop runner | "How do I keep the boss hooked?" |
| **COMPOUND** | Deployment learning tracker | "What did we learn?" |
| **PITCH** | Visual ROI proposal generator | "How do I close the next deal?" |

## MECHA AI

The chat widget in the bottom-right corner connects to MECHA AI — an agent that helps you deploy, earn, and think in first principles. **No setup required.** It connects to our hosted agent service automatically.

### For self-hosting (optional)

If you want to run your own agent backend:

1. Install [OpenClaw](https://github.com/openclaw/openclaw)
2. Start the API bridge: `node api-bridge.js`
3. Update `MECHA_CONFIG.endpoint` in `index.html` to `http://localhost:18800`

## First Principles

1. Start with the thing that makes money fastest
2. Identify the biggest cost/bottleneck
3. Vertically integrate that one thing
4. Use that control to make everyone else dependent on you
5. Turn the dependency into a platform

## Architecture

```
MECHA-DASH (browser, zero dependencies)
  ├── index.html        — 5-panel UI + MECHA AI config
  ├── app.js            — state management + rendering
  ├── styles.css        — glassmorphic dark theme
  ├── mecha-chat.js     — AI chat widget (connects to hosted agent)
  ├── api-bridge.js     — [optional] self-host agent backend
  ├── email-bridge.js   — email intelligence integration
  ├── email-os/         — 6-agent email automation
  └── data/             — seed deployments + research data
```

## Origin

Built by stripping 21 Antigravity IDE projects to their atoms and extracting only what ships revenue.
