// DOM elements
const reportBtn = document.getElementById('reportBtn');
const userNoteInput = document.getElementById('userNote');
const statusDiv = document.getElementById('status');
const toggleSettingsLink = document.getElementById('toggleSettings');
const settingsPanel = document.getElementById('settingsPanel');
const apiUrlInput = document.getElementById('apiUrl');
const apiKeyInput = document.getElementById('apiKey');
const saveSettingsBtn = document.getElementById('saveSettings');

// Load saved settings
chrome.storage.sync.get(['apiUrl', 'apiKey'], (result) => {
  if (result.apiUrl) apiUrlInput.value = result.apiUrl;
  if (result.apiKey) apiKeyInput.value = result.apiKey;
});

// Toggle settings panel
toggleSettingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  settingsPanel.classList.toggle('show');
});

// Save settings
saveSettingsBtn.addEventListener('click', () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '');
  const apiKey = apiKeyInput.value.trim();

  chrome.storage.sync.set({ apiUrl, apiKey }, () => {
    showStatus('Settings saved!', 'success');
    setTimeout(() => hideStatus(), 2000);
  });
});

// Show status message
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = type;
  statusDiv.style.display = 'block';
}

function hideStatus() {
  statusDiv.className = '';
  statusDiv.style.display = 'none';
}

// Report bug
reportBtn.addEventListener('click', async () => {
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiKey']);

  if (!settings.apiUrl || !settings.apiKey) {
    showStatus('Please configure API URL and Key in settings', 'error');
    settingsPanel.classList.add('show');
    return;
  }

  reportBtn.disabled = true;
  showStatus('Attaching debugger to capture logs...', 'loading');

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      throw new Error('Cannot capture logs on this page (extension/chrome pages not supported)');
    }

    // Request logs from background script via debugger API
    const capturedData = await chrome.runtime.sendMessage({
      type: 'CAPTURE_LOGS',
      tabId: tab.id
    });

    if (capturedData.error) {
      throw new Error(capturedData.error);
    }

    console.log('[Bug Reporter] Captured:', {
      consoleLogs: capturedData.consoleLogs?.length || 0,
      networkErrors: capturedData.networkErrors?.length || 0
    });

    // Extract projectId from URL
    const url = new URL(tab.url);
    const projectId = url.hostname;

    // Prepare bug report
    const bugReport = {
      url: tab.url,
      timestamp: new Date().toISOString(),
      consoleLogs: capturedData.consoleLogs || [],
      networkErrors: capturedData.networkErrors || [],
      userNote: userNoteInput.value.trim() || null,
      projectId: projectId
    };

    // Send to API
    showStatus('Sending report...', 'loading');

    const response = await fetch(`${settings.apiUrl}/api/bug-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': settings.apiKey
      },
      body: JSON.stringify(bugReport)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    // Show success with log counts
    const logCount = bugReport.consoleLogs.length;
    const networkCount = bugReport.networkErrors.length;
    let successMsg = `Bug reported! ID: ${result.id}`;
    successMsg += ` (${logCount} console logs, ${networkCount} network errors)`;
    showStatus(successMsg, 'success');
    userNoteInput.value = '';

  } catch (error) {
    console.error('[Bug Reporter] Error:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    reportBtn.disabled = false;
  }
});
