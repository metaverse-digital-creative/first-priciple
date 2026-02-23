# PRODUCT.md — MECHA AI Product Strategy

## One-Liner

**「你的收件匣裡藏著多少你不知道的報價單？」**

AI-powered inbox intelligence for manufacturers.

## Target Customer

Taiwan SME manufacturers (50,000+). 10-50 employees. Owner's inbox = ERP + CRM + compliance system. Drowning in email. Losing RFQs they don't know about.

## Pricing Model

### Early Adopter — Locked Forever

| Tier | Price | Condition |
|------|-------|-----------|
| Free | $0 | 10 msg/day, inbox health score (blurred details) |
| Pro (first 50 users) | $9/mo | Locked forever |
| Pro (51-100 users) | $19/mo | Locked forever |
| Pro (100+ users) | $29/mo | Full price |

### Price Ceiling

**$299/mo** — Full audit + quarterly business review.

ROI math: If MECHA saves 1 RFQ/month = ~NT$1.2M revenue. At $299/mo, that's still 400x ROI.

### Feature Ladder

```
Phase 1:   Free inbox health score                    ← SHIPPED
Phase 2:   RFQ blurred notifications                  ← BUILDING (signal: 京茂 ran 4 rounds of RFQ analysis)
Phase 10:  Full audit + quarterly business review     ← $299/mo ceiling

Phase 3-9: We don't know yet. Users tell us.
```

**We do NOT pre-plan features.** Every feature ships only when a real user's real behavior signals they need it. This is conversation-driven development.

### Phase 2: RFQ Blurred Notifications

**Signal:** 京茂機電 ran 4 consecutive RFQ analysis rounds, asked for SOP, asked for automation. RFQ = their biggest pain point.

**What it does:**
- Email-OS scans inbox → detects RFQ patterns
- Free users see: blurred sender, blurred subject, estimated value hidden → "🔓 Unlock with Pro"
- Pro users see: full sender, subject, estimated value, response deadline, similar past RFQs, draft reply button

**Why it works for both sides:**
| Their win | Our win |
|-----------|---------|
| Never miss an RFQ again | Every RFQ = a payment trigger |
| Know which RFQ is most valuable | Blurred notification = max loss aversion |
| Faster response time | Dependency deepens daily |
| See missed revenue | "You missed NT$3.6M this month" = renewal reason |

**Key design:** Free version tells you "there IS an RFQ" but not "from WHO." You know the money is there but can't see it. $9/mo unlocks everything.

**Technical:** inbox-health.js already has RFQ classification patterns. Add blurred notification rendering layer.

## Development Methodology

### Conversation-Driven Development

```
User does something → We observe → They ask for something → We build it → Ship → Repeat
```

**Rules:**
1. Never build a feature nobody asked for
2. Never guess what users want
3. Every feature must trace back to a real conversation
4. Ship in hours, not weeks
5. Price grows with demonstrated value, not speculation

### Signal → Ship Cycle

```
Signal:    User behavior or explicit request
  ↓
Validate:  Is this one user or a pattern?
  ↓
Build:     Smallest thing that solves it
  ↓
Ship:      Same day if possible
  ↓
Observe:   Did it change their behavior?
  ↓
Price:     If it creates real value → charge for it
```

## What We Know (Real Data)

### Case Study: 京茂機電

- **Company:** 20-person precision machining shop, southern Taiwan
- **What happened:** Analyzed 600 emails via MECHA AI chat
- **Found:**
  - $500K–$2M in potentially lost RFQs
  - 3 expiring certifications
  - Complete RFQ automation pipeline built
  - Gmail filter rules generated
- **Analysis time:** < 5 minutes
- **Value delivered:** $5,000–$15,000 consulting engagement equivalent

### What We Don't Know

- Will 京茂 come back?
- Will they pay?
- What will they ask for next?
- Will other manufacturers find us?

**We wait for signal. We don't guess.**

## Funnel

```
MECHA-DASH (clone repo, open index.html)
  ↓
📧 Inbox Health Check (free, paste email subjects)
  ↓
Score: 32/100 + "NT$7.2M at risk" (anxiety = conversion)
  ↓
Blurred details → "Unlock full analysis — $9/mo"
  ↓
Pricing page → Telegram bot → Human closes
  ↓
Pro user → Use → Signal → Build next feature
```

## Tech Stack

- **Frontend:** Zero-dependency HTML/CSS/JS (index.html, inbox-health.js)
- **Backend:** MECHA API Bridge v2 (Node.js, port 18800)
- **AI:** MECHA agent on OpenClaw (Claude)
- **Tunnel:** Cloudflare (currently ephemeral trycloudflare.com)
- **Repo:** github.com/metaverse-digital-creative/first-priciple
- **Pricing:** github.com/metaverse-digital-creative/first-priciple/pricing.html

## Principles (from MECHA-DASH First Principles)

1. **Fastest money first** — Don't build features. Monetize the value you already delivered.
2. **Biggest bottleneck** — Getting user data into the system. Manual paste → auto-import → API.
3. **Vertically integrate** — Own the analysis layer. Nobody else can read their inbox like this.
4. **Create dependency** — Once they see what they're missing, they can't unsee it.
5. **Turn into platform** — One manufacturer → their suppliers → their clients → network effect.
