/**
 * MECHA Inbox Guard — Background Service Worker
 * 
 * Handles:
 * - Badge counter updates (🔴 count)
 * - Message routing from content script
 * - Pro license state
 */

// Badge styling
const BADGE_COLORS = {
    red: '#ff4060',
    yellow: '#ffaa00',
    none: '#666666'
};

// Listen for scan results from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'MECHA_SCAN_COMPLETE') {
        updateBadge(message.red, message.yellow);
        sendResponse({ ok: true });
    }

    if (message.type === 'MECHA_GET_PRO_STATUS') {
        chrome.storage.local.get(['mechaProKey'], (result) => {
            sendResponse({ isPro: !!result.mechaProKey });
        });
        return true; // async response
    }
});

/**
 * Update extension badge with alert count
 */
function updateBadge(redCount, yellowCount) {
    if (redCount > 0) {
        chrome.action.setBadgeText({ text: String(redCount) });
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.red });
        chrome.action.setTitle({ title: `MECHA: ${redCount} critical items detected` });
    } else if (yellowCount > 0) {
        chrome.action.setBadgeText({ text: String(yellowCount) });
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.yellow });
        chrome.action.setTitle({ title: `MECHA: ${yellowCount} items need attention` });
    } else {
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: 'MECHA Inbox Guard — All clear' });
    }
}

// Clear badge when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({ text: '' });
    console.log('⚡ MECHA Inbox Guard installed');
});
