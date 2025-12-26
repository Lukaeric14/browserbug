// Injector script - runs in ISOLATED world, injects content.js into MAIN world
// This allows content.js to capture console logs from the page context

// Inject content.js into the page's main world
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content.js');
script.onload = function() {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Storage for captured logs (bridged from MAIN world)
let capturedLogs = {
  consoleLogs: [],
  networkErrors: []
};

// Listen for messages from the injected script (MAIN world)
window.addEventListener('__bugReporterLog', (event) => {
  if (event.detail && event.detail.type === 'console') {
    capturedLogs.consoleLogs.push(event.detail.data);
    // Keep only last 100
    if (capturedLogs.consoleLogs.length > 100) {
      capturedLogs.consoleLogs.shift();
    }
  } else if (event.detail && event.detail.type === 'network') {
    capturedLogs.networkErrors.push(event.detail.data);
    // Keep only last 100
    if (capturedLogs.networkErrors.length > 100) {
      capturedLogs.networkErrors.shift();
    }
  }
});

// Listen for requests from popup to get logs
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_LOGS') {
    sendResponse(capturedLogs);
  }
  return true;
});

// Also expose via window for direct access from popup's executeScript
window.__bugReporterLogs = capturedLogs;
