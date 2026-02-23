# Email OS

> Every inbox is a signal field. Most people scroll. We harvest.

**Email OS** is a 6-agent email automation system that treats your Gmail inbox as a compound intelligence surface. Built on the [silicon-valley-os](../silicon-valley-os/) compound network patterns.

## Architecture

```
📥 Ingest  → Fetches + normalizes email from Gmail API
🏷️ Classify → Zone triage (🔴 Red / 🟡 Yellow / 🟢 Green)
🌱 Seed    → Plants typed seeds from high-signal emails
💬 Suggest → Drafts response + action suggestions
📊 Insight → Cross-thread intelligence + thread temperature
🪞 Mirror  → Reviews agent quality + evolves wisdom
```

All agents coordinate via an **Insight Bus** — no direct coupling.

## Quick Start

```bash
# 1. Setup Gmail OAuth2
cp .env.example .env
# Fill in your Google Cloud credentials (see .env.example)

# 2. Install
npm install

# 3. Authenticate with Gmail
npm run auth

# 4. Sync + process your inbox
npm run sync

# 5. Triage unread emails by zone
npm run triage

# 6. Daily digest
npm run digest
```

## Patterns Inherited

| Pattern | Source |
|---------|--------|
| Insight Bus | franchise-os |
| Invisible Intelligence | franchise-os |
| Single Source of Truth | keynote-studio |
| CEO Context Engine | ceo-os |
| Seed & Harvest Loop | research-lab |
| Anticipation Loop | franchise-os |
| Two-Tier Agent Wisdom | openclaw |
| State Machine Resilience | keynote-studio |
| Closed-Loop Tracking | closed-loop-tracker |
| Question-Guided Thinking | openclaw |
| Progressive Emotional Arc | keynote-studio |

## Patterns Contributed

| Pattern | Description |
|---------|-------------|
| **Thread Intelligence** | Model email threads as living entities with velocity, temperature, and trajectory |
| **Signal-to-Seed Pipeline** | Convert high-signal emails into typed seeds with shelf-life and escalation |
| **Zone-Aware Triage** | Classify emails into Red/Yellow/Green zones based on relationship depth + urgency |

## Config

Everything is driven from `config.json` — zones, seed types, agent settings, Gmail config. One file, one truth.

## License

MIT
