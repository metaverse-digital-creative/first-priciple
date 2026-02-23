---
name: email-os-llm-classify
description: Upgrade email-os classify agent from keyword matching to LLM-powered triage using the OpenClaw llm-provider skill.
version: 1.0.0
triggers:
  - email-os classify upgrade
  - llm classify
  - inbox triage
metadata:
  requires:
    bins: [node]
    skills: [llm-provider]
  platform: any
---

# Email-OS LLM Classify — OpenClaw Skill

## Purpose

Upgrade the classify agent in `email-os` from keyword-only matching to LLM-powered zone triage. The current classify agent uses bilingual keywords (English + Chinese) which catch ~80% of signals. The remaining ~20% of emails have low confidence and need LLM semantic understanding.

## Current State (v1.2.0)

- ✅ Gmail API connected and syncing (OAuth2)
- ✅ Bilingual keyword classification working (English + Traditional Chinese)
- ✅ 6-agent pipeline on Insight Bus (Ingest → Classify → Seed → Suggest → Insight → Mirror)
- ❌ LLM classification not active (needs `llm-provider` skill integration)

## What Needs to Be Done

### 1. Install `llm-provider` Skill

The `llm-provider` skill provides a unified `LLMProvider` interface with `chat()` and `stream()` methods, supporting Gemini, OpenAI, and Claude.

```bash
# Copy or symlink the llm-provider skill into the project
cp -r /path/to/openclaw/skills/llm-provider/scripts/ src/llm/
```

### 2. Create `src/llm/index.js`

Adapt the TypeScript `llm-provider` skill for this ESM JavaScript project:

```javascript
// Use createProviderFromEnv() factory from llm-provider
// ENV: LLM_PROVIDER=gemini, GEMINI_API_KEY=xxx
import { createProviderFromEnv } from './factory.js';
export default createProviderFromEnv;
```

### 3. Wire Into Classify Agent

The classify agent (`src/agents/classify.js`) needs these changes:

```javascript
// In ClassifyAgent constructor:
import createProvider from '../llm/index.js';
this.llm = createProvider();

// Add classifyWithLLM() method:
async classifyWithLLM(email) {
    const result = await this.llm.chat([
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: `From: ${email.from}\nSubject: ${email.subject}\nPreview: ${email.snippet}` }
    ], { temperature: 0.1, maxTokens: 200, json: true });
    return JSON.parse(result.content);
}

// Hybrid flow in classify():
// 1. Keyword pre-scan → if confidence >= 0.8, use keyword result
// 2. Else → call classifyWithLLM() for semantic classification
// 3. Fallback to keyword if LLM fails
```

### 4. Make Pipeline Async

`batchClassify()` becomes async because LLM calls are async:

```javascript
// In src/index.js, change:
const classified = classify.batchClassify(emails);
// To:
const classified = await classify.batchClassify(emails);
```

## LLM Prompt

```
You are an email triage assistant for a Taiwanese business executive (京茂機電科技).
Classify this email into exactly one zone:

🔴 RED — Requires action within 2 hours (decisions, deadlines, security, government/legal)
🟡 YELLOW — Handle today (meetings, approvals, follow-ups, business updates)
🟢 GREEN — Batch weekly (newsletters, promotions, event invites, holiday greetings)

Respond ONLY with JSON:
{"zone":"red|yellow|green","confidence":0.85,"reasoning":"one line","signals":["signal1","signal2"]}
```

## Environment Variables

```bash
# Required in .env
LLM_PROVIDER=gemini          # or: openai, claude
GEMINI_API_KEY=xxx            # from https://aistudio.google.com/apikey
# OPENAI_API_KEY=xxx          # alternative provider
# LLM_MODEL=gemini-2.0-flash  # optional model override
```

## Key Architecture Decisions

1. **Hybrid classify** — keyword pre-scan + LLM only for uncertain cases (saves cost/time)
2. **Sequential processing** — one email at a time to respect Gemini free tier (15 RPM)
3. **Graceful fallback** — if LLM fails, keyword result is used (never crash)
4. **Bilingual keywords** — already handle English + Traditional Chinese signals
5. **Provider-agnostic** — swap LLM provider with one env var change

## Project Structure

```
email-os/
├── src/
│   ├── index.js          # Main pipeline orchestrator
│   ├── bus.js            # Insight Bus (event-driven agent coordination)
│   ├── state.js          # State machine (IDLE → SYNCING → PROCESSING → COMPLETE)
│   ├── agents/
│   │   ├── classify.js   # ← UPGRADE TARGET: add LLM hybrid classification
│   │   ├── ingest.js     # Gmail API fetch + normalize
│   │   ├── seed.js       # Opportunity/relationship seed planting
│   │   ├── suggest.js    # Action suggestions + draft responses
│   │   ├── insight.js    # Cross-email pattern detection
│   │   └── mirror.js     # Self-review + quality checks
│   ├── gmail/
│   │   ├── auth.js       # OAuth2 flow (local server on :3000)
│   │   └── client.js     # Gmail API wrapper
│   └── llm/              # ← CREATE: OpenClaw llm-provider integration
│       └── index.js
├── config.json           # Agent params, zone definitions, scopes
├── .env.example          # Template for credentials
├── .env                  # Actual credentials (gitignored)
└── .tokens/              # OAuth refresh token (gitignored)
```

## Verification

After integration, run:

```bash
npm run sync
```

Expected output should show:
```
📊 Classify: X keyword / Y LLM / 0 fallback
```

Where Y > 0 means LLM is actively classifying uncertain emails.

## Related Knowledge

- OpenClaw `llm-provider` skill: unified interface, retry with backoff, error normalization
- Email zones: Red (2h), Yellow (today), Green (weekly batch)
- User context: Taiwanese manufacturing company (京茂機電科技), emails in Traditional Chinese
