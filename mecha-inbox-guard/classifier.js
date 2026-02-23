/**
 * MECHA Inbox Guard — Classification Engine
 * 
 * Bilingual (EN + 繁中) pattern matching for:
 *   - RFQ / Quotation requests (critical — revenue)
 *   - Compliance / Certification (critical — risk)
 *   - Approvals / Pending actions (action required)
 *   - Client follow-ups (important)
 *   - Noise (newsletter, seasonal, marketing)
 * 
 * Runs 100% client-side. Zero data leaves the browser.
 */

const MechaClassifier = (() => {

    // ═══════════════════════════════════════
    // POSITIVE SIGNALS (boost priority)
    // ═══════════════════════════════════════

    const PATTERNS = {
        rfq: {
            priority: 'critical',
            label: 'RFQ / 報價',
            color: '#ff4060',
            icon: '💰',
            patterns: [
                /\brfq\b/i, /報價/i, /詢價/i, /\bquote\b/i, /quotation/i,
                /pricing/i, /\binquiry\b/i, /估價/i, /需求單/i, /採購/i,
                /purchase\s*order/i, /PO[\s#\-]/i, /enquiry/i, /見積/i,
                /請報價/i, /單價/i, /交期/i, /下單/i, /訂單/i,
                /樣品/i, /圖面/i, /圖紙/i, /規格/i
            ]
        },
        compliance: {
            priority: 'critical',
            label: 'Compliance / 認證',
            color: '#ffaa00',
            icon: '⚠️',
            patterns: [
                /\biso\b/i, /認證/i, /\baudit\b/i, /到期/i, /expir/i,
                /renew/i, /複審/i, /compliance/i, /certif/i, /deadline/i,
                /AS\s*9100/i, /IATF/i, /NADCAP/i, /稽核/i
            ]
        },
        approval: {
            priority: 'action',
            label: 'Approval / 簽核',
            color: '#ff8800',
            icon: '📋',
            patterns: [
                /簽核/i, /待放行/i, /稽催/i, /approve/i, /approval/i,
                /pending/i, /overdue/i, /待核/i, /核准/i
            ]
        },
        client: {
            priority: 'important',
            label: 'Client / 跟催',
            color: '#00f0ff',
            icon: '📞',
            patterns: [
                /urgent/i, /急件/i, /跟催/i, /follow[\s\-]*up/i,
                /re:\s*re:/i, /催貨/i, /催交/i, /追蹤/i
            ]
        }
    };

    // ═══════════════════════════════════════
    // NEGATIVE SIGNALS (suppress noise)
    // ═══════════════════════════════════════

    const NOISE_PATTERNS = {
        newsletter: {
            patterns: [
                /unsubscribe/i, /取消訂閱/i, /退訂/i, /newsletter/i,
                /\bedm\b/i, /電子報/i, /weekly\s*digest/i, /mailing\s*list/i
            ],
            weight: -30
        },
        seasonal: {
            patterns: [
                /新年快樂/i, /春節/i, /祝福/i, /恭喜/i, /happy\s*new\s*year/i,
                /merry\s*christmas/i, /season.*greet/i, /中秋/i, /端午/i
            ],
            weight: -40
        },
        marketing: {
            patterns: [
                /limited\s*time/i, /限時/i, /優惠/i, /促銷/i, /special\s*offer/i,
                /free\s*trial/i, /webinar/i, /register\s*now/i, /立即報名/i
            ],
            weight: -20
        },
        auto_notification: {
            patterns: [
                /交易結果/i, /對帳單/i, /繳款單/i, /payment\s*confirm/i,
                /no[\s\-]*reply/i, /automated/i, /notification/i, /系統通知/i
            ],
            weight: -25
        }
    };

    /**
     * Classify a single email
     * @param {object} email - { subject, snippet, from, date }
     * @returns {object} Classification result
     */
    function classify(email) {
        const text = `${email.subject || ''} ${email.snippet || ''}`;
        const matches = [];
        let score = 0;
        let isNoise = false;

        // Check positive patterns
        for (const [type, config] of Object.entries(PATTERNS)) {
            for (const pattern of config.patterns) {
                if (pattern.test(text)) {
                    matches.push({
                        type,
                        priority: config.priority,
                        label: config.label,
                        color: config.color,
                        icon: config.icon,
                        pattern: pattern.source
                    });
                    score += config.priority === 'critical' ? 30 :
                        config.priority === 'action' ? 20 : 10;
                    break; // One match per category is enough
                }
            }
        }

        // Check negative patterns
        let noiseScore = 0;
        const noiseTypes = [];
        for (const [type, config] of Object.entries(NOISE_PATTERNS)) {
            for (const pattern of config.patterns) {
                if (pattern.test(text)) {
                    noiseScore += config.weight;
                    noiseTypes.push(type);
                    break;
                }
            }
        }

        score += noiseScore;
        if (score < 0 && matches.length === 0) isNoise = true;

        // Determine zone
        let zone = 'green';
        if (matches.some(m => m.priority === 'critical') && !isNoise) zone = 'red';
        else if (matches.some(m => m.priority === 'action' || m.priority === 'important') && !isNoise) zone = 'yellow';

        // Value estimation (rough heuristic for RFQs)
        let estimatedValue = null;
        if (matches.some(m => m.type === 'rfq')) {
            // Extract numbers from subject
            const numMatch = text.match(/[\d,]+(?:\.\d+)?/);
            if (numMatch) {
                const num = parseFloat(numMatch[0].replace(/,/g, ''));
                if (num > 1000) estimatedValue = num;
            }
            if (!estimatedValue) estimatedValue = 500000; // Default NT$500K estimate
        }

        // Days waiting
        let daysWaiting = null;
        if (email.date) {
            const emailDate = new Date(email.date);
            if (!isNaN(emailDate.getTime())) {
                daysWaiting = Math.floor((Date.now() - emailDate.getTime()) / 86400000);
            }
        }

        return {
            zone,
            score: Math.max(0, score),
            matches,
            isNoise,
            noiseTypes,
            estimatedValue,
            daysWaiting,
            email: {
                subject: email.subject,
                from: email.from,
                snippet: email.snippet,
                date: email.date
            }
        };
    }

    /**
     * Classify an array of emails
     * @param {Array} emails
     * @returns {object} { red: [], yellow: [], green: [], stats }
     */
    function classifyAll(emails) {
        const results = { red: [], yellow: [], green: [] };
        let totalValue = 0;

        for (const email of emails) {
            const result = classify(email);
            results[result.zone].push(result);
            if (result.estimatedValue) totalValue += result.estimatedValue;
        }

        return {
            ...results,
            stats: {
                total: emails.length,
                red: results.red.length,
                yellow: results.yellow.length,
                green: results.green.length,
                totalEstimatedValue: totalValue,
                scanTime: new Date().toISOString()
            }
        };
    }

    return { classify, classifyAll, PATTERNS, NOISE_PATTERNS };
})();

// Export for content script
if (typeof window !== 'undefined') {
    window.MechaClassifier = MechaClassifier;
}
