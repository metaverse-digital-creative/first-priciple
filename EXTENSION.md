# EXTENSION.md — MECHA Inbox Guard (Chrome Extension)

## Overview

A free Chrome Extension that sits inside Gmail, auto-detects RFQs and critical emails, and shows blurred notifications. The distribution layer for MECHA AI.

**Name:** MECHA Inbox Guard
**Tagline:** 你的收件匣裡藏著多少你不知道的報價單？
**Price:** Free (blurred) → Pro $9/mo (full details)

## Why Extension First

| Problem | Dashboard | Extension |
|---------|-----------|-----------|
| User has to remember to visit | ✅ Yes | ❌ Always there |
| Needs manual paste | ✅ Yes | ❌ Auto-reads Gmail |
| Data leaves their machine | ✅ Yes (paste to server) | ❌ Client-side only |
| Distribution | Share a URL | Chrome Web Store |
| Daily touchpoint | Zero (they forget) | Every time they open Gmail |

**Extension solves the #1 bottleneck:** Getting user data into the system — without OAuth, without backend, without trust issues.

## Architecture

```
┌─────────────────────────────────────────┐
│  Gmail (browser)                         │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  Extension (content script)         │ │
│  │                                     │ │
│  │  1. Read email subjects from DOM    │ │
│  │  2. Classify (RFQ/compliance/noise) │ │
│  │  3. Update badge: 🔴 3             │ │
│  │  4. Store results in local storage  │ │
│  │                                     │ │
│  │  ⚠️ NO data leaves the browser     │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
          │
          │ (user clicks badge)
          ▼
┌─────────────────────────────────────────┐
│  Extension Popup                         │
│                                          │
│  Free tier:                              │
│  🔴 RFQ detected: ███@████.com           │
│     Subject: RFQ_███ for ██████          │
│     Est. value: NT$ ████████             │
│     [🔓 Unlock — Pro $9/mo]             │
│                                          │
│  Pro tier:                               │
│  🔴 RFQ detected: Alper Kalkan           │
│     deltakalip.com (Turkey)              │
│     Subject: Delta Inquiry — 模具報價     │
│     Est. value: NT$ 600,000              │
│     Days waiting: 12 ⚠️                  │
│     [📝 Generate reply draft]            │
│                                          │
│  ─────────────────────────────           │
│  📊 Full analysis → Dashboard            │
└─────────────────────────────────────────┘
```

## What Runs Where

| Component | Runs on | Sees email data? |
|-----------|---------|-----------------|
| Content script (classifier) | Client browser | ✅ Yes (reads Gmail DOM) |
| Popup UI (results display) | Client browser | ✅ Yes (from local storage) |
| Badge counter | Client browser | ❌ Just a number |
| Pro unlock check | Our server | ❌ Only API key validation |
| Dashboard (deep analysis) | Our server | Only if user pastes manually |

**Privacy guarantee:** Email content NEVER leaves the browser. Classification is 100% client-side. Our server only knows "is this API key Pro or not?"

## Classification Engine

Reuse patterns from `inbox-health.js`:

```javascript
const PATTERNS = {
  rfq: {
    priority: 'critical',
    color: '#ff4060',
    patterns: [/rfq/i, /報價/i, /詢價/i, /quote/i, /quotation/i, 
               /pricing/i, /inquiry/i, /估價/i, /需求單/i, /採購/i, 
               /purchase\s*order/i, /PO[\s#-]/i, /enquiry/i]
  },
  compliance: {
    priority: 'critical',
    color: '#ffaa00',
    patterns: [/iso/i, /認證/i, /audit/i, /到期/i, /expir/i, 
               /renew/i, /複審/i, /compliance/i, /certif/i, /deadline/i]
  },
  approval: {
    priority: 'action',
    color: '#ff8800',
    patterns: [/簽核/i, /待放行/i, /稽催/i, /approve/i, /approval/i,
               /pending/i, /overdue/i]
  },
  client: {
    priority: 'important',
    color: '#00f0ff',
    patterns: [/urgent/i, /急件/i, /跟催/i, /follow[\s-]*up/i, 
               /re:\s*re:/i, /fwd:/i]
  }
};
```

