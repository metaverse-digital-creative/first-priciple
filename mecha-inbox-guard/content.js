/**
 * MECHA Inbox Guard — Gmail Content Script
 * 
 * Reads email subjects/senders from Gmail DOM.
 * Classifies using MechaClassifier (injected before this script).
 * Sends results to background service worker for badge update.
 * 
 * Runs at document_idle on mail.google.com.
 * ⚠️ NO data leaves the browser.
 */

(() => {
    const SCAN_INTERVAL = 30000; // Re-scan every 30s
    const DEBOUNCE_MS = 2000;    // Debounce after DOM changes
    let debounceTimer = null;
    let lastScanHash = '';

    /**
     * Extract visible emails from Gmail DOM
     */
    function extractEmails() {
        const emails = [];

        // Gmail inbox rows — each <tr> in the main table
        const rows = document.querySelectorAll('tr.zA');

        for (const row of rows) {
            try {
                // Sender
                const senderEl = row.querySelector('.yW .bA4 span[email]') ||
                    row.querySelector('.yW span[email]') ||
                    row.querySelector('.yW');
                const fromEmail = senderEl?.getAttribute('email') || '';
                const fromName = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || '';

                // Subject
                const subjectEl = row.querySelector('.bog span') ||
                    row.querySelector('.y6 span');
                const subject = subjectEl?.textContent?.trim() || '';

                // Snippet
                const snippetEl = row.querySelector('.y2');
                const snippet = snippetEl?.textContent?.trim()?.replace(/^\s*[-–—]\s*/, '') || '';

                // Date
                const dateEl = row.querySelector('.xW span');
                const dateStr = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';

                // Is unread?
                const isUnread = row.classList.contains('zE');

                // Is starred?
                const isStarred = row.querySelector('.T-KT-Jp[aria-label*="Starred"]') !== null;

                if (subject || fromName) {
                    emails.push({
                        subject,
                        snippet,
                        from: { email: fromEmail, name: fromName },
                        date: dateStr,
                        isUnread,
                        isStarred
                    });
                }
            } catch {
                // Skip malformed rows
            }
        }

        return emails;
    }

    /**
     * Run classification and update badge
     */
    function scan() {
        const emails = extractEmails();
        if (emails.length === 0) return;

        // Simple hash to avoid redundant scans
        const hash = emails.map(e => e.subject).join('|').slice(0, 500);
        if (hash === lastScanHash) return;
        lastScanHash = hash;

        // Classify
        const results = MechaClassifier.classifyAll(emails);

        // Store results locally
        chrome.storage.local.set({
            mechaResults: results,
            mechaLastScan: new Date().toISOString(),
            mechaEmailCount: emails.length
        });

        // Update badge via background
        chrome.runtime.sendMessage({
            type: 'MECHA_SCAN_COMPLETE',
            red: results.stats.red,
            yellow: results.stats.yellow,
            total: results.stats.total,
            totalValue: results.stats.totalEstimatedValue
        });

        console.log(
            `%c⚡ MECHA Inbox Guard %c Scanned ${emails.length} emails → ` +
            `🔴 ${results.stats.red} | 🟡 ${results.stats.yellow} | 🟢 ${results.stats.green}`,
            'background:#0a0a1a;color:#00f0ff;padding:2px 8px;border-radius:3px;font-weight:bold',
            'color:#888'
        );
    }

    /**
     * Debounced scan trigger
     */
    function debouncedScan() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scan, DEBOUNCE_MS);
    }

    // ═══════════════════════════════════════
    // Initialize
    // ═══════════════════════════════════════

    // Initial scan after page loads
    setTimeout(scan, 3000);

    // Re-scan periodically
    setInterval(scan, SCAN_INTERVAL);

    // Watch for Gmail navigation (SPA — URL hash changes)
    let lastHash = location.hash;
    setInterval(() => {
        if (location.hash !== lastHash) {
            lastHash = location.hash;
            setTimeout(scan, 1500);
        }
    }, 1000);

    // Watch for DOM changes (new emails arriving)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                debouncedScan();
                break;
            }
        }
    });

    // Observe the main content area
    const waitForGmail = setInterval(() => {
        const mainContent = document.querySelector('[role="main"]') ||
            document.querySelector('.AO');
        if (mainContent) {
            clearInterval(waitForGmail);
            observer.observe(mainContent, { childList: true, subtree: true });
            console.log('%c⚡ MECHA Inbox Guard active', 'color:#00f0ff;font-weight:bold');
        }
    }, 1000);

})();
