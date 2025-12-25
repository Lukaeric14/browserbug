// Content script to capture console logs and network errors
// This runs in the context of the web page

(function() {
  // Prevent multiple injections
  if (window.__bugReporterInitialized) return;
  window.__bugReporterInitialized = true;

  // Storage for captured data
  window.__bugReporterLogs = {
    consoleLogs: [],
    networkErrors: []
  };

  const MAX_LOGS = 100;
  const MAX_MESSAGE_LENGTH = 5000;

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

  // Helper to serialize error objects
  function serializeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    return error;
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
          entry.stack = stack.split('\n').slice(2).join('\n'); // Remove Error and this function
        }
      }

      window.__bugReporterLogs.consoleLogs.push(entry);

      // Keep only last MAX_LOGS entries
      if (window.__bugReporterLogs.consoleLogs.length > MAX_LOGS) {
        window.__bugReporterLogs.consoleLogs.shift();
      }
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

    window.__bugReporterLogs.consoleLogs.push(entry);

    if (window.__bugReporterLogs.consoleLogs.length > MAX_LOGS) {
      window.__bugReporterLogs.consoleLogs.shift();
    }
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

    window.__bugReporterLogs.consoleLogs.push(entry);

    if (window.__bugReporterLogs.consoleLogs.length > MAX_LOGS) {
      window.__bugReporterLogs.consoleLogs.shift();
    }
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
        window.__bugReporterLogs.networkErrors.push({
          url: truncate(url, 500),
          method: method,
          status: response.status,
          statusText: response.statusText,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        });

        if (window.__bugReporterLogs.networkErrors.length > MAX_LOGS) {
          window.__bugReporterLogs.networkErrors.shift();
        }
      }

      return response;
    } catch (error) {
      // Capture network errors (connection refused, CORS, etc)
      window.__bugReporterLogs.networkErrors.push({
        url: truncate(url, 500),
        method: method,
        status: 0,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });

      if (window.__bugReporterLogs.networkErrors.length > MAX_LOGS) {
        window.__bugReporterLogs.networkErrors.shift();
      }

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
          window.__bugReporterLogs.networkErrors.push({
            url: truncate(this._bugReporter.url, 500),
            method: this._bugReporter.method,
            status: this.status,
            statusText: this.statusText || 'Network Error',
            duration: Date.now() - this._bugReporter.startTime,
            timestamp: new Date().toISOString()
          });

          if (window.__bugReporterLogs.networkErrors.length > MAX_LOGS) {
            window.__bugReporterLogs.networkErrors.shift();
          }
        }
      });
    }

    return originalXHRSend.apply(this, args);
  };

  // Log that we're capturing
  originalConsole.log('[Bug Reporter] Capturing console logs and network errors...');
})();
