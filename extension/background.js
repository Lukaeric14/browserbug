// Background service worker for Browser Bug Reporter
// Handles extension lifecycle and optional auto-injection

// Inject content script when a tab is updated (page loaded)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only inject on complete and for http/https URLs
  if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(() => {
      // Silently fail - page might not allow scripts
    });
  }
});

// Handle extension icon click (if popup is disabled)
chrome.action.onClicked.addListener((tab) => {
  // This won't fire because we have a popup, but keeping for reference
  console.log('Extension clicked on tab:', tab.url);
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_LOGS') {
    // Forward to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_LOGS' }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true; // Keep channel open for async response
  }
});
