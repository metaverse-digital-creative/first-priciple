/* ====================================
   MECHA-DASH — Core Application Logic
   Bus + State + Engines + Data
   ==================================== */

// ===========================
// Event Bus (from email-os)
// ===========================
const Bus = {
  _listeners: {},
  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
  },
  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  },
  emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }
};

// ===========================
// State Machine (from email-os)
// ===========================
const StateMachine = {
  state: 'IDLE',
  transitions: {
    IDLE: ['DEPLOYING'],
    DEPLOYING: ['ACTIVE', 'IDLE'],
    ACTIVE: ['EARNING', 'IDLE'],
    EARNING: ['ENGAGING', 'IDLE'],
    ENGAGING: ['COMPOUNDING', 'IDLE'],
    COMPOUNDING: ['IDLE']
  },
  go(next) {
    if (this.transitions[this.state]?.includes(next)) {
      const prev = this.state;
      this.state = next;
      Bus.emit('state:change', { from: prev, to: next });
      return true;
    }
    return false;
  }
};

// ===========================
// Data Layer (localStorage)
// ===========================
const Store = {
  _key: 'mecha_dash_v1',

  _defaults: {
    deployments: [],
    seeds: [],
    lessons: [],
    version: '1.0.0'
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key);
      return raw ? JSON.parse(raw) : { ...this._defaults };
    } catch {
      return { ...this._defaults };
    }
  },

  save(data) {
    localStorage.setItem(this._key, JSON.stringify(data));
    Bus.emit('data:saved', data);
  },

  get() {
    return this.load();
  },

  addDeployment(deployment) {
    const data = this.load();
    deployment.id = 'd' + String(data.deployments.length + 1).padStart(3, '0');
    deployment.createdAt = new Date().toISOString();
    deployment.daysActive = 0;
    deployment.desireState = {
      open_loops: 0,
      max_loops: 3,
      anticipation_level: 0,
      days_since_touch: 0,
      active_seeds: [],
      stage: 'CUE',
      content_rotation: 'insight'
    };
    deployment.seed = {
      type: 'hypothesis',
      quality: 0.35,
      status: 'planted',
      plantedAt: new Date().toISOString()
    };
    data.deployments.push(deployment);
    this.save(data);
    Bus.emit('deployment:added', deployment);
    return deployment;
  },

  getDeployments() {
    return this.load().deployments;
  },

  updateDeployment(id, updates) {
    const data = this.load();
    const idx = data.deployments.findIndex(d => d.id === id);
    if (idx !== -1) {
      Object.assign(data.deployments[idx], updates);
      this.save(data);
      Bus.emit('deployment:updated', data.deployments[idx]);
    }
  },

  addLesson(lesson) {
    const data = this.load();
    lesson.id = 'l' + String(data.lessons.length + 1).padStart(3, '0');
    lesson.createdAt = new Date().toISOString();
    data.lessons.push(lesson);
    this.save(data);
    Bus.emit('lesson:added', lesson);
  },

  getLessons() {
    return this.load().lessons;
  },

  async loadSeedData() {
    const data = this.load();
    if (data.deployments.length > 0) return false; // Already has data

    try {
      const res = await fetch('data/deployments.json');
      if (!res.ok) return false;
      const seedData = await res.json();
      if (seedData.deployments && seedData.deployments.length > 0) {
        data.deployments = seedData.deployments;
        this.save(data);
        Bus.emit('data:seeded', { count: seedData.deployments.length });
        return true;
      }
    } catch {
      // Seed data not available — that's fine
    }
    return false;
  }
};

// ===========================
// Earnings Calculator (from mecha-os)
// ===========================
const Earnings = {
  DAILY_RATE: 200,
  MECHA_CUT: 0.30,

  calculate(robots, days) {
    const gross = robots * this.DAILY_RATE * days;
    return {
      gross,
      mechaOsCut: Math.round(gross * this.MECHA_CUT),
      bossTake: Math.round(gross * (1 - this.MECHA_CUT))
    };
  },

  totalFromDeployments(deployments) {
    return deployments.reduce((acc, d) => {
      const days = d.daysActive || this.daysSince(d.createdAt);
      const e = this.calculate(d.robots?.count || 0, days);
      return {
        gross: acc.gross + e.gross,
        mechaOsCut: acc.mechaOsCut + e.mechaOsCut,
        bossTake: acc.bossTake + e.bossTake,
        totalRobots: acc.totalRobots + (d.robots?.count || 0),
        totalDays: acc.totalDays + days
      };
    }, { gross: 0, mechaOsCut: 0, bossTake: 0, totalRobots: 0, totalDays: 0 });
  },

  daysSince(isoDate) {
    if (!isoDate) return 0;
    const diff = Date.now() - new Date(isoDate).getTime();
    return Math.max(1, Math.floor(diff / 86400000));
  }
};

