// Background service worker for Browser Bug Reporter
// Uses Chrome DevTools Protocol (CDP) via chrome.debugger API to capture logs

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_LOGS') {
    captureLogs(message.tabId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }
});

async function captureLogs(tabId) {
  const consoleLogs = [];
  const networkErrors = [];
  const networkRequests = new Map(); // Track requests by requestId

  // Promisify chrome.debugger methods
  const attach = (target, version) => new Promise((resolve, reject) => {
    chrome.debugger.attach(target, version, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });

  const detach = (target) => new Promise((resolve) => {
    chrome.debugger.detach(target, () => resolve());
  });

  const sendCommand = (target, method, params = {}) => new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });

  const target = { tabId };

  // Event handler for debugger events
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;

    // Console messages (deprecated but still works)
    if (method === 'Console.messageAdded') {
      const msg = params.message;
      consoleLogs.push({
        level: msg.level || 'log',
        message: msg.text || '',
        timestamp: new Date().toISOString(),
        source: msg.url,
        line: msg.line,
        column: msg.column,
        stack: msg.stackTrace ? formatStackTrace(msg.stackTrace) : undefined
      });
    }

    // Log entries (newer API)
    if (method === 'Log.entryAdded') {
      const entry = params.entry;
      consoleLogs.push({
        level: entry.level || 'log',
        message: entry.text || '',
        timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString(),
        source: entry.url,
        line: entry.lineNumber,
        stack: entry.stackTrace ? formatStackTrace(entry.stackTrace) : undefined
      });
    }

    // Runtime console API calls
    if (method === 'Runtime.consoleAPICalled') {
      const args = params.args || [];
      const message = args.map(arg => {
        if (arg.type === 'string') return arg.value;
        if (arg.type === 'number') return String(arg.value);
        if (arg.type === 'boolean') return String(arg.value);
        if (arg.type === 'undefined') return 'undefined';
        if (arg.type === 'object' && arg.preview) {
          return formatObjectPreview(arg.preview);
        }
        if (arg.description) return arg.description;
        return arg.value !== undefined ? String(arg.value) : '[object]';
      }).join(' ');

      consoleLogs.push({
        level: params.type || 'log',
        message: message,
        timestamp: params.timestamp ? new Date(params.timestamp).toISOString() : new Date().toISOString(),
        stack: params.stackTrace ? formatStackTrace(params.stackTrace) : undefined
      });
    }

    // Runtime exceptions
    if (method === 'Runtime.exceptionThrown') {
      const ex = params.exceptionDetails;
      consoleLogs.push({
        level: 'error',
        message: ex.text || (ex.exception ? ex.exception.description : 'Unknown error'),
        timestamp: params.timestamp ? new Date(params.timestamp).toISOString() : new Date().toISOString(),
        source: ex.url,
        line: ex.lineNumber,
        column: ex.columnNumber,
        stack: ex.stackTrace ? formatStackTrace(ex.stackTrace) : undefined
      });
    }

    // Network request started
    if (method === 'Network.requestWillBeSent') {
      networkRequests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        timestamp: params.timestamp,
        type: params.type
      });
    }

    // Network response received
    if (method === 'Network.responseReceived') {
      const request = networkRequests.get(params.requestId);
      if (request && params.response.status >= 400) {
        networkErrors.push({
          url: request.url.substring(0, 500),
          method: request.method,
          status: params.response.status,
          statusText: params.response.statusText,
          type: request.type,
          timestamp: new Date(request.timestamp * 1000).toISOString()
        });
      }
    }

    // Network request failed
    if (method === 'Network.loadingFailed') {
      const request = networkRequests.get(params.requestId);
      if (request) {
        networkErrors.push({
          url: request.url.substring(0, 500),
          method: request.method,
          status: 0,
          error: params.errorText || 'Network error',
          type: request.type,
          timestamp: new Date(request.timestamp * 1000).toISOString(),
          canceled: params.canceled
        });
      }
    }
  };

  try {
    // Add event listener
    chrome.debugger.onEvent.addListener(onEvent);

    // Attach debugger
    await attach(target, '1.3');

    // Enable domains - this will send historical messages
    await sendCommand(target, 'Console.enable');
    await sendCommand(target, 'Log.enable');
    await sendCommand(target, 'Runtime.enable');
    await sendCommand(target, 'Network.enable');

    // Small delay to collect messages that come in after enabling
    await new Promise(resolve => setTimeout(resolve, 500));

    // Detach debugger (removes the yellow banner)
    await detach(target);

    // Remove event listener
    chrome.debugger.onEvent.removeListener(onEvent);

    // Dedupe console logs by message + timestamp
    const uniqueLogs = [];
    const seen = new Set();
    for (const log of consoleLogs) {
      const key = `${log.level}:${log.message}:${log.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueLogs.push(log);
      }
    }

    // Sort by timestamp
    uniqueLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    networkErrors.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      consoleLogs: uniqueLogs.slice(-100), // Last 100
      networkErrors: networkErrors.slice(-100)
    };

  } catch (err) {
    // Clean up on error
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await detach(target); } catch (e) {}
    throw err;
  }
}

function formatStackTrace(stackTrace) {
  if (!stackTrace || !stackTrace.callFrames) return undefined;
  return stackTrace.callFrames.map(frame => {
    const fn = frame.functionName || '(anonymous)';
    const url = frame.url || '';
    const line = frame.lineNumber || 0;
    const col = frame.columnNumber || 0;
    return `    at ${fn} (${url}:${line}:${col})`;
  }).join('\n');
}

function formatObjectPreview(preview) {
  if (preview.type === 'object' && preview.subtype === 'array') {
    const items = (preview.properties || []).map(p => p.value).join(', ');
    return `[${items}]`;
  }
  if (preview.type === 'object') {
    const props = (preview.properties || []).map(p => `${p.name}: ${p.value}`).join(', ');
    return `{${props}}`;
  }
  return preview.description || String(preview);
}
