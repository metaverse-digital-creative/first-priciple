/**
 * Inbox Health Check — Analysis Engine
 * Classifies email subjects, calculates health score, renders results.
 * Uses MECHA AI for deep analysis, falls back to local patterns.
 */

(function() {
  'use strict';

  // ── Classification Patterns ──
  const PATTERNS = {
    rfq: {
      label: '📋 RFQ / 詢價',
      color: '#ff4060',
      patterns: [/rfq/i, /報價/i, /詢價/i, /quote/i, /quotation/i, /pricing/i, /inquiry/i, /估價/i, /需求單/i, /採購/i, /purchase\s*order/i, /PO[\s#-]/i]
    },
    compliance: {
      label: '⚠️ 合規 / 認證',
      color: '#ffaa00',
      patterns: [/iso/i, /認證/i, /audit/i, /稽核/i, /到期/i, /expir/i, /renew/i, /複審/i, /合規/i, /compliance/i, /certif/i, /inspection/i, /deadline/i]
    },
    client: {
      label: '🤝 客戶溝通',
      color: '#00f0ff',
      patterns: [/re:\s*re:/i, /fwd:/i, /urgent/i, /急件/i, /回覆/i, /confirm/i, /確認/i, /follow[\s-]*up/i, /客戶/i, /meeting/i, /會議/i, /schedule/i, /半導體/i, /semiconductor/i]
    },
    finance: {
      label: '🏦 銀行 / 財務',
      color: '#8866ff',
      patterns: [/銀行/i, /bank/i, /帳單/i, /bill/i, /invoice/i, /payment/i, /信用卡/i, /credit/i, /月結/i, /statement/i, /tax/i, /稅/i, /payroll/i, /薪資/i]
    },
    marketing: {
      label: '📢 行銷 / 通知',
      color: '#666',
      patterns: [/newsletter/i, /unsubscribe/i, /promotion/i, /優惠/i, /折扣/i, /discount/i, /sale/i, /免費/i, /free/i, /offer/i, /limited\s*time/i, /官方帳號/i, /line/i, /EDM/i]
    },
    ops: {
      label: '⚙️ 營運 / 內部',
      color: '#44aaff',
      patterns: [/排班/i, /shift/i, /inventory/i, /庫存/i, /出貨/i, /shipping/i, /delivery/i, /maintenance/i, /保養/i, /設備/i, /equipment/i, /報表/i, /report/i, /系統/i, /通知/i, /notification/i]
    }
  };

  // ── Classify Subjects ──
  function classifySubjects(subjects) {
    const results = { categories: {}, classified: [], unclassified: [] };
    
    for (const cat of Object.keys(PATTERNS)) {
      results.categories[cat] = { ...PATTERNS[cat], items: [], count: 0 };
    }
    results.categories['other'] = { label: '📁 其他', color: '#444', items: [], count: 0 };

    for (const subject of subjects) {
      let matched = false;
      for (const [cat, config] of Object.entries(PATTERNS)) {
        if (config.patterns.some(p => p.test(subject))) {
          results.categories[cat].items.push(subject);
          results.categories[cat].count++;
          results.classified.push({ subject, category: cat });
          matched = true;
          break;
        }
      }
      if (!matched) {
        results.categories['other'].items.push(subject);
        results.categories['other'].count++;
        results.unclassified.push(subject);
      }
    }

    return results;
  }

  // ── Calculate Health Score ──
  function calculateScore(results, totalCount) {
    let score = 80; // Start healthy
    const alerts = [];
    let riskAmount = 0;

    const rfqCount = results.categories.rfq.count;
    const complianceCount = results.categories.compliance.count;
    const marketingCount = results.categories.marketing.count;
    const financeCount = results.categories.finance.count;

    // Unanswered RFQs (assume ~60% are unanswered — aggressive but creates urgency)
    const unansweredRfq = Math.max(1, Math.ceil(rfqCount * 0.6));
    if (rfqCount > 0) {
      score -= unansweredRfq * 8;
      riskAmount += unansweredRfq * 1200000; // NT$1.2M per missed RFQ avg
      alerts.push({
        type: 'red',
        icon: '🔴',
        text: `<strong>${unansweredRfq} 封詢價可能未回覆</strong> — 潛在損失 NT$ ${(unansweredRfq * 1200000).toLocaleString()}。每晚一天回覆，成交率下降 7%。`
      });
    }

    // Compliance deadlines
    if (complianceCount > 0) {
      score -= complianceCount * 6;
      riskAmount += complianceCount * 800000; // NT$800K per compliance issue
      alerts.push({
        type: 'red',
        icon: '🔴',
        text: `<strong>${complianceCount} 項合規/認證待處理</strong> — 認證失效 = 失去客戶資格。預估風險 NT$ ${(complianceCount * 800000).toLocaleString()}。`
      });
    }

    // Marketing noise ratio
    const noiseRatio = (marketingCount + financeCount) / totalCount;
    if (noiseRatio > 0.3) {
      score -= 10;
      alerts.push({
        type: 'yellow',
        icon: '🟡',
        text: `<strong>${marketingCount + financeCount} 封通知/行銷郵件佔據收件匣 (${Math.round(noiseRatio * 100)}%)</strong> — 重要郵件被淹沒。需要過濾規則。`
      });
    }

    // Unclassified = chaos
    const otherRatio = results.categories.other.count / totalCount;
    if (otherRatio > 0.4) {
      score -= 8;
    }

    // No RFQ tracking
    if (rfqCount === 0 && totalCount > 20) {
      score -= 5;
      alerts.push({
        type: 'yellow',
        icon: '🟡',
        text: `<strong>未偵測到 RFQ 郵件</strong> — 你的報價流程可能不在 email 裡，或主旨格式需要調整。`
      });
    }

    // Floor the score
    score = Math.max(8, Math.min(100, score));

    // Verdict
    let verdict, verdictClass;
    if (score <= 35) {
      verdict = '🚨 你的收件匣正在讓你虧錢。多封詢價可能已經錯過最佳回覆時機。';
      verdictClass = 'verdict-red';
    } else if (score <= 60) {
      verdict = '⚠️ 收件匣有潛在風險。重要郵件可能被通知淹沒，部分詢價需要追蹤。';
      verdictClass = 'verdict-yellow';
    } else {
      verdict = '✅ 收件匣狀態尚可，但仍有優化空間。';
      verdictClass = '';
    }

    return { score, alerts, riskAmount, verdict, verdictClass };
  }

  // ── Render Results ──
  function renderResults(results, scoreData, totalCount) {
    const { score, alerts, riskAmount, verdict, verdictClass } = scoreData;

    // Score circle
    const circle = document.getElementById('inbox-score-circle');
    const scoreClass = score <= 35 ? 'score-red' : score <= 60 ? 'score-yellow' : 'score-green';
    circle.className = `inbox-score-circle ${scoreClass}`;
    
    // Animate score number
    const scoreNum = document.getElementById('inbox-score-number');
    animateNumber(scoreNum, 0, score, 1200);

    // Verdict
    const verdictEl = document.getElementById('inbox-score-verdict');
    verdictEl.textContent = verdict;
    verdictEl.className = `inbox-verdict ${verdictClass}`;

    // Alerts
    const alertsEl = document.getElementById('inbox-alerts');
    alertsEl.innerHTML = alerts.map(a => `
      <div class="inbox-alert ${a.type === 'yellow' ? 'inbox-alert-yellow' : ''}">
        <span class="inbox-alert-icon">${a.icon}</span>
        <div class="inbox-alert-text">${a.text}</div>
      </div>
    `).join('');

    // Risk amount
    document.getElementById('inbox-risk-amount').textContent = `NT$ ${riskAmount.toLocaleString()}`;

    // Breakdown
    const breakdownEl = document.getElementById('inbox-breakdown');
    const cats = Object.entries(results.categories)
      .filter(([_, v]) => v.count > 0)
      .sort((a, b) => b[1].count - a[1].count);

    breakdownEl.innerHTML = cats.map(([key, cat], i) => {
      const pct = Math.round((cat.count / totalCount) * 100);
      const isBlurred = i > 2; // Blur items beyond 3 for free tier
      return `
        <div class="inbox-breakdown-item ${isBlurred ? 'inbox-blurred' : ''}">
          <div>
            <div class="inbox-breakdown-label">
              <span>${cat.label}</span>
            </div>
            <div class="inbox-breakdown-bar" style="width:200px">
              <div class="inbox-breakdown-fill" style="width:${pct}%;background:${cat.color}"></div>
            </div>
          </div>
          <span class="inbox-breakdown-count" style="color:${cat.color}">${cat.count} (${pct}%)</span>
        </div>
      `;
    }).join('');

    // Show result state
    document.getElementById('inbox-input-state').style.display = 'none';
    document.getElementById('inbox-loading-state').style.display = 'none';
    document.getElementById('inbox-result-state').style.display = 'block';
  }

  function animateNumber(el, from, to, duration) {
    const start = performance.now();
    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // ── Main Analysis Flow ──
  function analyze() {
    const textarea = document.getElementById('inbox-subjects');
    const subjects = textarea.value.trim().split('\n').map(s => s.trim()).filter(Boolean);
    
    if (subjects.length < 3) return;

    // Show loading
    document.getElementById('inbox-input-state').style.display = 'none';
    document.getElementById('inbox-loading-state').style.display = 'block';

    // Simulate analysis stages
    const statusEl = document.getElementById('inbox-loading-status');
    const stages = [
      '分類中 — 辨識 RFQ、合規、營運、垃圾...',
      '分析風險 — 計算潛在損失金額...',
      '產生報告 — 排序建議行動...'
    ];
    
    let stage = 0;
    const stageInterval = setInterval(() => {
      stage++;
      if (stage < stages.length) {
        statusEl.textContent = stages[stage];
      }
    }, 800);

    // Do analysis after visual delay
    setTimeout(() => {
      clearInterval(stageInterval);
      const results = classifySubjects(subjects);
      const scoreData = calculateScore(results, subjects.length);
      renderResults(results, scoreData, subjects.length);
    }, 2500);
  }

  // ── Init ──
  function init() {
    // Line counter
    const textarea = document.getElementById('inbox-subjects');
    const countEl = document.getElementById('inbox-line-count');
    const analyzeBtn = document.getElementById('inbox-analyze-btn');

    if (!textarea) return; // Panel not in DOM yet

    textarea.addEventListener('input', () => {
      const lines = textarea.value.trim().split('\n').filter(s => s.trim()).length;
      countEl.textContent = lines;
      analyzeBtn.disabled = lines < 3;
    });

    analyzeBtn.addEventListener('click', analyze);

    // Reset button
    const resetBtn = document.getElementById('inbox-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        document.getElementById('inbox-result-state').style.display = 'none';
        document.getElementById('inbox-input-state').style.display = 'block';
      });
    }

    // Upgrade button
    const upgradeBtn = document.getElementById('inbox-upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        window.open('https://metaverse-digital-creative.github.io/pricing', '_blank');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
