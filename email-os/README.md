# Email-OS — Intelligence-Driven Email Automation

6-agent system on an Insight Bus that triages, classifies, and generates actionable suggestions from your Gmail inbox.

## Architecture

```
Gmail API → Ingest → Classify → Seed → Suggest → Insight → Mirror
                         ↑                                    ↓
                    Insight Bus (event-driven coordination)
```

| Agent | Role |
|---|---|
| **Ingest** | Fetch + normalize emails from Gmail |
| **Classify** | Zone triage — Red (2h) / Yellow (today) / Green (weekly) |
| **Seed** | Plant opportunity, decision, relationship seeds |
| **Suggest** | Generate action suggestions + draft responses |
| **Insight** | Cross-email pattern detection |
| **Mirror** | Self-review + quality threshold checks |

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure credentials (see .env.example)
cp .env.example .env
# Fill in Gmail OAuth2 + LLM provider credentials

# 3. Authenticate with Gmail
npm run auth

# 4. Sync and classify inbox
npm run sync
```

## Commands

| Command | Description |
|---|---|
| `npm run sync` | Full sync: fetch → classify → seed → suggest → mirror |
| `npm run triage` | Quick classify unread emails only |
| `npm run auth` | Run Gmail OAuth2 flow |

## Configuration

All agent parameters, zone definitions, and scopes are in `config.json`.

### Environment Variables (`.env`)

See [.env.example](.env.example) for the full template.

| Variable | Required | Description |
|---|---|---|
| `GMAIL_CLIENT_ID` | ✅ | Google OAuth2 Client ID |
| `GMAIL_CLIENT_SECRET` | ✅ | Google OAuth2 Client Secret |
| `LLM_PROVIDER` | ❌ | `gemini` or `openai` (default: `gemini`) |
| `GEMINI_API_KEY` | ❌ | For LLM-powered classification |

## Next Step: LLM-Powered Classification

The classify agent currently uses bilingual keyword matching (English + Traditional Chinese). To unlock semantic understanding for the ~20% of emails with low keyword confidence:

**Integrate the OpenClaw `llm-provider` skill** into `src/agents/classify.js`:

1. Wire `llm-provider` → `createProviderFromEnv()` factory
2. Add `classifyWithLLM()` method using the zone triage prompt
3. Hybrid flow: keyword pre-scan → LLM for uncertain cases → fallback to keyword
4. Make `batchClassify()` async
5. Set `LLM_PROVIDER` and API key in `.env`

**User context:** Taiwanese manufacturing company (京茂機電科技), emails 95% Traditional Chinese, inbox includes government bills, HR approvals, banking notifications, and B2B marketing.

## Version

| Tag | Description |
|---|---|
| `v1.0.0` | Initial 6-agent pipeline |
| `v1.1.0` | Git + semantic versioning |
| `v1.1.1` | Gmail connected — first sync |
| `v1.2.0` | Bilingual keywords, LLM infrastructure |
| `v1.2.1` | OpenClaw handoff preparation |
