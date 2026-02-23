/**
 * MECHA Chat Widget
 * Drop-in chat widget that connects to MECHA agent.
 * 
 * Usage: Add <script src="mecha-chat.js"></script> to your HTML.
 * Config: window.MECHA_CONFIG = { endpoint: 'https://your-tunnel.trycloudflare.com' }
 */

(function() {
  'use strict';

  const DEFAULT_CONFIG = {
    endpoint: 'http://localhost:18800',
    agentId: 'mecha',
    apiKey: null,  // Set for higher limits. null = demo (10 msg/day)
    title: 'MECHA AI',
    subtitle: 'First Principles • Deploy • Earn',
    placeholder: 'Ask anything...',
    position: 'bottom-right',
    theme: {
      primary: '#00f0ff',
      bg: '#0a0a0f',
      surface: '#12121a',
      text: '#e0e0e0',
      border: 'rgba(0,240,255,0.15)'
    }
  };

  const config = Object.assign({}, DEFAULT_CONFIG, window.MECHA_CONFIG || {});

  // ── State ──
  let isOpen = false;
  let messages = [];
  let sessionId = localStorage.getItem('mecha-session') || crypto.randomUUID();
  localStorage.setItem('mecha-session', sessionId);

  // ── Styles ──
  const styles = `
    #mecha-chat-fab {
      position: fixed;
      ${config.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${config.theme.primary};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,240,255,0.3);
      z-index: 99999;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #mecha-chat-fab:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 30px rgba(0,240,255,0.5);
    }
    #mecha-chat-fab svg {
      width: 28px;
      height: 28px;
      fill: ${config.theme.bg};
    }
    #mecha-chat-window {
      position: fixed;
      ${config.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 88px;
      width: 380px;
      height: 520px;
      background: ${config.theme.bg};
      border: 1px solid ${config.theme.border};
      border-radius: 16px;
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 99999;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #mecha-chat-window.open { display: flex; }
    #mecha-chat-header {
      padding: 16px;
      background: ${config.theme.surface};
      border-bottom: 1px solid ${config.theme.border};
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #mecha-chat-header .dot {
      width: 10px;
      height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    #mecha-chat-header .info h3 {
      margin: 0;
      font-size: 14px;
      color: ${config.theme.primary};
      font-weight: 600;
    }
    #mecha-chat-header .info p {
      margin: 0;
      font-size: 11px;
      color: ${config.theme.text};
      opacity: 0.6;
    }
    #mecha-chat-header .close-btn {
      margin-left: auto;
      background: none;
      border: none;
      color: ${config.theme.text};
      cursor: pointer;
      font-size: 18px;
      opacity: 0.5;
      padding: 4px 8px;
    }
    #mecha-chat-header .close-btn:hover { opacity: 1; }
    #mecha-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #mecha-chat-messages::-webkit-scrollbar { width: 4px; }
    #mecha-chat-messages::-webkit-scrollbar-thumb {
      background: ${config.theme.border};
      border-radius: 2px;
    }
    .mecha-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      color: ${config.theme.text};
      word-wrap: break-word;
    }
    .mecha-msg.user {
      align-self: flex-end;
      background: rgba(0,240,255,0.12);
      border: 1px solid ${config.theme.border};
    }
    .mecha-msg.agent {
      align-self: flex-start;
      background: ${config.theme.surface};
      border: 1px solid ${config.theme.border};
    }
    .mecha-msg.agent .typing {
      display: inline-flex;
      gap: 4px;
    }
    .mecha-msg.agent .typing span {
      width: 6px;
      height: 6px;
      background: ${config.theme.primary};
      border-radius: 50%;
      animation: typing 1.2s infinite;
    }
    .mecha-msg.agent .typing span:nth-child(2) { animation-delay: 0.2s; }
    .mecha-msg.agent .typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing {
      0%, 100% { opacity: 0.3; transform: scale(0.8); }
      50% { opacity: 1; transform: scale(1); }
    }
    #mecha-chat-input-area {
      padding: 12px 16px;
      border-top: 1px solid ${config.theme.border};
      display: flex;
      gap: 8px;
      background: ${config.theme.surface};
    }
    #mecha-chat-input {
      flex: 1;
      background: ${config.theme.bg};
      border: 1px solid ${config.theme.border};
      border-radius: 8px;
      padding: 10px 12px;
      color: ${config.theme.text};
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    #mecha-chat-input:focus {
      border-color: ${config.theme.primary};
    }
    #mecha-chat-input::placeholder {
      color: ${config.theme.text};
      opacity: 0.3;
    }
    #mecha-chat-send {
      background: ${config.theme.primary};
      border: none;
      border-radius: 8px;
      padding: 0 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: opacity 0.2s;
    }
    #mecha-chat-send:hover { opacity: 0.8; }
    #mecha-chat-send:disabled { opacity: 0.3; cursor: not-allowed; }
    #mecha-chat-send svg {
      width: 18px;
      height: 18px;
      fill: ${config.theme.bg};
    }
    @media (max-width: 420px) {
      #mecha-chat-window {
        width: calc(100vw - 20px);
        height: calc(100vh - 120px);
        right: 10px;
        left: 10px;
        bottom: 78px;
      }
    }
  `;

  // ── HTML ──
  function render() {
    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    // FAB button
    const fab = document.createElement('button');
    fab.id = 'mecha-chat-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
    fab.onclick = toggleChat;
    document.body.appendChild(fab);

    // Chat window
    const win = document.createElement('div');
    win.id = 'mecha-chat-window';
    win.innerHTML = `
      <div id="mecha-chat-header">
        <div class="dot"></div>
        <div class="info">
          <h3>${config.title}</h3>
          <p>${config.subtitle}</p>
        </div>
        <button class="close-btn" onclick="document.getElementById('mecha-chat-window').classList.remove('open')">&times;</button>
      </div>
      <div id="mecha-chat-messages"></div>
      <div id="mecha-chat-input-area">
        <input id="mecha-chat-input" type="text" placeholder="${config.placeholder}" autocomplete="off" />
        <button id="mecha-chat-send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(win);

    // Events
    const input = document.getElementById('mecha-chat-input');
    const send = document.getElementById('mecha-chat-send');
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    send.addEventListener('click', sendMessage);

    // Welcome message
    addMessage('agent', `👋 我是 MECHA AI — 你的部署指揮官。\n\n我能幫你：\n• 部署機器人到工廠產線\n• 分析收益和 ROI\n• 用 First Principles 找最快賺錢的路\n\n有什麼想法？`);
  }

  function toggleChat() {
    const win = document.getElementById('mecha-chat-window');
    isOpen = !isOpen;
    win.classList.toggle('open', isOpen);
    if (isOpen) {
      document.getElementById('mecha-chat-input').focus();
    }
  }

  function addMessage(role, text) {
    const container = document.getElementById('mecha-chat-messages');
    const msg = document.createElement('div');
    msg.className = `mecha-msg ${role}`;
    // Simple markdown: **bold**
    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    msg.innerHTML = html;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    messages.push({ role, text });
    return msg;
  }

  function addTyping() {
    const container = document.getElementById('mecha-chat-messages');
    const msg = document.createElement('div');
    msg.className = 'mecha-msg agent';
    msg.id = 'mecha-typing';
    msg.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return msg;
  }

  function removeTyping() {
    const el = document.getElementById('mecha-typing');
    if (el) el.remove();
  }

  async function sendMessage() {
    const input = document.getElementById('mecha-chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    addMessage('user', text);
    addTyping();

    const sendBtn = document.getElementById('mecha-chat-send');
    sendBtn.disabled = true;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['X-API-Key'] = config.apiKey;

      const response = await fetch(`${config.endpoint}/api/v1/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agentId: config.agentId,
          sessionId: sessionId,
          message: text
        })
      });

      removeTyping();

      const data = await response.json();

      if (response.status === 429) {
        addMessage('agent', `⚡ Daily limit reached (${data.limit} messages).\n\n${data.tier === 'demo' ? '**Get a free API key for 5x more messages →** [Upgrade](https://metaverse-digital-creative.github.io/pricing)' : '**Upgrade to Pro for unlimited →** [Upgrade](https://metaverse-digital-creative.github.io/pricing)'}`);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      addMessage('agent', data.reply || data.message || 'No response');
      
      // Show usage hint when running low
      if (data.usage && data.usage.remaining <= 3 && data.usage.remaining > 0) {
        addMessage('agent', `_${data.usage.remaining} messages remaining today. [Get more →](https://metaverse-digital-creative.github.io/pricing)_`);
      }
    } catch (err) {
      removeTyping();
      addMessage('agent', `⚠️ 連線失敗 — 請確認 MECHA endpoint 設定。\n\nError: ${err.message}`);
    } finally {
      sendBtn.disabled = false;
    }
  }

  // ── Init ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
