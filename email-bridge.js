/**
 * Email-OS → MECHA-DASH Bridge
 * 
 * Translates email intelligence signals into deployment dashboard format.
 * Runs client-side: reads from static JSON exports that email-os generates.
 * 
 * Signal types:
 *   - opportunity: email suggests new deployment potential
 *   - threat: email signals risk to existing deployment
 *   - insight: email reveals pattern useful for compound learning
 *   - engagement: email interaction relevant to boss engagement loop
 */

const EmailBridge = {
    signals: [],
    lastSync: null,

    // Demo intelligence data (in production, this would come from email-os exports)
    _demoSignals: [
        {
            id: 'sig001',
            type: 'opportunity',
            zone: 'red',
            source: '京茂機電 — 採購部',
            subject: 'RE: 新產線機器人需求評估',
            insight: 'Procurement dept requesting robot cost analysis for new line — upsell signal',
            deploymentId: 'd001',
            timestamp: '2026-02-22T09:14:00.000Z',
            actionable: true
        },
        {
            id: 'sig002',
            type: 'engagement',
            zone: 'yellow',
            source: '陳先生',
            subject: '焊接機器人第二個月報告',
            insight: 'Boss requesting monthly report — trust building phase, ideal for partial reward delivery',
            deploymentId: 'd002',
            timestamp: '2026-02-21T14:30:00.000Z',
            actionable: true
        },
        {
            id: 'sig003',
            type: 'insight',
            zone: 'green',
            source: 'System — 品質報告',
            subject: '自動焊接品質數據 Week 8',
            insight: 'Welding quality up 22% vs human baseline — compound this into seed',
            deploymentId: 'd001',
            timestamp: '2026-02-21T08:00:00.000Z',
            actionable: false
        },
        {
            id: 'sig004',
            type: 'threat',
            zone: 'yellow',
            source: '立達汽車 — 工會代表',
            subject: '關於自動化對就業的影響',
            insight: 'Union representative raising automation concerns — requires careful engagement',
            deploymentId: 'd003',
            timestamp: '2026-02-20T16:45:00.000Z',
            actionable: true
        },
        {
            id: 'sig005',
            type: 'opportunity',
            zone: 'yellow',
            source: '新竹物流園區 — 管理部',
            subject: 'RE: 揀貨機器人試用結果',
            insight: 'Logistics park happy with picking robot trial — ready for Phase 2 expansion',
            deploymentId: 'd005',
            timestamp: '2026-02-19T11:20:00.000Z',
            actionable: true
        },
        {
            id: 'sig006',
            type: 'engagement',
            zone: 'green',
            source: '大成食品 — 林經理',
            subject: '包裝線效率提升感謝信',
            insight: 'Thank-you email from manager — boss satisfaction confirmed, advance desire stage',
            deploymentId: 'd004',
            timestamp: '2026-02-18T10:00:00.000Z',
            actionable: false
        }
    ],

    async loadSignals() {
        // Try to load from email-os export first
        try {
            const res = await fetch('email-os/data/signals.json');
            if (res.ok) {
                const data = await res.json();
                this.signals = data.signals || [];
                this.lastSync = new Date().toISOString();
                return this.signals;
            }
        } catch {
            // Export not available — use demo data
        }

        // Fall back to demo signals
        this.signals = [...this._demoSignals];
        this.lastSync = new Date().toISOString();
        return this.signals;
    },

    getByDeployment(deploymentId) {
        return this.signals.filter(s => s.deploymentId === deploymentId);
    },

    getActionable() {
        return this.signals.filter(s => s.actionable);
    },

    getByType(type) {
        return this.signals.filter(s => s.type === type);
    },

    getStats() {
        return {
            total: this.signals.length,
            opportunities: this.signals.filter(s => s.type === 'opportunity').length,
            threats: this.signals.filter(s => s.type === 'threat').length,
            insights: this.signals.filter(s => s.type === 'insight').length,
            engagements: this.signals.filter(s => s.type === 'engagement').length,
            actionable: this.signals.filter(s => s.actionable).length,
            lastSync: this.lastSync
        };
    }
};
