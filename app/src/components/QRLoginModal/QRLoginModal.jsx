import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, CheckCircle2, AlertTriangle, Loader2, RefreshCw, LogOut, Wifi } from 'lucide-react';
import styles from './QRLoginModal.module.css';
import EmbeddedTerminal from '../EmbeddedTerminal/EmbeddedTerminal';

const CHANNEL_META = {
  whatsapp: {
    label: 'WhatsApp',
    color: '#25D366',
    gradient: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
    icon: '💬',
    steps: [
      'Open WhatsApp on your phone',
      'Tap Menu (⋮) → Linked Devices',
      'Tap "Link a Device"',
      'Scan the QR code that appears',
    ],
  },
  zalouser: {
    label: 'Zalo Personal',
    color: '#0068FF',
    gradient: 'linear-gradient(135deg, #0068FF 0%, #0052CC 100%)',
    icon: '🇻🇳',
    steps: [
      'Open Zalo on your phone',
      'Tap your avatar → Settings',
      'Select "Zalo Web" or "Scan QR Code"',
      'Scan the QR code that appears',
    ],
  },
};

const STATUS = { IDLE: 'idle', LOADING: 'loading', QR: 'qr', ASCII_QR: 'ascii_qr', TERMINAL: 'terminal', SUCCESS: 'success', ERROR: 'error' };

