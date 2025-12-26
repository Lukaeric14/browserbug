// Injector script - runs in ISOLATED world, injects capture code into MAIN world
// Must run synchronously BEFORE any page scripts to capture all console logs

// The capture script - inlined for synchronous execution
const captureScript = `
(function() {
  if (window.__bugReporterInitialized) return;
  window.__bugReporterInitialized = true;

  const MAX_LOGS = 100;
  const MAX_MESSAGE_LENGTH = 5000;

  const logs = { consoleLogs: [], networkErrors: [] };
  window.__bugReporterLogs = logs;

  function sendToInjector(type, data) {
    window.dispatchEvent(new CustomEvent('__bugReporterLog', { detail: { type, data } }));
  }

  function truncate(str, maxLen) {
    if (typeof str !== 'string') {
      try { str = JSON.stringify(str); } catch (e) { str = String(str); }
    }
    return str.length > maxLen ? str.substring(0, maxLen) + '... [truncated]' : str;
  }

  function formatArgs(args) {
    return Array.from(args).map(arg => {
      if (arg instanceof Error) return arg.name + ': ' + arg.message + '\\n' + (arg.stack || '');
      if (typeof arg === 'object') {
        try { return JSON.stringify(arg, null, 2); } catch (e) { return String(arg); }
      }
      return String(arg);
    }).join(' ');
  }

  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  function captureConsole(level, originalFn) {
    return function(...args) {
      originalFn.apply(console, args);
      const entry = {
        level: level,
        message: truncate(formatArgs(args), MAX_MESSAGE_LENGTH),
        timestamp: new Date().toISOString()
      };
      if (level === 'error') {
        const stack = new Error().stack;
        if (stack) entry.stack = stack.split('\\n').slice(2).join('\\n');
      }
      logs.consoleLogs.push(entry);
      if (logs.consoleLogs.length > MAX_LOGS) logs.consoleLogs.shift();
      sendToInjector('console', entry);
    };
  }

  console.log = captureConsole('log', originalConsole.log);
  console.warn = captureConsole('warn', originalConsole.warn);
  console.error = captureConsole('error', originalConsole.error);
  console.info = captureConsole('info', originalConsole.info);
  console.debug = captureConsole('debug', originalConsole.debug);

  window.addEventListener('error', (event) => {
    const entry = {
      level: 'error',
      message: event.message || 'Unknown error',
      timestamp: new Date().toISOString(),
      source: event.filename,
      line: event.lineno,
      column: event.colno
    };
    if (event.error && event.error.stack) entry.stack = event.error.stack;
    logs.consoleLogs.push(entry);
    if (logs.consoleLogs.length > MAX_LOGS) logs.consoleLogs.shift();
    sendToInjector('console', entry);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const entry = {
      level: 'error',
      message: 'Unhandled Promise Rejection: ' + event.reason,
      timestamp: new Date().toISOString()
    };
    if (event.reason && event.reason.stack) entry.stack = event.reason.stack;
    logs.consoleLogs.push(entry);
    if (logs.consoleLogs.length > MAX_LOGS) logs.consoleLogs.shift();
    sendToInjector('console', entry);
  });

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const startTime = Date.now();
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
    const method = args[1]?.method || 'GET';
    try {
      const response = await originalFetch.apply(this, args);
      if (!response.ok) {
        const entry = { url: truncate(url, 500), method, status: response.status, statusText: response.statusText, duration: Date.now() - startTime, timestamp: new Date().toISOString() };
        logs.networkErrors.push(entry);
        if (logs.networkErrors.length > MAX_LOGS) logs.networkErrors.shift();
        sendToInjector('network', entry);
      }
      return response;
    } catch (error) {
      const entry = { url: truncate(url, 500), method, status: 0, error: error.message, duration: Date.now() - startTime, timestamp: new Date().toISOString() };
      logs.networkErrors.push(entry);
      if (logs.networkErrors.length > MAX_LOGS) logs.networkErrors.shift();
      sendToInjector('network', entry);
      throw error;
    }
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._bugReporter = { method, url, startTime: null };
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._bugReporter) {
      this._bugReporter.startTime = Date.now();
      this.addEventListener('loadend', () => {
        if (this.status >= 400 || this.status === 0) {
          const entry = { url: truncate(this._bugReporter.url, 500), method: this._bugReporter.method, status: this.status, statusText: this.statusText || 'Network Error', duration: Date.now() - this._bugReporter.startTime, timestamp: new Date().toISOString() };
          logs.networkErrors.push(entry);
          if (logs.networkErrors.length > MAX_LOGS) logs.networkErrors.shift();
          sendToInjector('network', entry);
        }
      });
    }
    return originalXHRSend.apply(this, args);
  };
})();
`;

// Inject synchronously into MAIN world
const script = document.createElement('script');
script.textContent = captureScript;
(document.head || document.documentElement).appendChild(script);
script.remove();

// Storage for captured logs (bridged from MAIN world)
let capturedLogs = {
  consoleLogs: [],
  networkErrors: []
};

// Listen for messages from the injected script (MAIN world)
window.addEventListener('__bugReporterLog', (event) => {
  if (event.detail && event.detail.type === 'console') {
    capturedLogs.consoleLogs.push(event.detail.data);
    if (capturedLogs.consoleLogs.length > 100) {
      capturedLogs.consoleLogs.shift();
    }
  } else if (event.detail && event.detail.type === 'network') {
    capturedLogs.networkErrors.push(event.detail.data);
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
