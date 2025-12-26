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
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, ''); // Remove trailing slash
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
}

function hideStatus() {
  statusDiv.className = '';
  statusDiv.style.display = 'none';
}

// Report bug
reportBtn.addEventListener('click', async () => {
  // Get settings
  const settings = await chrome.storage.sync.get(['apiUrl', 'apiKey']);

  if (!settings.apiUrl || !settings.apiKey) {
    showStatus('Please configure API URL and Key in settings', 'error');
    settingsPanel.classList.add('show');
    return;
  }

  reportBtn.disabled = true;
  showStatus('Capturing browser state...', 'loading');

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    // Get logs from content script via message
    let capturedData = { consoleLogs: [], networkErrors: [] };

    try {
      capturedData = await chrome.tabs.sendMessage(tab.id, { type: 'GET_LOGS' });
    } catch (e) {
      console.log('Could not get logs from page:', e.message);
    }

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
    showStatus(`Bug reported! ID: ${result.id}`, 'success');
    userNoteInput.value = '';

  } catch (error) {
    console.error('Error reporting bug:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    reportBtn.disabled = false;
  }
});

// Content script is now automatically injected via manifest.json
