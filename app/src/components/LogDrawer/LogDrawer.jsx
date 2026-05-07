import React, { useRef, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Trash2, Download, Square, Play, Zap, ChevronDown, ChevronUp, Minus, Maximize2, Loader } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import EmbeddedTerminal from '../EmbeddedTerminal/EmbeddedTerminal';
import { getQuickActions } from '../../constants/quickActions';
import { getShellContainer } from '../../constants/getShellContainer';
import styles from './LogDrawer.module.css';

// Portal-based dropdown — bypasses overflow:hidden on shellWrapper/contentArea
const ContainerPicker = ({ containers, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [rect, setRect] = useState(null);

  const toggle = () => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} onClick={toggle} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 6,
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12,
      }}>
        {value}
        <ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>

      {open && rect && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
          minWidth: rect.width,
          zIndex: 9999,
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>
          {containers.map(c => (
            <div key={c} onMouseDown={() => { onChange(c); setOpen(false); }} style={{
              padding: '8px 12px', cursor: 'pointer', fontSize: 12,
              background: c === value ? 'var(--border)' : 'transparent',
              color: c === value ? '#fbbf24' : 'var(--text-primary)',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (c !== value) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = c === value ? 'var(--border)' : 'transparent'; }}
            >
              {c}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

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

const LogDrawer = ({ platform, onClose }) => {
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(platform?.status === 'RUNNING');
  const [shellKey, setShellKey] = useState(0);
  const [shellBin, setShellBin] = useState('/bin/bash');
  const [shellSize, setShellSize] = useState('normal');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [outputPanel, setOutputPanel] = useState({ visible: false, title: '', content: '', loading: false, size: 'normal' });
  const [composeContainers, setComposeContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState(null);

  const terminalRef = useRef(null);
  const actionsRef  = useRef(null);
  const { startPlatform, stopPlatform } = usePlatformStore();

  const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });
  const addLog = (text) => setLogs(prev => [...prev.slice(-499), { time: now(), text }]);

  const isDocker      = platform?.method === 'docker';
  const defaultContainer = getShellContainer(platform);
  const containerName = selectedContainer || defaultContainer;
  const quickActions  = getQuickActions(platform?.id);
  const showShell     = isDocker && isRunning;
  const showActions   = isDocker && quickActions.length > 0;

  // Auto-scroll log area
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  // IPC log listener
  useEffect(() => {
    if (!platform) return;
    addLog(`[SYSTEM] Log stream connected — ${platform.name}`);
    if (platform.status === 'RUNNING') addLog('[INFO] Process already running. Attaching to stdout...');

    const cleanup = window.electron?.ipcRenderer?.on('platform-log', ({ platformId, msg }) => {
      if (platformId === platform.id) addLog(msg);
    });
    return () => { if (cleanup) cleanup(); };
  }, []);

  // Fetch compose containers when shell becomes visible
  useEffect(() => {
    if (!showShell || !platform?.registryId) return;
    const projectName = `${platform.registryId}-clawexpress`;
    window.electron?.ipcRenderer.invoke('docker-list-containers', { projectName })
      .then(({ containers = [] }) => {
        setComposeContainers(containers);
        if (containers.length > 0 && !selectedContainer) {
          setSelectedContainer(containers.includes(defaultContainer) ? defaultContainer : containers[0]);
        }
      })
      .catch(() => {});
  }, [showShell, platform?.registryId]);

  // Close actions dropdown when clicking outside
  useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionsOpen]);

  const handleStart = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setShellKey(k => k + 1);
    setShellBin('/bin/bash');
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

  const handleShellExit = (code) => {
    // bash not available → retry with sh
    if (code === 127 && shellBin === '/bin/bash') {
      setShellBin('/bin/sh');
      setShellKey(k => k + 1);
    }
  };

  const handleQuickAction = async (action) => {
    setActionsOpen(false);
    setOutputPanel({ visible: true, title: action.label, content: '', loading: true, size: 'normal' });
    const result = await window.electron?.ipcRenderer.invoke('quick-action-exec', {
      platformId: platform.id,
      command: action.command,
      containerName,
      method: platform.method,
    });
    setOutputPanel(prev => ({ ...prev, loading: false, content: result?.output || '(no output)' }));
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

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.statusDot} style={{ backgroundColor: statusColor, boxShadow: isRunning ? '0 0 8px rgba(34,197,94,0.4)' : 'none' }} />
            <div>
              <div className={styles.platformName}>{platform?.name}</div>
              <div className={styles.platformMeta}>{platform?.version} · {platform?.method} · port {platform?.port || '—'}</div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        {/* ── Toolbar ── */}
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

        {/* ── Content area: log + shell overlay ── */}
        <div className={styles.contentArea}>
          <div className={styles.terminalWrapper}>
            <div className={styles.terminal} ref={terminalRef}>
              {logs.length === 0
                ? <span style={{ color: '#374151' }}>No output yet. Start the process to see logs.</span>
                : logs.map((entry, i) => <LogLine key={i} entry={entry} />)
              }
              {isRunning && <span className={styles.cursor} />}
            </div>

            {/* Floating output panel */}
            {outputPanel.visible && (
              <div className={`${styles.outputPanel} ${styles[`size_${outputPanel.size}`]}`}>
                <div className={styles.outputPanelHeader}>
                  <span className={styles.outputPanelTitle}>
                    <Zap size={11} style={{ marginRight: 5, color: '#f59e0b' }} />
                    {outputPanel.title}
                  </span>
                  <div className={styles.outputPanelControls}>
                    <button title="Minimize" className={styles.panelCtrlBtn} onClick={() => setOutputPanel(p => ({ ...p, size: p.size === 'min' ? 'normal' : 'min' }))}>
                      <Minus size={11} />
                    </button>
                    <button title="Maximize" className={styles.panelCtrlBtn} onClick={() => setOutputPanel(p => ({ ...p, size: p.size === 'max' ? 'normal' : 'max' }))}>
                      <Maximize2 size={11} />
                    </button>
                    <button title="Close" className={`${styles.panelCtrlBtn} ${styles.panelCtrlClose}`} onClick={() => setOutputPanel(p => ({ ...p, visible: false }))}>
                      <X size={11} />
                    </button>
                  </div>
                </div>
                {outputPanel.size !== 'min' && (
                  <div className={styles.outputPanelBody}>
                    {outputPanel.loading
                      ? <div className={styles.outputLoading}><Loader size={14} className={styles.spin} /> Running command...</div>
                      : <pre className={styles.outputContent}>{outputPanel.content}</pre>
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Shell (Docker + running only) ── */}
          {showShell && (
            <div className={`${styles.shellWrapper} ${styles[`shell_${shellSize}`]}`}>
              <div className={styles.shellLabel}>
                {composeContainers.length > 1 ? (
                  <ContainerPicker
                    containers={composeContainers}
                    value={selectedContainer || defaultContainer}
                    onChange={(val) => { setSelectedContainer(val); setShellKey(k => k + 1); setShellBin('/bin/bash'); }}
                  />
                ) : (
                  <span>shell · {containerName}</span>
                )}
                <div className={styles.shellControls}>
                  {/* x — trở về mặc định, chỉ hiện khi không ở normal */}
                  {shellSize !== 'normal' && (
                    <button className={styles.shellCtrlBtn} title="Return to default" onClick={() => setShellSize('normal')}>
                      <X size={11} />
                    </button>
                  )}
                  {/* v — thu về mặc định */}
                  <button className={styles.shellCtrlBtn} title="Default size" onClick={() => setShellSize('normal')}>
                    <ChevronDown size={12} />
                  </button>
                  {/* ^ — chiếm toàn bộ console */}
                  <button className={styles.shellCtrlBtn} title="Fill console" onClick={() => setShellSize('console')}>
                    <ChevronUp size={12} />
                  </button>
                  {/* <--> — 80% màn hình */}
                  <button className={styles.shellCtrlBtn} title="Fullscreen (80%)" onClick={() => setShellSize('fullscreen')}>
                    <Maximize2 size={11} />
                  </button>
                  {/* reconnect */}
                  <button className={`${styles.shellCtrlBtn} ${styles.shellCtrlSep}`} onClick={() => setShellKey(k => k + 1)} title="Reconnect">↺</button>
                </div>
              </div>
              <EmbeddedTerminal
                key={shellKey}
                id={`shell-${platform.id}`}
                command="docker"
                args={['exec', '-it', containerName, shellBin]}
                onExit={handleShellExit}
                style={{ minHeight: 0, height: '100%' }}
              />
            </div>
          )}
        </div>

        {/* ── Quick Actions bar — always visible for Docker platforms, disabled when stopped ── */}
        {showActions && (
          <div className={styles.actionsBar} ref={actionsRef}>
            <button
              className={styles.actionsBtn}
              disabled={!isRunning}
              onClick={() => isRunning && setActionsOpen(o => !o)}
            >
              <Zap size={11} />
              Quick Actions
              <ChevronDown size={10} style={{ transform: actionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>

            {actionsOpen && isRunning && (
              <div className={styles.actionsDropdown}>
                {quickActions.map(action => (
                  <button
                    key={action.id}
                    className={styles.actionItem}
                    onClick={() => handleQuickAction(action)}
                  >
                    <Zap size={10} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default LogDrawer;
