// service-worker.js

// --- Helper Functions for Rules ---

// Function to get current blocked sites and blocker status from storage
async function getStorageData() {
    try {
        const data = await chrome.storage.local.get({ blockedSites: [], blockerEnabled: true });
        // Ensure blockedSites is always an array
        if (!Array.isArray(data.blockedSites)) {
            console.warn("Service Worker: blockedSites from storage was not an array, defaulting to []. Value was:", data.blockedSites);
            data.blockedSites = [];
        }
        return data;
    } catch (error) {
        console.error("Service Worker: Error getting data from storage:", error);
        return { blockedSites: [], blockerEnabled: true }; // Default values on error
    }
}

// Function to update the declarativeNetRequest rules
async function updateDeclarativeNetRequestRules() {
    const { blockedSites, blockerEnabled } = await getStorageData();
    console.log("Service Worker: Updating rules. Blocker enabled:", blockerEnabled, "Sites:", blockedSites);

    let currentRules = [];
    try {
        currentRules = await chrome.declarativeNetRequest.getDynamicRules();
    } catch (e) {
        console.error("Service Worker: Error fetching current dynamic rules:", e);
        // Proceeding with an empty currentRules array if fetching fails
    }
    
    const ruleIdsToRemove = currentRules.map(rule => rule.id);

    const rulesToAdd = [];
    if (blockerEnabled && Array.isArray(blockedSites)) {
        let dynamicRuleIdCounter = 1; // Start IDs from 1 for each batch of new rules
        blockedSites.forEach(site => {
            // 'site' should already be a cleaned domain from popup.js
            if (typeof site === 'string' && site.trim() !== '') {
                const domainToBlock = site.trim().toLowerCase(); // Ensure lowercase

                if (domainToBlock) { 
                    rulesToAdd.push({
                        id: dynamicRuleIdCounter++, // Assign a unique ID for each rule in this batch
                        priority: 1,
                        action: { type: 'block' },
                        condition: {
                            // urlFilter: matches domain and subdomains.
                            // Example: `||example.com^` blocks `http(s)://(www.)example.com/anything`
                            // and `http(s)://sub.example.com/anything`
                            urlFilter: `||${domainToBlock}^`,
                            resourceTypes: [
                                'main_frame', 'sub_frame', 'script', 'image', 'stylesheet', 'object',
                                'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket',
                                'webtransport', 'font', 'other'
                            ]
                        }
                    });
                } else {
                    console.warn("Service Worker: Resulting domain to block is empty for site entry:", site);
                }
            } else {
                console.warn("Service Worker: Invalid site found in blockedSites list (not a string or empty):", site);
            }
        });
    }

    try {
        // Step 1: Always remove all existing dynamic rules if any are present.
        if (ruleIdsToRemove.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: ruleIdsToRemove
            });
            console.log(`Service Worker: Removed ${ruleIdsToRemove.length} old rule(s). IDs: ${ruleIdsToRemove.join(', ')}`);
        } else {
            console.log("Service Worker: No old rules to remove.");
        }

        // Step 2: If the blocker is enabled and there are new rules to add, add them.
        if (blockerEnabled && rulesToAdd.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: rulesToAdd
            });
            console.log(`Service Worker: Added ${rulesToAdd.length} new rule(s).`);
        } else if (!blockerEnabled) {
            console.log("Service Worker: Blocker is disabled. No new rules added (old ones cleared).");
        } else { // Blocker enabled but no sites to block (rulesToAdd is empty)
            console.log("Service Worker: Blocker is enabled, but no sites to block (old rules cleared, no new rules to add).");
        }

    } catch (error) {
        console.error("Service Worker: Error updating declarativeNetRequest rules:", error);
        if (error.message && error.message.includes("Invalid rule ID")) {
            console.error("Service Worker: This might be due to rule IDs not being unique or exceeding limits. Rules attempted to add:", rulesToAdd);
        }
    }

    // For debugging: Log current rules after update attempt
    try {
        const finalRules = await chrome.declarativeNetRequest.getDynamicRules();
        console.log("Service Worker: Current dynamic rules after update:", finalRules);
    } catch (e) {
        console.error("Service Worker: Error fetching final dynamic rules for logging", e);
    }
}


// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("Service Worker: Extension installed or updated.", details);
    if (details.reason === 'install') {
        try {
            // Initialize storage with default values
            await chrome.storage.local.set({ blockedSites: [], blockerEnabled: true });
            console.log("Service Worker: Initialized storage with defaults.");
        } catch (e) {
            console.error("Service Worker: Error initializing storage on install:", e);
        }
    }
    // Always update rules on install/update to ensure consistency
    await updateDeclarativeNetRequestRules();
});

// It's good practice to also update rules when the browser starts up,
// in case the service worker was terminated and needs to re-establish rules.
chrome.runtime.onStartup.addListener(async () => {
    console.log("Service Worker: Browser started.");
    await updateDeclarativeNetRequestRules();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Service Worker: Message received", message);
    if (message.type === "UPDATE_RULES" || message.type === "TOGGLE_BLOCKER") {
        updateDeclarativeNetRequestRules().then(() => {
            sendResponse({ status: "Rules updated successfully by service worker." });
        }).catch(error => {
            console.error("Service Worker: Error processing message and updating rules:", error);
            sendResponse({ status: "Error updating rules.", error: error.message });
        });
        return true; // Indicates that the response is sent asynchronously
    }
    // Handle other message types if any in the future
    return false; // No async response for other message types
});

// Initial rule setup when the service worker starts (e.g., after an update or browser restart)
// This ensures rules are applied even if no popup interaction happens immediately.
(async () => {
    console.log("Service Worker: Initializing/starting up and ensuring rules are set.");
    await updateDeclarativeNetRequestRules();
})();
