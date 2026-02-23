# Changelog

All notable changes to MECHA-DASH will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

> **MAJOR.MINOR.PATCH**
> - MAJOR → breaking changes (new panel structure, API contract change)
> - MINOR → new features (new panel, new data source)
> - PATCH → bug fixes, copy tweaks, styling polish

## [1.3.0] — 2026-02-23

### Added
- **MECHA AI chat widget** (`mecha-chat.js`) — drop-in Intercom-style chat, connects to AI agent
- **API bridge** (`api-bridge.js`) — lightweight HTTP server bridging chat → agent backend
- **Cloudflare Tunnel support** — expose agent endpoint to anyone who clones the repo
- **Rate limiting** — 20 requests/min per session, in-memory
- **CORS support** — widget works from any origin
- **Mobile responsive** — chat window adapts to small screens

### Changed
- `index.html` — embedded MECHA_CONFIG + chat widget script tags
- `README.md` — full setup docs for agent integration
- `VERSION` → 1.3.0

## [1.2.0] — 2026-02-23

### Added
- **Seed data auto-load** — 5 realistic Taiwanese factory deployments populate on first visit
- **Email-OS bridge** — email intelligence signals surface in Engage and Compound panels
- **Toast notifications** — glassmorphic toasts for deployment, engagement, and copy actions
- **Pitch export** — copy proposal to clipboard with one click
- **Entrance animations** — staggered card slide-up, metric pop-in, deploy item fade-in
- **Status indicator** — pulsing green dot on MECHA-OS Revenue label
- **Table hover states** — row highlight on earnings table
- **Value pulse effect** — glow animation when live values update
- **LLM provider module** (`email-os/src/llm.js`) — Gemini + OpenAI via native fetch

### Changed
- `UI.init()` now async — loads seed data and email bridge before render
- `Store.loadSeedData()` fetches from `data/deployments.json` when localStorage empty
- Engage actions (Advance Stage, Plant Loop, Touch) now emit toast feedback
- Deploy badge counter dynamically updates

## [1.1.0] — 2026-02-23

### Added
- **email-os** — 6-agent email automation system (classify, ingest, suggest, mirror, seed, insight)
- Gmail API integration with OAuth2 auth flow
- Zone-aware triage (🔴 Red / 🟡 Yellow / 🟢 Green)
- Thread intelligence, signal-to-seed pipeline, zone-aware triage patterns
- Wisdom docs for all 6 agents

## [1.0.0] — 2026-02-23

### Added
- 5-panel deployment command center (DEPLOY, EARN, ENGAGE, COMPOUND, PITCH)
- Real-time robot earnings dashboard with live counters
- Desire Engine engagement loop runner
- Deployment learning tracker with compound visualization
- Visual ROI proposal generator
- Factory deployment data layer (`data/deployments.json`, `data/seeds.json`)
- Zero-dependency architecture — opens in browser, works on factory floor
