# MECHA Inbox Guard — Chrome Extension

Auto-detect missed RFQs, expiring certifications, and critical emails in Gmail.  
Built for Taiwan SME manufacturers. 再也不漏接報價單。

## Install (Developer Mode)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this `mecha-inbox-guard/` folder
4. Open Gmail → extension auto-scans your inbox

## How It Works

```
Gmail inbox → Content script reads DOM → Classifier detects RFQs/compliance
→ Badge shows 🔴 count → Popup shows blurred results → Pro unlocks details
```

**Privacy:** All classification runs client-side. Zero email data leaves your browser.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome MV3 config |
| `classifier.js` | Bilingual pattern engine (EN + 繁中) |
| `content.js` | Gmail DOM reader + scan trigger |
| `background.js` | Badge counter service worker |
| `popup.html/js` | Popup UI with blur/unlock |
| `styles.css` | Dark theme (MECHA aesthetic) |

## Patterns Detected

- **RFQ/報價** — rfq, quotation, 詢價, 報價, 採購, 下單, PO
- **Compliance/認證** — ISO, 認證, audit, 到期, expiring, AS9100
- **Approval/簽核** — 簽核, 待放行, 稽催, pending, overdue
- **Client/跟催** — urgent, 急件, 跟催, follow-up, 催貨

## Free vs Pro

| Feature | Free | Pro ($9/mo) |
|---------|------|-------------|
| RFQ count | ✅ | ✅ |
| Sender name | 🔒 Blurred | ✅ Full |
| Subject line | 🔒 Blurred | ✅ Full |
| Est. value | 🔒 Hidden | ✅ Shown |
| Reply draft | ❌ | ✅ |