## File Structure

```
mecha-inbox-guard/
├── manifest.json          # Chrome Extension manifest v3
├── background.js          # Service worker (badge updates)
├── content.js             # Gmail DOM reader + classifier
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic + blur/unlock
├── classifier.js          # Shared classification engine (from inbox-health.js)
├── styles.css             # Popup styles (dark theme, matches MECHA-DASH)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## manifest.json Spec

```json
{
  "manifest_version": 3,
  "name": "MECHA Inbox Guard",
  "version": "1.0.0",
  "description": "Auto-detect RFQs and critical emails in Gmail. Never miss a quote again. 再也不漏接報價單。",
  "permissions": ["activeTab", "storage"],
  "host_permissions": ["https://mail.google.com/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [{
    "matches": ["https://mail.google.com/*"],
    "js": ["classifier.js", "content.js"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js"
  }
}
```

## Free vs Pro

| Feature | Free | Pro ($9/mo) |
|---------|------|-------------|
| RFQ detection | ✅ Count only | ✅ Full details |
| Sender name | 🔒 Blurred | ✅ Visible |
| Subject line | 🔒 Blurred | ✅ Visible |
| Est. value | 🔒 Hidden | ✅ Shown |
| Days waiting | ❌ | ✅ |
| Compliance alerts | ✅ Count only | ✅ Full details |
| Badge counter | ✅ | ✅ |
| Reply draft | ❌ | ✅ |
| Weekly summary | ❌ | ✅ |
| Dashboard deep analysis | Limited | Full |

## User Journey

```
Day 0:  Install from Chrome Web Store (free, 1 click)
Day 0:  Open Gmail → badge shows 🔴 5 → "wow, 5 RFQs I didn't know about"
Day 0:  Click → blurred list → anxiety → "maybe later"
Day 3:  Open Gmail → badge 🔴 7 → "it's growing..."
Day 3:  Click → "NT$ ████████ at risk" → clicks "Full analysis" → Dashboard
Day 3:  Dashboard score: 32/100 → more anxiety
Day 7:  Badge 🔴 9 → user thinks "I'm definitely losing money"
Day 7:  $9/mo unlock → sees full RFQ list → "holy shit, ASML was in there"
Day 7:  → pays → never uninstalls
```

## Chrome Web Store Listing

**Title:** MECHA Inbox Guard — RFQ & Email Intelligence for Manufacturers

**Short description:** Auto-detect missed RFQs, expiring certifications, and critical emails in Gmail. Built for manufacturers and SME owners.

**Keywords:** Gmail, RFQ, 報價, inbox, email audit, manufacturer, 製造業, 收件匣, 詢價

**Category:** Productivity

**Target audience:** Taiwan SME manufacturers (50,000+ companies), factory owners, procurement managers

## Metrics

| Metric | Target (Month 1) | Target (Month 3) |
|--------|------------------|------------------|
| Installs | 100 | 500 |
| DAU (daily badge views) | 30 | 150 |
| Free → Pro conversion | 5% | 8% |
| Pro subscribers | 5 | 40 |
| MRR | $45 | $360 |

## Development Estimate

| Task | Time |
|------|------|
| manifest.json + file structure | 30 min |
| classifier.js (port from inbox-health.js) | 1 hr |
| content.js (Gmail DOM reader) | 2 hr |
| background.js (badge updates) | 30 min |
| popup.html/js (blur + unlock UI) | 2 hr |
| Icons + Chrome Web Store assets | 1 hr |
| Testing in Gmail | 1 hr |
| **Total** | **~8 hours** |

## Privacy Policy (required for Chrome Web Store)

```
MECHA Inbox Guard Privacy Policy

What we access:
- Email subject lines in your Gmail inbox (read-only, via DOM)

What we store:
- Classification results in your browser's local storage only

What we send to our servers:
- NOTHING. Zero email data leaves your browser.
- Only Pro license validation (API key check, no email content)

What we never do:
- Read email bodies
- Store email data on any server
- Share any data with third parties
- Track your email activity
```
