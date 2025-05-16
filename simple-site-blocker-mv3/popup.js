// popup.js

// DOM Elements
const siteUrlInput = document.getElementById('siteUrlInput');
const addSiteButton = document.getElementById('addSiteButton');
const blockedSitesList = document.getElementById('blockedSitesList');
const blockerEnabledToggle = document.getElementById('blockerEnabledToggle');
const blockerStatusText = document.getElementById('blockerStatusText');
const noSitesMessage = document.getElementById('noSitesMessage');
const popupErrorMessageDiv = document.getElementById('popupErrorMessage');

// PIN Section Elements
const pinSection = document.getElementById('pinSection');
const pinLabel = document.getElementById('pinLabel');
const pinInput = document.getElementById('pinInput');
const pinSubmitButton = document.getElementById('pinSubmitButton');
const pinCancelButton = document.getElementById('pinCancelButton');
const pinMessage = document.getElementById('pinMessage');
const mainControls = document.getElementById('mainControls'); // To hide/show main part

let currentPinOperation = null; // 'set' or 'verify'
let storedHashedPin = null; // Cache stored PIN to avoid multiple async calls

// --- Utility Functions ---
async function sha256(string) {
    const utf8 = new TextEncoder().encode(string);
    const hashBuffer = await crypto.subtle.digest('SHA-256', utf8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(bytes => bytes.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

function showPopupError(message) {
    console.error("Popup Error:", message);
    if (popupErrorMessageDiv) {
        popupErrorMessageDiv.textContent = message;
        popupErrorMessageDiv.classList.remove('hidden');
        setTimeout(() => {
            popupErrorMessageDiv.classList.add('hidden');
            popupErrorMessageDiv.textContent = '';
        }, 5000);
    }
}

function showPinMessage(message, type = 'info') { // type can be 'info', 'error', 'success'
    if (pinMessage) {
        pinMessage.textContent = message;
        pinMessage.className = ''; // Clear existing classes
        if (type === 'error') {
            pinMessage.classList.add('pin-message-error');
        } else if (type === 'success') {
            pinMessage.classList.add('pin-message-success');
        }
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Popup DOMContentLoaded");
    try {
        await loadInitialState(); // Loads blocker status and PIN

        if (blockerEnabledToggle) {
            blockerEnabledToggle.addEventListener('change', handleToggleAttempt);
        } else {
            console.error("blockerEnabledToggle not found");
        }
        if (addSiteButton) addSiteButton.addEventListener('click', handleAddSite);
        if (siteUrlInput) siteUrlInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAddSite());
        if (pinSubmitButton) pinSubmitButton.addEventListener('click', handleSubmitPin);
        if (pinCancelButton) pinCancelButton.addEventListener('click', handleCancelPin);

        console.log("Popup initialized successfully.");
    } catch (error) {
        showPopupError("Error initializing popup. Check console.");
        console.error("Fatal error during popup initialization:", error);
    }
});

async function loadInitialState() {
    console.log("Loading initial state (blocker status, PIN, sites)...");
    try {
        const data = await chrome.storage.local.get(['blockerEnabled', 'hashedPin', 'blockedSites']);
        storedHashedPin = data.hashedPin || null;
        const blockerEnabled = data.blockerEnabled === undefined ? true : data.blockerEnabled; // Default to true if not set

        if (blockerEnabledToggle) {
            blockerEnabledToggle.checked = blockerEnabled;
        }
        updateBlockerStatusText(blockerEnabled);
        await renderBlockedSites(data.blockedSites || []);

        console.log("Initial state loaded. Blocker Enabled:", blockerEnabled, "PIN set:", !!storedHashedPin);
    } catch (error) {
        showPopupError("Failed to load initial state.");
        console.error("Error loading initial state:", error);
        if (blockerEnabledToggle) blockerEnabledToggle.checked = true; // Default
        updateBlockerStatusText(true);
        await renderBlockedSites([]);
    }
}


// --- Blocker State and UI Management ---
function updateBlockerStatusText(isEnabled) {
    if (blockerStatusText) {
        blockerStatusText.textContent = isEnabled ? 'Blocker Enabled' : 'Blocker Disabled';
        blockerStatusText.style.color = isEnabled ? '#2ecc71' : '#e74c3c';
    }
}

async function setBlockerState(enable, newPinToStore = null) {
    console.log(`Setting blocker state to: ${enable}`);
    try {
        const storageUpdate = { blockerEnabled: enable };
        if (newPinToStore) {
            storageUpdate.hashedPin = newPinToStore;
            storedHashedPin = newPinToStore; // Update cached PIN
            console.log("New PIN stored.");
        }
        await chrome.storage.local.set(storageUpdate);

        if (blockerEnabledToggle) blockerEnabledToggle.checked = enable;
        updateBlockerStatusText(enable);
        hidePinSection();

        await chrome.runtime.sendMessage({ type: "TOGGLE_BLOCKER", enabled: enable });
        console.log(`Blocker ${enable ? 'enabled' : 'disabled'}. Message sent to service worker.`);
    } catch (error) {
        showPopupError("Failed to update blocker state.");
        console.error("Error setting blocker state:", error);
    }
}

// --- PIN Handling ---
function showPinSection(operation) { // operation: 'set' or 'verify'
    currentPinOperation = operation;
    if (pinSection && mainControls && pinLabel && pinInput) {
        pinLabel.textContent = operation === 'set' ? 'Set New PIN (4-8 digits):' : 'Enter PIN to Disable:';
        pinInput.value = '';
        showPinMessage(''); // Clear previous messages
        pinSection.classList.remove('hidden');
        mainControls.classList.add('hidden'); // Hide main controls when PIN section is up
        pinInput.focus();
    } else {
        console.error("PIN section elements not found for showPinSection");
    }
}

function hidePinSection() {
    if (pinSection && mainControls) {
        pinSection.classList.add('hidden');
        mainControls.classList.remove('hidden'); // Show main controls again
        pinInput.value = '';
        showPinMessage('');
        currentPinOperation = null;
    }
}

async function handleSubmitPin() {
    if (!pinInput) return;
    const pin = pinInput.value;

    if (currentPinOperation === 'set') {
        if (pin.length < 4 || pin.length > 8) {
            showPinMessage('PIN must be 4-8 digits.', 'error');
            return;
        }
        const newHashedPin = await sha256(pin);
        await setBlockerState(true, newHashedPin); // Enable blocker and store new PIN
        showPinMessage('PIN set successfully!', 'success');
        setTimeout(hidePinSection, 1500);
    } else if (currentPinOperation === 'verify') {
        if (!storedHashedPin) {
            showPinMessage('No PIN set. Cannot verify.', 'error');
            // This case should ideally not be reached if logic is correct
            await setBlockerState(false); // Allow disabling if no PIN was found (safety)
            return;
        }
        const enteredHashedPin = await sha256(pin);
        if (enteredHashedPin === storedHashedPin) {
            showPinMessage('PIN correct!', 'success');
            await setBlockerState(false); // Disable blocker
            setTimeout(hidePinSection, 1000);
        } else {
            showPinMessage('Incorrect PIN.', 'error');
            pinInput.value = ''; // Clear input on error
            pinInput.focus();
        }
    }
}

function handleCancelPin() {
    hidePinSection();
    // Revert toggle to its actual stored state if a PIN operation was cancelled
    if (blockerEnabledToggle && blockerEnabledToggle.checked !== (blockerStatusText.textContent === 'Blocker Enabled')) {
         chrome.storage.local.get('blockerEnabled').then(data => {
            if (blockerEnabledToggle) blockerEnabledToggle.checked = data.blockerEnabled === undefined ? true : data.blockerEnabled;
         });
    }
}

async function handleToggleAttempt() {
    if (!blockerEnabledToggle) return;
    // The toggle's 'checked' state now reflects the user's *intent*.
    const userWantsToEnable = blockerEnabledToggle.checked;
    
    // Get the actual current enabled state from storage to compare
    const { blockerEnabled: currentlyIsEnabled } = await chrome.storage.local.get({ blockerEnabled: true });

    console.log(`Toggle attempt. User wants to enable: ${userWantsToEnable}. Currently enabled: ${currentlyIsEnabled}. PIN set: ${!!storedHashedPin}`);

    if (userWantsToEnable) { // User is trying to ENABLE the blocker
        if (!currentlyIsEnabled) { // Only proceed if it's actually currently disabled
            if (!storedHashedPin) {
                showPinSection('set');
                // Keep toggle visually as "trying to enable" but don't commit state yet
                blockerEnabledToggle.checked = true; 
            } else {
                await setBlockerState(true); // PIN already set, just enable
            }
        } else {
            // Blocker is already enabled, toggle click might be erroneous or a quick flick.
            // Ensure UI reflects actual state.
            blockerEnabledToggle.checked = true;
        }
    } else { // User is trying to DISABLE the blocker
        if (currentlyIsEnabled) { // Only proceed if it's actually currently enabled
            if (storedHashedPin) {
                showPinSection('verify');
                // Keep toggle visually as "trying to disable" but don't commit state yet
                blockerEnabledToggle.checked = false; 
            } else {
                // No PIN set, allow disabling directly
                await setBlockerState(false);
            }
        } else {
            // Blocker is already disabled.
            blockerEnabledToggle.checked = false;
        }
    }
}


// --- Blocked Sites Management (largely unchanged, but uses showPopupError) ---
async function getBlockedSites() {
    try {
        const result = await chrome.storage.local.get({ blockedSites: [] });
        return Array.isArray(result.blockedSites) ? result.blockedSites : [];
    } catch (error) {
        showPopupError("Failed to get blocked sites.");
        console.error("Error getting blocked sites:", error);
        return [];
    }
}

async function saveBlockedSites(sites) {
    try {
        await chrome.storage.local.set({ blockedSites: sites });
    } catch (error)
    {
        showPopupError("Failed to save blocked sites.");
        console.error("Error saving blocked sites:", error);
    }
}

function getDomainFromUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return null;
    let hostname = url.trim().toLowerCase();
    try {
        if (hostname.includes('://')) {
            if (hostname.match(/^(\w+:)?\/\//)) {
                 hostname = new URL(hostname.startsWith('//') ? 'http:' + hostname : hostname).hostname;
            } else {
                hostname = hostname.split('/')[0];
            }
        } else {
            hostname = hostname.split('/')[0];
        }
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        if (/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$|^localhost$/i.test(hostname)) {
            return hostname;
        }
        if (/^[a-z0-9.-]+$/i.test(hostname) && hostname.includes('.')) { // Simpler fallback
            return hostname;
        }
    } catch (e) {
        console.warn("Could not parse URL to get domain:", url, e);
    }
    if (/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$|^localhost$/i.test(hostname.split('/')[0])) {
        return hostname.split('/')[0];
    }
    return null;
}

async function handleAddSite() {
    if (!siteUrlInput) return;
    const rawUrl = siteUrlInput.value;
    const domain = getDomainFromUrl(rawUrl);

    if (!domain) {
        showPopupError("Invalid site format. Use domain.com");
        siteUrlInput.style.borderColor = 'red';
        setTimeout(() => { if(siteUrlInput) siteUrlInput.style.borderColor = ''; }, 2000);
        return;
    }
    siteUrlInput.style.borderColor = '';

    const blockedSites = await getBlockedSites();
    if (blockedSites.includes(domain)) {
        showPopupError(`"${domain}" is already blocked.`);
        return;
    }

    blockedSites.push(domain);
    await saveBlockedSites(blockedSites);
    await renderBlockedSites(blockedSites); // Pass the updated list directly
    siteUrlInput.value = '';

    try {
        await chrome.runtime.sendMessage({ type: "UPDATE_RULES" });
        console.log("Sent UPDATE_RULES message for new site:", domain);
    } catch (error) {
        showPopupError("Error updating rules via service worker.");
        console.error("Error sending UPDATE_RULES message:", error);
    }
}

async function handleRemoveSite(siteToRemove) {
    let blockedSites = await getBlockedSites();
    blockedSites = blockedSites.filter(site => site !== siteToRemove);
    await saveBlockedSites(blockedSites);
    await renderBlockedSites(blockedSites); // Pass the updated list

    try {
        await chrome.runtime.sendMessage({ type: "UPDATE_RULES" });
    } catch (error) {
        showPopupError("Error updating rules after removal.");
    }
}

async function renderBlockedSites(sitesToRender) { // Accepts sites as argument
    if (!blockedSitesList || !noSitesMessage) {
        console.error("Blocked sites list or no sites message element not found.");
        return;
    }
    // If sitesToRender is not provided, fetch it.
    const sites = sitesToRender === undefined ? await getBlockedSites() : sitesToRender;
    
    blockedSitesList.innerHTML = '';

    if (sites.length === 0) {
        noSitesMessage.classList.remove('hidden');
    } else {
        noSitesMessage.classList.add('hidden');
        sites.forEach(site => {
            const listItem = document.createElement('li');
            const siteText = document.createElement('span');
            siteText.textContent = site;
            siteText.classList.add('site-entry');
            listItem.appendChild(siteText);

            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.classList.add('remove-site-button');
            removeButton.addEventListener('click', () => handleRemoveSite(site));
            listItem.appendChild(removeButton);
            blockedSitesList.appendChild(listItem);
        });
    }
    console.log("Blocked sites rendered.");
}