export default function QRLoginModal({ channel, platformId, platformConfig, onClose, onConnected }) {
  const meta = CHANNEL_META[channel] || CHANNEL_META.whatsapp;
  const canvasRef = useRef(null);
  const logEndRef = useRef(null);
  const cleanupRef = useRef(null);
  const mountedRef = useRef(true);
  const timeoutRef = useRef(null);

  const [status, setStatus] = useState(STATUS.LOADING);
  const [logs, setLogs] = useState([]);
  const [qrData, setQrData] = useState(null);
  const [qrImageUrl, setQrImageUrl] = useState(null);
  const [asciiQr, setAsciiQr] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [gatewayWasStopped, setGatewayWasStopped] = useState(false);
  const [needsGatewayRestart, setNeedsGatewayRestart] = useState(false);
  const [terminalPlatform, setTerminalPlatform] = useState(null); // { platformId, platformConfig }
  const expiryRef = useRef(null);

  const safe = (fn) => (...args) => { if (mountedRef.current) fn(...args); };

  const addLog = (line) => safe(setLogs)(prev => [...prev.slice(-60), line]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Draw QR onto canvas
  const drawQR = useCallback(async (data) => {
    if (!data || !canvasRef.current) return;
    try {
      const QRCode = (await import('qrcode')).default;
      await QRCode.toCanvas(canvasRef.current, data, {
        width: 200, margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (err) {
      console.warn('[QR] Canvas render failed:', err.message);
    }
  }, []);

  useEffect(() => {
    if (qrData) drawQR(qrData);
  }, [qrData, drawQR]);

  // Countdown timer
  useEffect(() => {
    if (!expiryRef.current || status !== STATUS.QR) return;
    const tick = () => {
      const s = Math.max(0, Math.round((expiryRef.current - Date.now()) / 1000));
      safe(setSecondsLeft)(s);
      if (s === 0 && mountedRef.current) {
        safe(setStatus)(STATUS.ERROR);
        safe(setErrorMsg)('QR code expired. Click "Try Again" to refresh.');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

  // No-response timeout — if nothing useful after 30s, show hint
  const startNoResponseTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (mountedRef.current && (status === STATUS.LOADING || status === STATUS.IDLE)) {
        addLog('⚠ Still waiting for QR… OpenClaw may need a moment to load the plugin.');
      }
    }, 30000);
  };

  const startLogin = useCallback(async () => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    safe(setStatus)(STATUS.LOADING);
    safe(setQrData)(null);
    safe(setQrImageUrl)(null);
    safe(setAsciiQr)(null);
    safe(setErrorMsg)('');
    safe(setLogs)([`Starting ${meta.label} login…`]);
    expiryRef.current = null;
    safe(setSecondsLeft)(null);

    startNoResponseTimeout();

    const cleanup = window.electron?.ipcRenderer.on('channel-login-event', (ev) => {
      if (!mountedRef.current) return;
      if (ev.channel !== channel) return;

      switch (ev.type) {
        case 'started':
          break;

        case 'log':
          if (!/google failed to load|Maximum call stack|NativeCommandError|CategoryInfo|FullyQualified|openclaw\.ps1/i.test(ev.line)) {
            addLog(ev.line);
          }
          break;

        case 'terminal-opened':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setTerminalPlatform)({
            platformId: ev.platformId,
            platformConfig: ev.platformConfig,
            command: ev.command || 'openclaw',
            args: ev.args || ['channels', 'login', '--channel', channel],
            env: ev.env || {},
          });
          safe(setStatus)(STATUS.TERMINAL);
          break;

        case 'gateway-required':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setErrorMsg)('OpenClaw is not running. Please start it first, then try again.');
          safe(setStatus)(STATUS.ERROR);
          break;

        case 'plugin-unavailable':
          // Handled server-side now (whatsapp uses standalone CLI, no longer via gateway RPC).
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setErrorMsg)('WhatsApp plugin not available. The gateway will restart automatically — please try again in a moment.');
          safe(setStatus)(STATUS.ERROR);
          break;

        case 'qr-image':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setQrImageUrl)(ev.dataUrl);
          safe(setStatus)(STATUS.QR);
          // Increase UI timeout to 180s to allow backend to refresh QR silently
          expiryRef.current = Date.now() + 180_000;
          break;

        case 'qr':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setQrData)(ev.data);
          safe(setStatus)(STATUS.QR);
          expiryRef.current = Date.now() + 180_000;
          break;

        case 'ascii-qr':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setAsciiQr)(ev.ascii);
          safe(setStatus)(STATUS.ASCII_QR);
          expiryRef.current = Date.now() + 180_000;
          addLog('QR code displayed below — scan with your phone.');
          break;

        case 'success':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setStatus)(STATUS.SUCCESS);
          if (onConnected) onConnected(channel);
          // Restart gateway after successful link (mirroring WhatsApp)
          if (platformId && platformConfig) {
            setTimeout(() => {
              window.electron?.ipcRenderer.invoke('platform-start', { platformId, config: platformConfig });
              onClose();
            }, 3000);
          } else {
            setTimeout(() => onClose(), 3000);
          }
          break;

        case 'error':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          safe(setErrorMsg)(ev.message || 'An error occurred');
          safe(setStatus)(STATUS.ERROR);
          break;

        case 'close':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          if (ev.code !== 0) {
            safe(setStatus)(s => (s === STATUS.QR || s === STATUS.ASCII_QR || s === STATUS.SUCCESS) ? s : STATUS.ERROR);
            safe(setErrorMsg)(prev => prev || `Process exited with code ${ev.code}`);
          }
          break;

        default: break;
      }
    });

    cleanupRef.current = cleanup || null;

    try {
      await window.electron?.ipcRenderer.invoke('channel-login', {
        channel,
        platformId: platformId || undefined,
        platformConfig: platformConfig || undefined,
      });
    } catch (err) {
      safe(setErrorMsg)(`Failed to start: ${err?.message || err}`);
      safe(setStatus)(STATUS.ERROR);
    }
  }, [channel, onConnected, platformId]);

  useEffect(() => {
    mountedRef.current = true;
    startLogin();
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.electron?.ipcRenderer.invoke('channel-login-cancel', { channel });
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = async () => {
    await window.electron?.ipcRenderer.invoke('channel-logout', { channel });
    safe(setStatus)(STATUS.IDLE);
    safe(setQrData)(null);
    safe(setAsciiQr)(null);
    safe(setNeedsGatewayRestart)(false);
    addLog('Disconnected.');
  };

  const handleRestartGateway = async () => {
    if (!platformId) { onClose(); return; }
    await window.electron?.ipcRenderer.invoke('platform-stop', { platformId, method: platformConfig?.method });
    setTimeout(async () => {
        await window.electron?.ipcRenderer.invoke('platform-start', { platformId, config: platformConfig });
        safe(setNeedsGatewayRestart)(false);
        onClose();
    }, 1000);
  };

  const isQrVisible = status === STATUS.QR || status === STATUS.ASCII_QR;
  const isWhatsapp = channel === 'whatsapp';
  const isZalo = channel === 'zalouser';
  const isTerminal = status === STATUS.TERMINAL || isWhatsapp || (isZalo && status === STATUS.LOADING);

  return (
    <div className={styles.overlay} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.modal} ${isTerminal ? styles.modalTerminal : ''}`}>

        {/* ── Header ── */}
        <div className={styles.header} style={{ '--ch-color': meta.color, '--ch-gradient': meta.gradient }}>
          <div className={styles.headerContent}>
            <div className={styles.channelIcon}>{meta.icon}</div>
            <div>
              <div className={styles.channelName}>{meta.label}</div>
              <div className={styles.channelSubtitle}>
                {status === STATUS.LOADING && 'Initializing…'}
                {status === STATUS.QR && 'Scan QR code with your phone'}
                {status === STATUS.ASCII_QR && 'Scan QR code with your phone'}
                {status === STATUS.TERMINAL && 'Scan the QR code below'}
                {status === STATUS.SUCCESS && 'Successfully connected!'}
                {status === STATUS.ERROR && 'Connection failed'}
                {status === STATUS.IDLE && 'Ready to connect'}
              </div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        {/* ── Body ── */}
        <div className={styles.body}>

          {/* Left: QR Frame */}
          <div className={styles.bodyInner} style={{ flexDirection: isTerminal ? 'column' : 'row' }}>
          <div className={isTerminal ? styles.qrPanelFull : styles.qrPanel}>
            <div className={isTerminal ? styles.qrFrameFull : styles.qrFrame} style={{ '--ch-color': meta.color }}>

              {status === STATUS.LOADING && (isZalo ? (
                  <div style={{ textAlign: 'left', alignSelf: 'flex-start', padding: '20px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: meta.color }}>
                      <Loader2 size={24} className={styles.spinner} />
                      <span style={{ fontWeight: 600 }}>Initializing Zalo Session (this may take up to 60s)...</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'monospace', fontSize: '12px', color: '#a3a3a3', height: '350px', overflowY: 'auto', background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: '8px' }}>
                      {logs.map((L, i) => <div key={i}>{L}</div>)}
                      <div ref={logEndRef} />
                    </div>
                  </div>
              ) : (
                <div className={styles.qrState}>
                  <Loader2 size={34} className={styles.spinner} style={{ color: meta.color }} />
                  <p>Generating QR…</p>
                </div>
              ))}

              {status === STATUS.QR && (
                <div className={styles.qrCanvasWrap} style={isZalo ? { background: '#fff', padding: '16px', borderRadius: '16px' } : {}}>
                  {qrImageUrl
                    ? <img src={qrImageUrl} alt="QR Code" style={{ width: 220, height: 220, display: 'block' }} />
                    : <canvas ref={canvasRef} className={styles.qrCanvas} />
                  }
                  {secondsLeft !== null && (
                    <div className={styles.countdown} style={{ color: secondsLeft < 15 ? '#ef4444' : meta.color, marginTop: '12px', textAlign: 'center', fontWeight: 'bold' }}>
                      Expires in {secondsLeft}s
                    </div>
                  )}
                </div>
              )}

              {status === STATUS.ASCII_QR && asciiQr && (
                <div className={styles.asciiWrap}>
                  <pre className={styles.asciiQr}>{asciiQr}</pre>
                  {secondsLeft !== null && (
                    <div className={styles.countdown} style={{ color: secondsLeft < 15 ? '#ef4444' : '#333' }}>
                      Expires in {secondsLeft}s
                    </div>
                  )}
                </div>
              )}

              {(status === STATUS.TERMINAL || (status === STATUS.QR && terminalPlatform)) && terminalPlatform && (
                <div style={{ display: status === STATUS.TERMINAL ? 'flex' : 'none', flexDirection: 'column', width: '100%', height: '100%' }}>
                  <div style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                       <Loader2 size={16} className={styles.spinner} style={{ color: meta.color }} />
                       <span style={{ color: '#fff', fontSize: '13px', fontWeight: 500 }}>Initializing {meta.label} Connection...</span>
                       <span style={{ color: '#888', fontSize: '12px', marginLeft: 'auto' }}>Please wait (usually 1-2 mins)</span>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: '#a3a3a3' }}>
                       {meta.steps.map((step, idx) => (
                         <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                           <span style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600 }}>{idx + 1}</span>
                           <span>{step}</span>
                         </div>
                       ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <EmbeddedTerminal
                      id="wa-login"
                      command={terminalPlatform.command}
                      args={terminalPlatform.args}
                      env={terminalPlatform.env}
                      onExit={async (code) => {
                        if (!mountedRef.current) return;
                        if (code === 0) {
                          safe(setStatus)(STATUS.SUCCESS);
                          if (onConnected) onConnected(channel);
                          await window.electron?.ipcRenderer.invoke('channel-login-success', { channel });

                          if (terminalPlatform.platformId && terminalPlatform.platformConfig) {
                            setTimeout(() => {
                              window.electron?.ipcRenderer.invoke('platform-start', {
                                platformId: terminalPlatform.platformId,
                                config: terminalPlatform.platformConfig,
                              });
                              onClose();
                            }, 2000);
                          } else {
                            setTimeout(() => onClose(), 2000);
                          }
                        } else {
                          safe(setStatus)(STATUS.ERROR);
                          safe(setErrorMsg)(`Process exited with code ${code}. Click "Try Again".`);
                        }
                      }}
                      termOptions={{ fontSize: 11, lineHeight: 1.15 }}
                      style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 0, paddingLeft: '8px' }}
                    />
                  </div>
                </div>
              )}

              {status === STATUS.SUCCESS && (
                <div className={styles.qrState} style={isZalo ? { margin: 'auto' } : {}}>
                  <CheckCircle2 size={48} color="#22c55e" />
                  <p className={styles.successText}>Connected!</p>
                </div>
              )}

              {status === STATUS.ERROR && (
                <div className={styles.qrState} style={isZalo ? { margin: 'auto' } : {}}>
                  <AlertTriangle size={34} color="#ef4444" />
                  <p className={styles.errorText}>{errorMsg || 'Something went wrong'}</p>
                  <button className={styles.retryBtn} style={{ background: meta.color }} onClick={startLogin}>
                    <RefreshCw size={13} /> Try Again
                  </button>
                </div>
              )}

              {status === STATUS.IDLE && (
                <div className={styles.qrState} style={isZalo ? { margin: 'auto' } : {}}>
                  <Wifi size={34} style={{ color: meta.color }} />
                  <p>Click "Start" to begin</p>
                  <button className={styles.retryBtn} style={{ background: meta.color }} onClick={startLogin}>
                    Start
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Steps + Log (Hidden if Terminal) */}
          {!isTerminal && (
            <div className={styles.infoPanel}>
              <div className={styles.steps}>
                <div className={styles.stepsTitle}>How to connect</div>
                {meta.steps.map((step, i) => (
                  <div key={i} className={styles.step}>
                    <div className={styles.stepNum} style={{ background: meta.color }}>{i + 1}</div>
                    <div className={styles.stepText}>{step}</div>
                  </div>
                ))}
              </div>

              <div className={styles.actions}>
                {status === STATUS.LOADING && (
                  <button className={styles.cancelBtn} onClick={async () => {
                    await window.electron?.ipcRenderer.invoke('channel-login-cancel', { channel });
                    safe(setStatus)(STATUS.IDLE);
                  }}>
                    Cancel
                  </button>
                )}
                {isQrVisible && (
                  <button className={styles.logoutBtn} onClick={handleDisconnect}>
                    <LogOut size={13} /> Disconnect
                  </button>
                )}
                {isQrVisible && (
                  <button className={styles.retrySmallBtn} style={{ borderColor: meta.color, color: meta.color }} onClick={startLogin}>
                    <RefreshCw size={12} /> Refresh QR
                  </button>
                )}
                {status === STATUS.SUCCESS && (
                  <button className={styles.doneBtn} style={{ background: meta.color }} onClick={onClose}>
                    Done
                  </button>
                )}
              </div>
            </div>
          )}
          
          {isTerminal && (
            <div style={{ display: 'flex', padding: '16px', background: 'var(--sidebar-bg, #141414)', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', gap: '8px' }}>
               {status === STATUS.ERROR && (
                  <button className={styles.retrySmallBtn} style={{ borderColor: meta.color, color: meta.color }} onClick={startLogin}>
                    <RefreshCw size={12} /> Try Again
                  </button>
               )}
               {status === STATUS.SUCCESS ? (
                 <button className={styles.doneBtn} style={{ background: meta.color }} onClick={onClose}>
                    Done
                 </button>
               ) : (
                 <button className={styles.cancelBtn} onClick={async () => {
                    if (status === STATUS.TERMINAL) {
                       await window.electron?.ipcRenderer.invoke('pty-kill', { id: 'wa-login' });
                    } else if (status === STATUS.LOADING) {
                       await window.electron?.ipcRenderer.invoke('channel-login-cancel', { channel });
                    }
                    safe(setStatus)(STATUS.IDLE);
                    onClose();
                 }}>
                    Cancel & Close
                 </button>
               )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
