/**
 * MECHA Inbox Guard — Popup Logic
 * 
 * Loads classification results from chrome.storage.local.
 * Renders alerts with blur/unlock based on Pro status.
 */

(() => {
    let isPro = false;

    // ═══════════════════════════════════════
    // Initialize
    // ═══════════════════════════════════════

    document.addEventListener('DOMContentLoaded', async () => {
        // Check Pro status
        const stored = await chrome.storage.local.get(['mechaProKey']);
        isPro = !!stored.mechaProKey;

        // Load results
        const data = await chrome.storage.local.get([
            'mechaResults', 'mechaLastScan', 'mechaEmailCount'
        ]);

        if (data.mechaResults) {
            renderResults(data.mechaResults);
            updateScanStatus(data.mechaLastScan, data.mechaEmailCount);
        } else {
            showLoading();
        }

        // Wire up UI
        setupEventListeners();
    });

    // ═══════════════════════════════════════
    // Render
    // ═══════════════════════════════════════

    function renderResults(results) {
        const { red, yellow, green, stats } = results;

        // Stats bar
        document.getElementById('redCount').textContent = stats.red;
        document.getElementById('yellowCount').textContent = stats.yellow;
        document.getElementById('greenCount').textContent = stats.green;
        document.getElementById('totalValue').textContent = formatNTD(stats.totalEstimatedValue);

        // Alert list
        const alertList = document.getElementById('alertList');
        const loading = document.getElementById('loadingState');
        if (loading) loading.style.display = 'none';

        alertList.innerHTML = '';

        // Red alerts first
        for (const item of red) {
            alertList.appendChild(createAlertCard(item, 'red'));
        }

        // Yellow alerts
        for (const item of yellow) {
            alertList.appendChild(createAlertCard(item, 'yellow'));
        }

        // Show/hide Pro banner
        const proBanner = document.getElementById('proBanner');
        if (!isPro && (red.length > 0 || yellow.length > 0)) {
            proBanner.style.display = 'block';
        } else {
            proBanner.style.display = 'none';
        }

        // Empty state
        if (red.length === 0 && yellow.length === 0) {
            alertList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">✅</span>
                    <p>All clear! No critical items detected.</p>
                    <p class="empty-sub">${stats.total} emails scanned</p>
                </div>
            `;
        }
    }

    function createAlertCard(item, zone) {
        const card = document.createElement('div');
        card.className = `alert-card alert-${zone}`;

        const match = item.matches[0] || {};
        const from = item.email.from?.name || item.email.from?.email || 'Unknown';
        const subject = item.email.subject || '(no subject)';
        const daysText = item.daysWaiting !== null ? `${item.daysWaiting}d ago` : '';

        // Blur logic
        const blurredFrom = isPro ? escapeHtml(from) : blurText(from);
        const blurredSubject = isPro ? escapeHtml(subject) : blurText(subject);
        const blurredValue = isPro && item.estimatedValue
            ? `NT$ ${item.estimatedValue.toLocaleString()}`
            : item.estimatedValue ? 'NT$ ████████' : '';

        card.innerHTML = `
            <div class="alert-header">
                <span class="alert-icon">${match.icon || '📧'}</span>
                <span class="alert-label" style="color:${match.color || '#888'}">${match.label || zone.toUpperCase()}</span>
                ${daysText ? `<span class="alert-days ${item.daysWaiting > 7 ? 'overdue' : ''}">${daysText}</span>` : ''}
            </div>
            <div class="alert-from ${isPro ? '' : 'blurred'}">${blurredFrom}</div>
            <div class="alert-subject ${isPro ? '' : 'blurred'}">${blurredSubject}</div>
            ${blurredValue ? `<div class="alert-value ${isPro ? '' : 'blurred'}">${blurredValue}</div>` : ''}
            ${!isPro ? '<div class="unlock-hint">🔓 Unlock to see full details</div>' : ''}
        `;

        if (!isPro) {
            card.addEventListener('click', () => {
                document.getElementById('proBanner').scrollIntoView({ behavior: 'smooth' });
            });
            card.style.cursor = 'pointer';
        }

        return card;
    }

    // ═══════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════

    function blurText(text) {
        if (!text) return '████████';
        // Show first char, blur the rest
        const visible = text.slice(0, 1);
        const hidden = text.slice(1).replace(/[^\s]/g, '█');
        return escapeHtml(visible) + hidden;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatNTD(value) {
        if (!value || value === 0) return '$0';
        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
        return `$${value}`;
    }

    function updateScanStatus(lastScan, emailCount) {
        const statusEl = document.getElementById('scanStatus');
        if (!lastScan) return;

        const ago = timeSince(new Date(lastScan));
        statusEl.innerHTML = `
            <span class="status-dot active"></span>
            <span class="status-text">${emailCount} emails · ${ago}</span>
        `;
    }

    function showLoading() {
        document.getElementById('loadingState').style.display = 'flex';
    }

    function timeSince(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    // ═══════════════════════════════════════
    // Event Listeners
    // ═══════════════════════════════════════

    function setupEventListeners() {
        // Pro button
        document.getElementById('proBtn')?.addEventListener('click', () => {
            window.open('https://metaverse-digital-creative.github.io/first-priciple/pricing.html', '_blank');
        });

        // Dashboard link
        document.getElementById('dashboardLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.open('https://metaverse-digital-creative.github.io/first-priciple/', '_blank');
        });

        // Settings toggle
        document.getElementById('settingsLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('settingsPanel').style.display = 'block';
        });

        document.getElementById('closeSettings')?.addEventListener('click', () => {
            document.getElementById('settingsPanel').style.display = 'none';
        });

        // Save Pro key
        document.getElementById('saveKeyBtn')?.addEventListener('click', async () => {
            const key = document.getElementById('proKeyInput').value.trim();
            if (key) {
                await chrome.storage.local.set({ mechaProKey: key });
                isPro = true;
                // Reload results with Pro view
                const data = await chrome.storage.local.get(['mechaResults']);
                if (data.mechaResults) renderResults(data.mechaResults);
                document.getElementById('settingsPanel').style.display = 'none';
            }
        });
    }

})();
