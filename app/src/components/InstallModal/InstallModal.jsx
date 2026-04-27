import React, { useState, useEffect, useRef } from 'react';
import { X, Box, CheckCircle, Terminal, AlertCircle, Loader2 } from 'lucide-react';
import styles from './InstallModal.module.css';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useConnectionStore } from '../../store/useConnectionStore';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import Dropdown from '../Dropdown/Dropdown';
import { useRequireAuth } from '../../hooks/useRequireAuth';

const DockerLogo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#2496ED" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z" />
  </svg>
);

const NpmLogo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#CB3837" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
  </svg>
);

const ConnectionPicker = ({ value, onChange }) => {
  const { connections, loadConnections } = useConnectionStore();
  const [liveConnections, setLiveConnections] = useState([]);
  const [checking, setChecking] = useState(true);
  const [selectedConnectionId, setSelectedConnectionId] = useState(value?.connectionId || '');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(value?.model || '');

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    let active = true;
    const checkLive = async () => {
      setChecking(true);
      const enabledConns = connections.filter(c => c.enabled !== false);
      const promises = enabledConns.map(async (c) => {
        if (c.category === 'cli') return c;
        try {
          const res = await window.electron?.ipcRenderer.invoke('verify-api-key', {
             providerId: c.providerId,
             apiKey: c.apiKey,
             baseUrl: c.baseUrl
          });
          if (res?.valid) return c;
          return null;
        } catch {
          return null;
        }
      });
      const results = await Promise.all(promises);
      const valids = results.filter(Boolean);
      if (active) {
        setLiveConnections(valids);
        setChecking(false);
      }
    };
    if (connections.length > 0) {
      checkLive();
    } else {
      setLiveConnections([]);
      setChecking(false);
    }
    return () => { active = false; };
  }, [connections]);

  useEffect(() => {
    if (!checking && !selectedConnectionId && liveConnections.length > 0) {
      setSelectedConnectionId(liveConnections[0].id);
    }
  }, [liveConnections, checking]);

  useEffect(() => {
    const conn = liveConnections.find(c => c.id === selectedConnectionId);
    if (conn) {
      const isCli = conn.category === 'cli';
      const provider = PROVIDERS.find(p => p.id === conn.providerId);
      const connModels = isCli ? (provider?.models || []) : (conn.models || []);
      
      setModels(connModels);
      if (connModels.length > 0 && !connModels.includes(selectedModel)) {
        setSelectedModel(connModels[0]);
      } else if (!connModels.length) {
        setSelectedModel('');
      }
    }
  }, [selectedConnectionId, liveConnections]);

  useEffect(() => {
    if (selectedConnectionId && selectedModel) {
      const conn = liveConnections.find(c => c.id === selectedConnectionId);
      if (conn) {
        onChange({ 
          connectionId: conn.id, 
          provider: conn.providerId, 
          key: conn.apiKey, 
          baseUrl: conn.baseUrl,
          model: selectedModel,
          oauthTokens: conn.oauthTokens
        });
      }
    }
  }, [selectedConnectionId, selectedModel, liveConnections]);

  if (checking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', background: 'var(--app-bg)', borderRadius: '6px', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}>
        <Loader2 size={16} className={styles.spin} /> 
        <div>Pinging connections to find live endpoints...</div>
      </div>
    );
  }

  if (liveConnections.length === 0) {
    return (
      <div style={{ background: 'rgba(250,204,21,0.1)', border: '1px solid #facc15', padding: '12px', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px' }}>
        No successful active Connections found in your Vault. Ensure your proxy endpoints (like LM Studio) are online and try again.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
      <Dropdown
        value={selectedConnectionId}
        options={[
          ...liveConnections.map(c => {
             const p = PROVIDERS.find(p => p.id === c.providerId);
             return { value: c.id, label: `${c.name} (${p?.label || 'Unknown'})` };
          }),
          ...(selectedConnectionId && !liveConnections.some(c => c.id === selectedConnectionId)
                ? [{ value: selectedConnectionId, label: 'Unknown Connection (Offline/Deleted)' }]
                : [])
        ]}
        onChange={setSelectedConnectionId}
        minWidth="250px"
      />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Model</span>
        {models.length > 0 ? (
          <Dropdown
            value={selectedModel}
            options={models}
            onChange={setSelectedModel}
            minWidth="250px"
          />
        ) : (
          <input 
            value={selectedModel} 
            onChange={e => setSelectedModel(e.target.value)} 
            placeholder="Type custom model name..."
            style={{ width: '250px', padding: '6px 10px', background: 'var(--app-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px' }}
          />
        )}
      </div>
    </div>
  );
};

const InstallModal = ({ isOpen, onClose, platform, onInstalled }) => {
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState(''); // 'npm' | 'docker'
  const [logs, setLogs] = useState([]);
  const [installing, setInstalling] = useState(false);
  const [preflightState, setPreflightState] = useState({ checking: false, checks: [], isSuccess: false });
  const [config, setConfig] = useState({});
  const { addPlatform } = usePlatformStore();
  const requireAuth = useRequireAuth();
  const terminalRef = useRef(null);

  const hasDocker = platform?.installScript?.docker !== undefined || platform?.startScript?.docker !== undefined || platform?.method === 'docker' || platform?.method?.includes('docker');
  const hasNpm = platform?.installScript?.npm !== undefined || platform?.startScript?.npm !== undefined || platform?.method === 'npm' || platform?.method?.includes('npm');

  useEffect(() => {
    if (!isOpen) {
      setStep(1); setLogs([]); setInstalling(false); setMethod(''); setPreflightState({ checking: false, checks: [], isSuccess: false });
    } else if (platform) {
      if (hasDocker && !hasNpm) setMethod('docker');
      else if (hasNpm && !hasDocker) setMethod('npm');
      else setMethod('');

      if (platform.configSchema) {
        const initialConfig = {};
        platform.configSchema.forEach(field => {
          initialConfig[field.id] = field.default !== undefined ? field.default : (field.type === 'checkbox-group' ? [] : '');
        });
        setConfig(initialConfig);
      } else {
        setConfig({});
      }
    }
  }, [isOpen, platform, hasDocker, hasNpm]);

  useEffect(() => {
    if (step === 2 && isOpen && method) {
      runPreflightCheck();
    }
  }, [step, isOpen, method]);

  const runPreflightCheck = async () => {
    setPreflightState({ checking: true, checks: [], isSuccess: false });
    const port = platform?.port || 18789;
    try {
      const res = await window.electron?.ipcRenderer.invoke('platform-preflight-check', { method, port });
      if (res) {
        setPreflightState({ checking: false, checks: res.checks || [], isSuccess: res.success });
      } else {
        setPreflightState({ checking: false, checks: [{ id: 'sys', status: 'error', text: 'Failed to communicate with backend loader.' }], isSuccess: false });
      }
    } catch (e) {
      setPreflightState({ checking: false, checks: [{ id: 'sys', status: 'error', text: e.message }], isSuccess: false });
    }
  };

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!platform || !installing) return;
    const cleanup = window.electron?.ipcRenderer.on('platform-log', ({ platformId, msg }) => {
      if (platformId === `install-${platform.id}`) {
        setLogs(prev => {
          const next = [...prev, msg];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
      }
    });
    return cleanup;
  }, [platform, installing]);

  useEffect(() => {
    if (terminalRef.current && step === 4) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, step]);

  if (!isOpen) return null;

  const handleNext = () => setStep(s => Math.min(s + 1, 5));
  const handleBack = () => setStep(s => Math.max(s - 1, 1));

  const startInstall = async () => {
    setStep(4);
    setInstalling(true);
    setLogs(['[SYSTEM] Initializing installation sequence...']);

    const installScript = platform?.installScript?.[method];
    
    // Inject the selected connection base url if needed by backend compile logic
    const finalConfigObj = { ...config };
    
    const result = await window.electron?.ipcRenderer.invoke('platform-install', {
      platformId: platform.id,
      method: method,
      config: finalConfigObj,
      configMapping: platform?.configMapping,
      installScript: installScript
    });

    setInstalling(false);

    if (result?.success) {
      setStep(5);
      
      const llm = config.llm_config || {};
      const providerObj = PROVIDERS.find(p => p.id === llm.provider);
      
      const platformEnv = {};
      if (providerObj && providerObj.category !== PROVIDER_CATEGORIES.CLI) {
        if (llm.key) platformEnv[providerObj.envKey] = llm.key;
        if (llm.baseUrl) {
          const baseUrlKey = providerObj.envKey.replace(/(_API_KEY|_TOKEN|_KEY)$/, '_BASE_URL');
          platformEnv[baseUrlKey] = llm.baseUrl;
        }
      }
      
      if (llm.connectionId && llm.provider) {
        platformEnv['CLAWEXPRESS_CONNECTION_ID'] = llm.connectionId;
        platformEnv['CLAWEXPRESS_PROVIDER'] = llm.provider;
      }

      // Automatically map any config fields that define 'envVar' to the environment
      if (platform.configSchema) {
        platform.configSchema.forEach(field => {
          if (field.envVar && config[field.id]) {
            platformEnv[field.envVar] = config[field.id];
          }
        });
      }

      addPlatform({
        id: Math.random().toString(36).substring(2, 9), // Use a unique ID for multiple instances
        registryId: platform.id,
        name: platform.name,
        version: platform.version || 'v1.0.0',
        method: method,
        status: 'STOPPED',
        port: platform.port || 18789,
        env: platformEnv,
        cwd: result.cwd || null,
        container: method === 'docker' ? `${platform.id}-clawexpress-${Math.random().toString(36).substring(2, 6)}` : null,
        startScript: platform?.startScript?.[method] || null,
        uptime: null
      });
    } else {
      setLogs(l => [...l, `[ERROR] Installation failed: ${result?.reason || 'Unknown logic'}`]);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Install: {platform?.name || 'New Platform'}</div>
          <button className={styles.closeBtn} onClick={onClose} disabled={installing}><X size={18} /></button>
        </div>

        <div className={styles.body} style={{ overflowY: step === 3 ? 'visible' : 'auto' }}>
          <div className={styles.stepper}>
            <div className={`${styles.stepDot} ${step >= 1 ? styles.active : ''}`} />
            <div className={`${styles.stepDot} ${step >= 2 ? styles.active : ''}`} />
            <div className={`${styles.stepDot} ${step >= 3 ? styles.active : ''}`} />
            <div className={`${styles.stepDot} ${step >= 4 ? styles.active : ''}`} />
            <div className={`${styles.stepDot} ${step >= 5 ? styles.active : ''}`} />
          </div>

          {step === 1 && (
            <div>
              <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Select Installation Method</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>Choose how ClawExpress should manage {platform?.name}.</p>
              
              <div className={styles.methodGrid}>
                <div 
                  className={`${styles.methodCard} ${method === 'docker' ? styles.selected : ''}`} 
                  onClick={() => hasDocker && setMethod('docker')}
                  style={!hasDocker ? { opacity: 0.4, cursor: 'not-allowed', filter: 'grayscale(1)' } : {}}
                >
                  <div style={{ marginBottom: '12px', display: 'flex' }}><DockerLogo size={28} /></div>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>Docker / Podman</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Isolated container. Best for stability and uninstalls. Requires Docker Desktop.</div>
                  {!hasDocker && <div style={{ fontSize: '11px', color: 'var(--status-error)', marginTop: '8px', fontWeight: 500 }}>Not supported by {platform?.name}</div>}
                </div>
                <div 
                  className={`${styles.methodCard} ${method === 'npm' ? styles.selected : ''}`} 
                  onClick={() => hasNpm && setMethod('npm')}
                  style={!hasNpm ? { opacity: 0.4, cursor: 'not-allowed', filter: 'grayscale(1)' } : {}}
                >
                  <div style={{ marginBottom: '12px', display: 'flex' }}><NpmLogo size={28} /></div>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>NPM (Node)</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Runs natively on your host OS. Faster, but requires Node.js globals.</div>
                  {!hasNpm && <div style={{ fontSize: '11px', color: 'var(--status-error)', marginTop: '8px', fontWeight: 500 }}>Not supported by {platform?.name}</div>}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Pre-flight Check</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>Verifying your system capabilities.</p>
              
              <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '16px' }}>
                {preflightState.checking ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0', gap: '12px' }}>
                    <Loader2 className={styles.spin} size={24} color="var(--text-secondary)" />
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Checking system environment...</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {preflightState.checks.map((chk, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: chk.status === 'success' ? 'var(--status-running)' : 'var(--status-error)', fontSize: '13px' }}>
                        {chk.status === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                        {chk.text}
                      </div>
                    ))}
                    {preflightState.checks.length === 0 && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No checks performed.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ minHeight: '300px' }}>
              {/* Headings removed for cleaner UI */}
              
              {!platform?.configSchema ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>No additional configuration required for this platform.</div>
              ) : (
                platform.configSchema.filter(field => field.id !== 'channels' && field.id !== 'telegram_token').map(field => {
                  if (field.dependsOn) {
                    const depObj = field.dependsOn;
                    const depVal = config[depObj.field];
                    if (depObj.hideWhen && depVal === depObj.hideWhen) return null;
                    if (depObj.contains && Array.isArray(depVal) && !depVal.includes(depObj.contains)) return null;
                  }

                  return (
                    <div key={field.id} style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{field.label}</label>
                      {field.description && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>{field.description}</div>}
                      
                      {field.type === 'llm-key-picker' && (
                        <ConnectionPicker value={config[field.id]} onChange={val => setConfig({ ...config, [field.id]: val })} />
                      )}
                      
                      {field.type === 'select' && (
                        <div style={{ width: '100%' }}>
                          <Dropdown
                            value={config[field.id] || (field.options[0]?.value || '')}
                            options={field.options}
                            onChange={val => setConfig({ ...config, [field.id]: val })}
                            minWidth="100%"
                          />
                        </div>
                      )}

                      {(field.type === 'password' || field.type === 'text') && (
                        <input 
                          type={field.type} 
                          placeholder={field.placeholder || ''}
                          value={config[field.id] || ''}
                          onChange={e => setConfig({ ...config, [field.id]: e.target.value })}
                          style={{ width: '100%', padding: '8px 12px', background: 'var(--app-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px' }}
                        />
                      )}

                      {field.type === 'checkbox-group' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {field.options.map(opt => {
                            const isChecked = Array.isArray(config[field.id]) && config[field.id].includes(opt.value);
                            return (
                              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                                <input 
                                  type="checkbox" 
                                  checked={isChecked} 
                                  onChange={e => {
                                    const curr = Array.isArray(config[field.id]) ? [...config[field.id]] : [];
                                    if (e.target.checked) curr.push(opt.value);
                                    else curr.splice(curr.indexOf(opt.value), 1);
                                    setConfig({ ...config, [field.id]: curr });
                                  }} 
                                />
                                {opt.label}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 style={{ fontSize: '16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Installing {installing && <Loader2 size={16} className={styles.spin} />}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>Do not close this window or disconnect from the internet.</p>
              
              <div className={styles.terminal} ref={terminalRef}>
                {logs.map((log, i) => (
                  <div key={i} style={{ color: log.includes('WARN') ? '#f59e0b' : log.includes('SUCCESS') ? '#22c55e' : log.includes('ERROR') ? '#ef4444' : 'inherit' }}>
                    {log}
                  </div>
                ))}
                {installing && <div style={{ animation: 'pulse 1s infinite' }}>_</div>}
                {!installing && logs.length > 0 && !logs.some(l => l.includes('SUCCESS')) && (
                  <div style={{ color: '#ef4444', marginTop: '10px' }}>Process halted.</div>
                )}
              </div>
            </div>
          )}

          {step === 5 && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle size={48} color="var(--status-running)" style={{ justifySelf: 'center', margin: '0 auto 16px auto' }} />
              <h2 style={{ fontSize: '18px', marginBottom: '8px' }}>Installation Complete</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{platform?.name} has been successfully registered and configured.</p>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {step < 4 && <button className={styles.btnSecondary} onClick={handleBack} disabled={step === 1}>Back</button>}
          {step === 4 ? (
            installing ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Working...</span>
            ) : (
              <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'flex-end' }}>
                <button className={styles.btnPrimary} onClick={onClose} style={{ background: 'var(--text-primary)', color: 'var(--bg-card)' }}>Close</button>
              </div>
            )
          ) : step === 5 ? (
            <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'flex-end' }}>
              <button className={styles.btnPrimary} onClick={onInstalled || onClose}>Go to Installed</button>
            </div>
          ) : (
            <button className={styles.btnPrimary} onClick={step === 3 ? requireAuth(startInstall) : handleNext} disabled={!method || (step === 2 && (!preflightState.isSuccess || preflightState.checking)) || (step === 3 && config?.llm_config && !config.llm_config.model)}>
              {step === 3 ? 'Start Installation' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstallModal;