// ===========================
// Desire Engine (from franchise-os)
// ===========================
const DesireEngine = {
  STAGES: ['CUE', 'ANTICIPATION', 'PARTIAL_REWARD', 'SEEKING', 'VARIABLE_REWARD', 'INCOMPLETE_CLOSURE'],

  STAGE_INFO: {
    CUE: { label: 'Cue', icon: '🎯', desc: 'Plant a signal before the boss is aware of it' },
    ANTICIPATION: { label: 'Anticipation', icon: '⏳', desc: 'Control the gap between signal and reveal' },
    PARTIAL_REWARD: { label: 'Partial Reward', icon: '🎁', desc: 'Solve a visible problem, reveal system depth' },
    SEEKING: { label: 'Seeking', icon: '🔍', desc: 'End every conversation with an open loop' },
    VARIABLE_REWARD: { label: 'Variable Reward', icon: '🎲', desc: 'Engineer encounters that feel like luck' },
    INCOMPLETE_CLOSURE: { label: 'Incomplete Closure', icon: '♾️', desc: 'Best insight unlocks only after trust is built' }
  },

  CONTENT_TYPES: ['insight', 'celebration', 'question', 'surprise'],

  getNextAction(desireState) {
    const ds = desireState;
    const actions = [];

    if (ds.open_loops >= ds.max_loops) {
      actions.push({ action: 'PAUSE', reason: 'Max open loops reached — don\'t overwhelm', priority: 'low' });
    }
    if (ds.days_since_touch >= 7) {
      actions.push({ action: 'FORCE_TOUCH', reason: 'Loop is dying — force contact today', priority: 'critical' });
    }
    if (ds.days_since_touch <= 1) {
      actions.push({ action: 'SKIP', reason: 'Spacing creates anticipation — wait', priority: 'low' });
    }
    if (ds.open_loops === 0) {
      actions.push({ action: 'PLANT_CUE', reason: 'No open loops — plant a new seed', priority: 'high' });
    }
    if (ds.anticipation_level > 7) {
      actions.push({ action: 'DELIVER_REWARD', reason: 'Anticipation peaked — deliver partial reward', priority: 'high' });
    }

    if (actions.length === 0) {
      actions.push({ action: 'MAINTAIN', reason: 'Desire state is healthy — nurture current loops', priority: 'medium' });
    }

    return actions.sort((a, b) => {
      const p = { critical: 0, high: 1, medium: 2, low: 3 };
      return p[a.priority] - p[b.priority];
    });
  },

  advanceStage(desireState) {
    const idx = this.STAGES.indexOf(desireState.stage);
    const next = this.STAGES[(idx + 1) % this.STAGES.length];
    desireState.stage = next;
    return next;
  },

  rotateContent(desireState) {
    const idx = this.CONTENT_TYPES.indexOf(desireState.content_rotation);
    desireState.content_rotation = this.CONTENT_TYPES[(idx + 1) % this.CONTENT_TYPES.length];
    return desireState.content_rotation;
  }
};

// ===========================
// Seed Engine (from research-lab)
// ===========================
const SeedEngine = {
  TYPES: ['hypothesis', 'experiment', 'probe', 'idea'],
  QUALITY_INCREMENT: 0.056, // approaches 0.98 over ~11 harvests from 0.35

  plant(deploymentId, type = 'hypothesis') {
    return {
      deploymentId,
      type,
      quality: 0.35,
      status: 'planted',
      plantedAt: new Date().toISOString(),
      harvestedAt: null,
      insights: []
    };
  },

  harvest(seed) {
    seed.status = 'harvested';
    seed.harvestedAt = new Date().toISOString();
    seed.quality = Math.min(0.98, seed.quality + this.QUALITY_INCREMENT + Math.random() * 0.06);
    return seed;
  },

  avgQuality(deployments) {
    const seeds = deployments.map(d => d.seed).filter(s => s);
    if (seeds.length === 0) return 0;
    return seeds.reduce((sum, s) => sum + s.quality, 0) / seeds.length;
  },

  qualityCurve(deployments) {
    return deployments
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((d, i) => ({
        index: i + 1,
        quality: d.seed?.quality || 0.35,
        factory: d.factory?.name || `Deploy #${i + 1}`
      }));
  }
};

