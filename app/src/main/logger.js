const fs = require('fs');
const path = require('path');

const MAX_LINES = 1000; // Rolling buffer
const logBuffer = []; // In-memory ring buffer for IPC queries
let logFilePath = null;
let _mainWindowRef = null; // set by setWindow()

function setLogPath(appDataPath) {
  logFilePath = path.join(appDataPath, 'clawexpress.log');
}

function setWindow(win) {
  _mainWindowRef = win;
}

function _write(level, ...args) {
  const ts = new Date().toISOString();
  const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
  const line = `[${ts}] [${level}] ${text}`;

  // 1. In-memory buffer
  logBuffer.push(line);
  if (logBuffer.length > MAX_LINES) logBuffer.shift();

  // 2. Forward to renderer (non-blocking)
  try {
    if (_mainWindowRef && !_mainWindowRef.isDestroyed()) {
      _mainWindowRef.webContents.send('app-log', { level, text, ts });
    }
  } catch (_) {}

  // 3. Append to log file
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line + '\n');
    } catch (_) {}
  }

  // 4. Mirror to native console so Electron DevTools still works
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

const log = {
  info:  (...a) => _write('INFO',  ...a),
  warn:  (...a) => _write('WARN',  ...a),
  error: (...a) => _write('ERROR', ...a),
  debug: (...a) => _write('DEBUG', ...a),

  /** Return recent N lines for IPC query */
  recent: (n = 200) => logBuffer.slice(-n),

  setLogPath,
  setWindow,
};

module.exports = log;
