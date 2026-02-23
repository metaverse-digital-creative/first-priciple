# Changelog

All notable changes to MECHA-DASH will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

> **MAJOR.MINOR.PATCH**
> - MAJOR → breaking changes (new panel structure, API contract change)
> - MINOR → new features (new panel, new data source)
> - PATCH → bug fixes, copy tweaks, styling polish

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