// ===========================
// Deployment Principles (Tier 1 + Tier 2)
// ===========================
const Principles = {
  tier1: [
    { num: 'T1.1', text: 'Safety > Efficiency > Cost — always in this order' },
    { num: 'T1.2', text: 'Day 1: only observe, never intervene' },
    { num: 'T1.3', text: 'Workers must understand before they accept' },
    { num: 'T1.4', text: 'Start with the simplest work station, never the most complex' },
    { num: 'T1.5', text: 'Data collection starts Day 0, even if robots aren\'t online' }
  ],

  tier2: {
    automotive: [
      'What is the union\'s emotional temperature toward automation?',
      'What is the cost of one hour of line stoppage?',
      'Which stations have the highest worker turnover?'
    ],
    electronics: [
      'How does ESD protection affect robot cabling?',
      'What is the process changeover frequency?',
      'How many product variants run on the same line?'
    ],
    logistics: [
      'Is the pick path data already digitized?',
      'What is the seasonal volume multiplier?',
      'How many unique SKUs per shift?'
    ],
    food: [
      'What are the hygiene regulations for robot materials?',
      'What are the temperature and humidity extremes?',
      'How often is deep cleaning required?'
    ],
    metalwork: [
      'What are the dominant CNC operations (milling, turning, grinding)?',
      'What is the defect rate on current human-operated stations?',
      'How many qualified second-generation (G2) operators are available?'
    ]
  }
};

// ===========================
// Pitch Generator
// ===========================
const PitchGenerator = {
  generate(factory, robotCount, workStation, targetDays = 365) {
    const earnings = Earnings.calculate(robotCount, targetDays);
    const monthlyBossIncome = Math.round(earnings.bossTake / 12);
    const breakeven = Math.ceil((robotCount * 150000 * 0.3) / (robotCount * Earnings.DAILY_RATE * Earnings.MECHA_CUT / 30));

    return {
      factory,
      robotCount,
      workStation,
      yearlyGross: earnings.gross,
      yearlyBossTake: earnings.bossTake,
      yearlyMechaOsCut: earnings.mechaOsCut,
      monthlyBossIncome,
      roiPercent: Math.round((earnings.bossTake / (robotCount * 3000 * 12)) * 100),
      projectedSeedQuality: Math.min(0.98, 0.35 + (robotCount * 0.04)),
      desireTimeline: [
        { week: 1, event: 'First robot earns — boss sees money' },
        { week: 2, event: 'Efficiency insight revealed — "Welding station up 18%"' },
        { week: 4, event: 'Unexpected insight — "Packaging line has bigger opportunity"' },
        { week: 8, event: 'Boss calls — "Can you do 5 more?"' },
        { week: 12, event: 'Full ROI report — "Not just labor, the whole quality chain"' },
        { week: 24, event: 'Boss can\'t imagine operating without MECHA-OS' }
      ]
    };
  }
};

