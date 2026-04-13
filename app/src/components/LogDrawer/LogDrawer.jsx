import React, { useRef, useEffect, useState } from 'react';
import { X, Trash2, Download, Square, Play } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import styles from './LogDrawer.module.css';

const LOG_LEVELS = {
  INFO: 'logInfo',
  SUCCESS: 'logSuccess',
  WARN: 'logWarn',
  ERROR: 'logError',
  SYSTEM: 'logSystem',
};

const parseLogLevel = (text) => {
  if (/error|fail|crash/i.test(text)) return 'ERROR';
  if (/warn|deprecated/i.test(text)) return 'WARN';
  if (/success|ready|started|listening/i.test(text)) return 'SUCCESS';
  if (/\[system\]|\[ipc\]/i.test(text)) return 'SYSTEM';
  return 'INFO';
};

const LogLine = ({ entry }) => {
  const level = parseLogLevel(entry.text);
  return (
    <div className={styles.logLine}>
      <span className={styles.logTime}>{entry.time}</span>
      <span className={`${styles.logText} ${styles[LOG_LEVELS[level]]}`}>{entry.text}</span>
    </div>
  );
};

const MOCK_BOOT_SEQUENCE = (platformName, method) => [
  { text: `[SYSTEM] Initializing ${platformName}...`, delay: 0 },
  { text: `[SYSTEM] Runtime: ${method === 'docker' ? 'Docker container' : 'Node.js process'}`, delay: 300 },
  { text: `[INFO] Loading configuration...`, delay: 700 },
  { text: `[INFO] Checking port availability...`, delay: 1100 },
  { text: `[SUCCESS] Port 3030 is available`, delay: 1500 },
  { text: `[INFO] Starting gateway server...`, delay: 2000 },
  { text: `[SUCCESS] ${platformName} is listening on port 3030`, delay: 2600 },
  { text: `[INFO] Waiting for incoming connections...`, delay: 3000 },
];

const LogDrawer = ({ platform, onClose }) => {
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(platform?.status === 'RUNNING');
  const terminalRef = useRef(null);
  const { startPlatform, stopPlatform } = usePlatformStore();

  const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });

  const addLog = (text) => {
    setLogs(prev => [...prev, { time: now(), text }]);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Simulate boot sequence when opened and platform is running
  useEffect(() => {
    if (!platform) return;

    addLog(`[SYSTEM] Log stream connected — ${platform.name}`);

    if (platform.status === 'RUNNING') {
      addLog('[INFO] Process already running. Attaching to stdout...');
      setTimeout(() => addLog('[INFO] Waiting for incoming connections...'), 500);
    }

    // Listen to real IPC logs from main process
    let cleanup;
    if (window.electron?.ipcRenderer?.on) {
      cleanup = window.electron.ipcRenderer.on('platform-log', ({ platformId, msg }) => {
        if (platformId === platform.id) addLog(msg);
      });
    }
    return () => { if (cleanup) cleanup(); };
  }, []);

  const handleStart = async () => {
    if (isRunning) return;
    setIsRunning(true);
    addLog(`[SYSTEM] Starting ${platform.name}...`);
    await startPlatform(platform.id);
  };

  const handleStop = async () => {
    if (!isRunning) return;
    setIsRunning(false);
    addLog(`[WARN] Stopping ${platform.name}...`);
    await stopPlatform(platform.id);
    addLog('[SYSTEM] Process terminated.');
  };

  const handleClear = () => setLogs([]);

  const handleDownload = () => {
    const content = logs.map(l => `${l.time}  ${l.text}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${platform?.id}-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = isRunning ? '#22c55e' : '#525252';

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.statusDot} style={{ backgroundColor: statusColor, boxShadow: isRunning ? `0 0 8px rgba(34,197,94,0.4)` : 'none' }} />
            <div>
              <div className={styles.platformName}>{platform?.name}</div>
              <div className={styles.platformMeta}>{platform?.version} · {platform?.method} · port {platform?.port || '—'}</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        <div className={styles.toolbar}>
          {isRunning ? (
            <button className={`${styles.toolBtn} ${styles.toolBtnDanger}`} onClick={handleStop}>
              <Square size={12} /> Stop Process
            </button>
          ) : (
            <button className={`${styles.toolBtn} ${styles.toolBtnSuccess}`} onClick={handleStart}>
              <Play size={12} /> Start Process
            </button>
          )}
          <button className={styles.toolBtn} onClick={handleClear}><Trash2 size={12} /> Clear</button>
          <button className={styles.toolBtn} onClick={handleDownload}><Download size={12} /> Export</button>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            {logs.length} lines
          </span>
        </div>

        <div className={styles.terminal} ref={terminalRef}>
          {logs.length === 0 ? (
            <span style={{ color: '#374151' }}>No output yet. Start the process to see logs.</span>
          ) : (
            logs.map((entry, i) => <LogLine key={i} entry={entry} />)
          )}
          {isRunning && <span className={styles.cursor} />}
        </div>

        <div className={styles.footer}>
          <span className={styles.prompt}>$</span>
          <input
            className={styles.input}
            placeholder="Send command to process..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                const cmd = e.target.value.trim();
                addLog(`$ ${cmd}`);
                window.electron?.ipcRenderer.invoke('platform-send-input', { platformId: platform.id, input: cmd });
                e.target.value = '';
              }
            }}
          />
        </div>
      </div>
    </>
  );
};

export default LogDrawer;
