// Content script to capture console logs and network errors
// This runs in the MAIN world (page context) via script injection

(function() {
  // Prevent multiple injections
  if (window.__bugReporterInitialized) return;
  window.__bugReporterInitialized = true;

  const MAX_LOGS = 100;
  const MAX_MESSAGE_LENGTH = 5000;

  // Local storage for logs (also accessible via window.__bugReporterLogs)
  const logs = {
    consoleLogs: [],
    networkErrors: []
  };
  window.__bugReporterLogs = logs;

  // Helper to send log to injector (ISOLATED world)
  function sendToInjector(type, data) {
    window.dispatchEvent(new CustomEvent('__bugReporterLog', {
      detail: { type, data }
    }));
  }

  // Helper to truncate long messages
  function truncate(str, maxLen) {
    if (typeof str !== 'string') {
      try {
        str = JSON.stringify(str);
      } catch (e) {
        str = String(str);
      }
    }
    if (str.length > maxLen) {
      return str.substring(0, maxLen) + '... [truncated]';
    }
    return str;
  }

  // Helper to format console arguments
  function formatArgs(args) {
    return Array.from(args).map(arg => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  // Capture console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  function captureConsole(level, originalFn) {
    return function(...args) {
      // Call original
      originalFn.apply(console, args);

      // Capture the log
      const entry = {
        level: level,
        message: truncate(formatArgs(args), MAX_MESSAGE_LENGTH),
        timestamp: new Date().toISOString()
      };

      // Add stack trace for errors
      if (level === 'error') {
        const stack = new Error().stack;
        if (stack) {
          entry.stack = stack.split('\n').slice(2).join('\n');
        }
      }

      logs.consoleLogs.push(entry);
      if (logs.consoleLogs.length > MAX_LOGS) {
        logs.consoleLogs.shift();
      }

      // Send to injector
      sendToInjector('console', entry);
    };
  }

  // Override console methods
  console.log = captureConsole('log', originalConsole.log);
  console.warn = captureConsole('warn', originalConsole.warn);
  console.error = captureConsole('error', originalConsole.error);
  console.info = captureConsole('info', originalConsole.info);
  console.debug = captureConsole('debug', originalConsole.debug);

  // Capture unhandled errors
  window.addEventListener('error', (event) => {
    const entry = {
      level: 'error',
      message: event.message || 'Unknown error',
      timestamp: new Date().toISOString(),
      source: event.filename,
      line: event.lineno,
      column: event.colno
    };

    if (event.error && event.error.stack) {
      entry.stack = event.error.stack;
    }

    logs.consoleLogs.push(entry);
    if (logs.consoleLogs.length > MAX_LOGS) {
      logs.consoleLogs.shift();
    }
    sendToInjector('console', entry);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const entry = {
      level: 'error',
      message: `Unhandled Promise Rejection: ${event.reason}`,
      timestamp: new Date().toISOString()
    };

    if (event.reason && event.reason.stack) {
      entry.stack = event.reason.stack;
    }

    logs.consoleLogs.push(entry);
    if (logs.consoleLogs.length > MAX_LOGS) {
      logs.consoleLogs.shift();
    }
    sendToInjector('console', entry);
  });

  // Capture network errors by overriding fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const startTime = Date.now();
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
    const method = args[1]?.method || 'GET';

    try {
      const response = await originalFetch.apply(this, args);

      // Capture failed requests (4xx and 5xx)
      if (!response.ok) {
        const entry = {
          url: truncate(url, 500),
          method: method,
          status: response.status,
          statusText: response.statusText,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
        logs.networkErrors.push(entry);
        if (logs.networkErrors.length > MAX_LOGS) {
          logs.networkErrors.shift();
        }
        sendToInjector('network', entry);
      }

      return response;
    } catch (error) {
      const entry = {
        url: truncate(url, 500),
        method: method,
        status: 0,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      logs.networkErrors.push(entry);
      if (logs.networkErrors.length > MAX_LOGS) {
        logs.networkErrors.shift();
      }
      sendToInjector('network', entry);

      throw error;
    }
  };

  // Capture XMLHttpRequest errors
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
          const entry = {
            url: truncate(this._bugReporter.url, 500),
            method: this._bugReporter.method,
            status: this.status,
            statusText: this.statusText || 'Network Error',
            duration: Date.now() - this._bugReporter.startTime,
            timestamp: new Date().toISOString()
          };
          logs.networkErrors.push(entry);
          if (logs.networkErrors.length > MAX_LOGS) {
            logs.networkErrors.shift();
          }
          sendToInjector('network', entry);
        }
      });
    }

    return originalXHRSend.apply(this, args);
  };

  // Log that we're capturing (using original to avoid self-capture noise)
  originalConsole.log('[Bug Reporter] Capturing console logs and network errors...');
})();