// ===========================
// UI Controller
// ===========================
const UI = {
  currentTab: 'deploy',
  wizardStep: 0,

  async init() {
    this.bindTabs();
    this.bindWizard();

    // Load seed data if localStorage is empty
    const seeded = await Store.loadSeedData();
    if (seeded) {
      console.log('📦 Loaded seed deployment data');
    }

    // Load email bridge
    if (typeof EmailBridge !== 'undefined') {
      await EmailBridge.loadSignals();
      console.log('📧 Email bridge loaded', EmailBridge.getStats());
    }

    this.render();
    Bus.on('deployment:added', () => this.render());
    Bus.on('deployment:updated', () => this.render());
    Bus.on('data:saved', () => this.updateHeaderStats());

    // Load demo data if empty
    const data = Store.get();
    if (data.deployments.length === 0) {
      this.showTab('deploy');
    }
  },

  // --- Tabs ---
  bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showTab(btn.dataset.tab);
      });
    });
  },

  showTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    this.render();
  },

  // --- Wizard ---
  bindWizard() {
    document.getElementById('wizard-next')?.addEventListener('click', () => this.wizardNext());
    document.getElementById('wizard-prev')?.addEventListener('click', () => this.wizardPrev());
    document.getElementById('wizard-submit')?.addEventListener('click', () => this.wizardSubmit());
  },

  wizardNext() {
    const steps = document.querySelectorAll('#deploy-wizard .wizard-step');
    if (this.wizardStep < steps.length - 1) {
      this.wizardStep++;
      this.renderWizard();
    }
  },

  wizardPrev() {
    if (this.wizardStep > 0) {
      this.wizardStep--;
      this.renderWizard();
    }
  },

  wizardSubmit() {
    const factory = {
      name: document.getElementById('f-name')?.value || 'Unnamed Factory',
      type: document.getElementById('f-type')?.value || 'metalwork',
      location: document.getElementById('f-location')?.value || 'Taiwan',
      workers: parseInt(document.getElementById('f-workers')?.value) || 50
    };
    const robots = {
      count: parseInt(document.getElementById('r-count')?.value) || 5,
      model: document.getElementById('r-model')?.value || 'Unitree G1',
      workStation: document.getElementById('r-station')?.value || 'Welding'
    };
    const revenue = {
      dailyRate: parseInt(document.getElementById('r-daily')?.value) || 200,
      mechaOsCut: 0.30
    };

    Store.addDeployment({ factory, robots, revenue });
    this.wizardStep = 0;
    this.renderWizard();
    this.showTab('earn');
  },

  renderWizard() {
    const steps = document.querySelectorAll('#deploy-wizard .wizard-step');
    const indicators = document.querySelectorAll('#deploy-wizard .wizard-step-indicator');

    steps.forEach((s, i) => s.classList.toggle('active', i === this.wizardStep));
    indicators.forEach((ind, i) => {
      ind.classList.toggle('done', i < this.wizardStep);
      ind.classList.toggle('active', i === this.wizardStep);
    });

    const prev = document.getElementById('wizard-prev');
    const next = document.getElementById('wizard-next');
    const submit = document.getElementById('wizard-submit');

    if (prev) prev.style.visibility = this.wizardStep === 0 ? 'hidden' : 'visible';
    if (next) next.style.display = this.wizardStep === steps.length - 1 ? 'none' : 'flex';
    if (submit) submit.style.display = this.wizardStep === steps.length - 1 ? 'flex' : 'none';
  },

  // --- Render ---
  render() {
    this.updateHeaderStats();

    switch (this.currentTab) {
      case 'deploy': this.renderDeploy(); break;
      case 'earn': this.renderEarn(); break;
      case 'engage': this.renderEngage(); break;
      case 'compound': this.renderCompound(); break;
      case 'pitch': this.renderPitch(); break;
    }
  },

  updateHeaderStats() {
    const deployments = Store.getDeployments();
    const totals = Earnings.totalFromDeployments(deployments);

    const el = (id) => document.getElementById(id);
    this.animateValue(el('stat-revenue'), totals.mechaOsCut);
    this.animateValue(el('stat-robots'), totals.totalRobots);
    this.animateValue(el('stat-deploys'), deployments.length);

    // Update deploy badge count
    const badge = document.getElementById('deploy-count-badge');
    if (badge) {
      badge.textContent = `${deployments.length} ACTIVE`;
      badge.className = deployments.length > 0 ? 'card-badge badge-green' : 'card-badge badge-green';
    }
  },

  animateValue(el, target) {
    if (!el) return;
    const prefix = el.dataset.prefix || '';
    const current = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
    if (current === target) { el.textContent = prefix + target.toLocaleString(); return; }

    const duration = 600;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = prefix + Math.round(current + (target - current) * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  },

  // --- Panel: Deploy ---
  renderDeploy() {
    this.renderWizard();
    const list = document.getElementById('deploy-list');
    if (!list) return;

    const deployments = Store.getDeployments();
    if (deployments.length === 0) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = deployments.map(d => {
      const days = Earnings.daysSince(d.createdAt);
      const e = Earnings.calculate(d.robots?.count || 0, days);
      return `
        <div class="deploy-item" data-id="${d.id}">
          <div class="deploy-icon">🤖</div>
          <div class="deploy-info">
            <div class="deploy-name">${d.factory?.name || 'Factory'}</div>
            <div class="deploy-meta">${d.robots?.count || 0} robots · ${d.factory?.type || 'N/A'} · ${days}d active</div>
          </div>
          <div class="deploy-earnings">$${e.mechaOsCut.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  },

  // --- Panel: Earn ---
  renderEarn() {
    const deployments = Store.getDeployments();
    const totals = Earnings.totalFromDeployments(deployments);

    const el = (id) => document.getElementById(id);
    this.animateValue(el('earn-gross'), totals.gross);
    this.animateValue(el('earn-mecha'), totals.mechaOsCut);
    this.animateValue(el('earn-boss'), totals.bossTake);
    this.animateValue(el('earn-robots'), totals.totalRobots);

    // Per-deployment earnings table
    const tbody = document.getElementById('earn-table-body');
    if (!tbody) return;

    tbody.innerHTML = deployments.map(d => {
      const days = Earnings.daysSince(d.createdAt);
      const e = Earnings.calculate(d.robots?.count || 0, days);
      return `
        <tr>
          <td>${d.factory?.name || '—'}</td>
          <td style="font-family:var(--font-mono)">${d.robots?.count || 0}</td>
          <td style="font-family:var(--font-mono)">${days}</td>
          <td style="font-family:var(--font-mono);color:var(--amber)">$${e.gross.toLocaleString()}</td>
          <td style="font-family:var(--font-mono);color:var(--cyan)">$${e.mechaOsCut.toLocaleString()}</td>
          <td style="font-family:var(--font-mono);color:var(--green)">$${e.bossTake.toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  },

  // --- Panel: Engage ---
  renderEngage() {
    const deployments = Store.getDeployments();
    const engageList = document.getElementById('engage-list');
    if (!engageList) return;

    if (deployments.length === 0) {
      engageList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎯</div>
          <h3>No deployments yet</h3>
          <p>Deploy your first factory to start the Desire Engine.</p>
        </div>
      `;
      return;
    }

    engageList.innerHTML = deployments.map(d => {
      const ds = d.desireState || {};
      const actions = DesireEngine.getNextAction(ds);
      const topAction = actions[0];
      const stageInfo = DesireEngine.STAGE_INFO[ds.stage || 'CUE'];

      return `
        <div class="card">
          <div class="card-header">
            <span class="card-title">${d.factory?.name || 'Factory'}</span>
            <span class="card-badge badge-${topAction.priority === 'critical' ? 'red' : topAction.priority === 'high' ? 'amber' : 'cyan'}">${topAction.action}</span>
          </div>
          <div class="desire-timeline">
            ${DesireEngine.STAGES.map((stage, i) => {
        const info = DesireEngine.STAGE_INFO[stage];
        const isActive = stage === ds.stage;
        const isCompleted = DesireEngine.STAGES.indexOf(ds.stage) > i;
        return `
                <div class="desire-stage ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}">
                  <div class="desire-stage-name">${info.icon} ${info.label}</div>
                  <div class="desire-stage-desc">${info.desc}</div>
                </div>
              `;
      }).join('')}
          </div>
          <div style="margin-top:16px;padding:12px 16px;background:var(--bg-glass);border:1px solid var(--border);border-radius:var(--radius-sm)">
            <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Recommended Action</div>
            <div style="font-size:0.9rem;font-weight:600">${topAction.reason}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">Content type: <span style="color:var(--purple)">${ds.content_rotation || 'insight'}</span> · Open loops: <span style="color:var(--cyan)">${ds.open_loops || 0}/${ds.max_loops || 3}</span></div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="UI.advanceDesire('${d.id}')">Advance Stage ▶</button>
            <button class="btn btn-secondary" onclick="UI.plantLoop('${d.id}')">Plant Loop 🌱</button>
            <button class="btn btn-secondary" onclick="UI.touchClient('${d.id}')">Touch 📞</button>
          </div>
        </div>
      `;
    }).join('');

    // Render email intelligence
    this.renderEmailIntel();
  },

  advanceDesire(deploymentId) {
    const data = Store.load();
    const d = data.deployments.find(x => x.id === deploymentId);
    if (!d) return;
    const newStage = DesireEngine.advanceStage(d.desireState);
    DesireEngine.rotateContent(d.desireState);
    Store.save(data);
    this.renderEngage();
    Toast.info(`${d.factory?.name}: → ${DesireEngine.STAGE_INFO[newStage]?.label}`, DesireEngine.STAGE_INFO[newStage]?.icon || '▶');
  },

  plantLoop(deploymentId) {
    const data = Store.load();
    const d = data.deployments.find(x => x.id === deploymentId);
    if (!d || !d.desireState) return;
    if (d.desireState.open_loops < d.desireState.max_loops) {
      d.desireState.open_loops++;
      d.desireState.anticipation_level = Math.min(10, d.desireState.anticipation_level + 2);
      Toast.success(`Loop planted — ${d.desireState.open_loops}/${d.desireState.max_loops} active`, '🌱');
    } else {
      Toast.warning('Max loops reached — don\'t overwhelm the boss', '⚠️');
    }
    Store.save(data);
    this.renderEngage();
  },

  touchClient(deploymentId) {
    const data = Store.load();
    const d = data.deployments.find(x => x.id === deploymentId);
    if (!d || !d.desireState) return;
    d.desireState.days_since_touch = 0;
    if (d.desireState.open_loops > 0) d.desireState.open_loops--;
    d.desireState.anticipation_level = Math.max(0, d.desireState.anticipation_level - 3);
    Store.save(data);
    this.renderEngage();
    Toast.success(`Touched ${d.factory?.name} — anticipation reset`, '📞');
  },

  // --- Email Intelligence ---
  renderEmailIntel() {
    const list = document.getElementById('email-intel-list');
    const badge = document.getElementById('email-signal-count');
    if (!list || typeof EmailBridge === 'undefined') return;

    const signals = EmailBridge.signals;
    if (badge) badge.textContent = `${signals.length} SIGNALS`;

    if (signals.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">No email intelligence signals yet.</div>';
      return;
    }

    const typeIcons = { opportunity: '💎', threat: '⚡', insight: '💡', engagement: '💬' };
    const zoneColors = { red: 'var(--red)', yellow: 'var(--amber)', green: 'var(--green)' };

    list.innerHTML = signals.map(s => {
      const icon = typeIcons[s.type] || '📧';
      const zoneColor = zoneColors[s.zone] || 'var(--text-muted)';
      const timeAgo = this._timeAgo(s.timestamp);

      return `
        <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);align-items:flex-start">
          <span style="font-size:1.2rem;flex-shrink:0">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:2px">${s.source}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">${s.subject}</div>
            <div style="font-size:0.82rem;color:var(--text-secondary)">${s.insight}</div>
          </div>
          <div style="flex-shrink:0;text-align:right">
            <div style="width:8px;height:8px;border-radius:50%;background:${zoneColor};margin-left:auto;margin-bottom:4px"></div>
            <div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono)">${timeAgo}</div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderEmailSeeds() {
    const list = document.getElementById('email-seeds-list');
    if (!list || typeof EmailBridge === 'undefined') return;

    const insights = EmailBridge.getByType('insight');
    const opportunities = EmailBridge.getByType('opportunity');
    const all = [...insights, ...opportunities];

    if (all.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">No email-derived seeds yet.</div>';
      return;
    }

    list.innerHTML = all.map(s => `
      <div class="principle-item" style="margin-bottom:8px">
        <span class="principle-num">${s.type === 'opportunity' ? '💎' : '💡'}</span>
        ${s.insight}
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">${s.source} · ${this._timeAgo(s.timestamp)}</div>
      </div>
    `).join('');
  },

  _timeAgo(isoDate) {
    if (!isoDate) return '';
    const diff = Date.now() - new Date(isoDate).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'now';
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  },

  // --- Panel: Compound ---
  renderCompound() {
    const deployments = Store.getDeployments();

    // Seed quality curve
    this.renderSeedCurve(deployments);

    // Principles
    const principlesList = document.getElementById('principles-list');
    if (principlesList) {
      principlesList.innerHTML = Principles.tier1.map(p => `
        <div class="principle-item">
          <span class="principle-num">${p.num}</span>${p.text}
        </div>
      `).join('');
    }

    // Tier 2 questions based on deployed factory types
    const questionsEl = document.getElementById('tier2-questions');
    if (questionsEl) {
      const types = [...new Set(deployments.map(d => d.factory?.type).filter(Boolean))];
      if (types.length === 0) {
        questionsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Deploy a factory to see Tier 2 thinking questions.</div>';
      } else {
        questionsEl.innerHTML = types.map(t => {
          const qs = Principles.tier2[t] || [];
          return `
            <div style="margin-bottom:16px">
              <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--purple);margin-bottom:8px">${t}</div>
              ${qs.map(q => `<div style="font-size:0.85rem;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--border)">💭 ${q}</div>`).join('')}
            </div>
          `;
        }).join('');
      }
    }

    // Lessons
    const lessonsEl = document.getElementById('lessons-list');
    if (lessonsEl) {
      const lessons = Store.getLessons();
      if (lessons.length === 0) {
        lessonsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">No lessons yet. Complete a deployment cycle to harvest insights.</div>';
      } else {
        lessonsEl.innerHTML = lessons.map(l => `
          <div class="principle-item">
            <span class="principle-num">${l.id}</span>${l.text}
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">${new Date(l.createdAt).toLocaleDateString()}</div>
          </div>
        `).join('');
      }
    }

    // Email-derived seeds
    this.renderEmailSeeds();
  },

  renderSeedCurve(deployments) {
    const canvas = document.getElementById('seed-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '200px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = 200;
    const pad = { top: 20, right: 20, bottom: 30, left: 50 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#555570';
    ctx.font = '11px Inter';
    ctx.textAlign = 'right';
    [0.35, 0.50, 0.75, 0.98].forEach(v => {
      const y = pad.top + plotH * (1 - (v - 0.3) / 0.7);
      ctx.fillText(v.toFixed(2), pad.left - 8, y + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    });

    // Data points
    const curve = SeedEngine.qualityCurve(deployments);
    if (curve.length === 0) {
      ctx.fillStyle = '#555570';
      ctx.textAlign = 'center';
      ctx.font = '13px Inter';
      ctx.fillText('Deploy factories to see seed quality compound', w / 2, h / 2);
      return;
    }

    const maxIdx = Math.max(curve.length, 5);

    // Draw curve
    ctx.beginPath();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';

    curve.forEach((pt, i) => {
      const x = pad.left + (pt.index / maxIdx) * plotW;
      const y = pad.top + plotH * (1 - (pt.quality - 0.3) / 0.7);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Glow
    ctx.strokeStyle = 'rgba(0,240,255,0.15)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Dots
    curve.forEach(pt => {
      const x = pad.left + (pt.index / maxIdx) * plotW;
      const y = pad.top + plotH * (1 - (pt.quality - 0.3) / 0.7);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#00f0ff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#050508';
      ctx.fill();
    });

    // Target line at 0.98
    const targetY = pad.top + plotH * (1 - (0.98 - 0.3) / 0.7);
    ctx.strokeStyle = 'rgba(0,230,118,0.4)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, targetY); ctx.lineTo(w - pad.right, targetY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#00e676';
    ctx.textAlign = 'left';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText('TARGET 0.98', w - pad.right - 80, targetY - 6);
  },

  // --- Panel: Pitch ---
  renderPitch() {
    const deployments = Store.getDeployments();
    const pitchOutput = document.getElementById('pitch-output');
    if (!pitchOutput) return;

    // Use form values or defaults
    const factoryName = document.getElementById('pitch-factory')?.value || 'Your Factory';
    const robotCount = parseInt(document.getElementById('pitch-robots')?.value) || 10;
    const workStation = document.getElementById('pitch-station')?.value || 'Welding';

    const pitch = PitchGenerator.generate(factoryName, robotCount, workStation);

    pitchOutput.innerHTML = `
      <div class="pitch-card">
        <h2>🤖 MECHA-OS Deployment Proposal</h2>
        <div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:24px">${factoryName} · ${workStation} Station · ${robotCount} Robots</div>

        <div class="pitch-roi">$${pitch.monthlyBossIncome.toLocaleString()}/mo</div>
        <div style="color:var(--text-muted);font-size:0.85rem">Projected Monthly Income (Boss Take)</div>

        <div class="metrics-grid" style="margin-top:24px;text-align:left">
          <div class="metric-tile metric-amber">
            <div class="metric-label">Yearly Gross</div>
            <div class="metric-value" style="font-size:1.4rem">$${pitch.yearlyGross.toLocaleString()}</div>
          </div>
          <div class="metric-tile metric-green">
            <div class="metric-label">Boss Take (70%)</div>
            <div class="metric-value" style="font-size:1.4rem">$${pitch.yearlyBossTake.toLocaleString()}</div>
          </div>
          <div class="metric-tile metric-cyan">
            <div class="metric-label">MECHA-OS (30%)</div>
            <div class="metric-value" style="font-size:1.4rem">$${pitch.yearlyMechaOsCut.toLocaleString()}</div>
          </div>
          <div class="metric-tile metric-purple">
            <div class="metric-label">Seed Quality Projection</div>
            <div class="metric-value" style="font-size:1.4rem">${pitch.projectedSeedQuality.toFixed(2)}</div>
          </div>
        </div>

        <div style="text-align:left;margin-top:24px">
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:12px">Desire Timeline</div>
          ${pitch.desireTimeline.map(t => `
            <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem">
              <span style="font-family:var(--font-mono);color:var(--cyan);min-width:60px">W${t.week}</span>
              <span style="color:var(--text-secondary)">${t.event}</span>
            </div>
          `).join('')}
        </div>

        <div style="margin-top:24px;padding:16px;background:var(--bg-glass);border-radius:var(--radius-sm);text-align:left">
          <div style="font-size:0.85rem;color:var(--amber);font-weight:600;margin-bottom:4px">机器人出去上班 · 替老闆賺錢</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Robots go to work. Boss makes money. You take 30%.</div>
        </div>

        <div class="pitch-actions">
          <button class="btn-export" onclick="copyPitchToClipboard()">📋 Copy Proposal</button>
        </div>
      </div>
    `;
  }
};

// ===========================
// Toast Notification System
// ===========================
const Toast = {
  show(message, type = 'info', icon = 'ℹ️') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },
  success(msg, icon = '✅') { this.show(msg, 'success', icon); },
  info(msg, icon = 'ℹ️') { this.show(msg, 'info', icon); },
  warning(msg, icon = '⚠️') { this.show(msg, 'warning', icon); }
};

// ===========================
// Sparkline Drawing Utility
// ===========================
const Sparkline = {
  draw(canvas, data, color = '#00f0ff') {
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = w / (data.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    data.forEach((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Glow
    ctx.strokeStyle = color.replace(')', ', 0.15)').replace('rgb', 'rgba');
    ctx.lineWidth = 4;
    ctx.stroke();
  }
};

// ===========================
// Pitch Export
// ===========================
function copyPitchToClipboard() {
  const pitchOutput = document.getElementById('pitch-output');
  if (!pitchOutput) return;

  const factoryName = document.getElementById('pitch-factory')?.value || 'Factory';
  const robotCount = parseInt(document.getElementById('pitch-robots')?.value) || 10;
  const workStation = document.getElementById('pitch-station')?.value || 'Welding';
  const pitch = PitchGenerator.generate(factoryName, robotCount, workStation);

  const text = `🤖 MECHA-OS Deployment Proposal
${factoryName} · ${workStation} Station · ${robotCount} Robots

💰 Projected Monthly Income (Boss Take): $${pitch.monthlyBossIncome.toLocaleString()}/mo
📊 Yearly Gross: $${pitch.yearlyGross.toLocaleString()}
🟢 Boss Take (70%): $${pitch.yearlyBossTake.toLocaleString()}
🔵 MECHA-OS (30%): $${pitch.yearlyMechaOsCut.toLocaleString()}
🧬 Seed Quality Projection: ${pitch.projectedSeedQuality.toFixed(2)}

📈 Desire Timeline:
${pitch.desireTimeline.map(t => `  W${t.week}: ${t.event}`).join('\n')}

机器人出去上班 · 替老闆賺錢
Robots go to work. Boss makes money. You take 30%.`;

  navigator.clipboard.writeText(text).then(() => {
    Toast.success('Proposal copied to clipboard!', '📋');
  }).catch(() => {
    Toast.warning('Failed to copy — try manually', '⚠️');
  });
}

// ===========================
// Bootstrap
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  UI.init();

  // Pitch form live update
  ['pitch-factory', 'pitch-robots', 'pitch-station'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => UI.renderPitch());
  });

  // Wire toast notifications to bus events
  Bus.on('deployment:added', (d) => {
    Toast.success(`Deployed ${d.factory?.name || 'factory'} with ${d.robots?.count || 0} robots`, '🚀');
  });
  Bus.on('data:seeded', (data) => {
    Toast.info(`Loaded ${data.count} factory deployments`, '📦');
  });
});

