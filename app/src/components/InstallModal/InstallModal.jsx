import React, { useState, useEffect, useRef } from 'react';
import { X, Box, CheckCircle, Terminal, AlertCircle } from 'lucide-react';
import styles from './InstallModal.module.css';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useConnectionStore } from '../../store/useConnectionStore';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import Dropdown from '../Dropdown/Dropdown';
import { useRequireAuth } from '../../hooks/useRequireAuth';

const DockerLogo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#2496ED" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.983 11.278h-1.693v1.651h1.693v-1.651ZM11.168 11.278H9.475v1.651h1.693v-1.651ZM8.354 11.278H6.66v1.651h1.694v-1.651ZM16.797 11.278h-1.693v1.651h1.693v-1.651ZM13.983 8.355h-1.693v1.649h1.693V8.355ZM11.168 8.355H9.475v1.649h1.693V8.355ZM8.354 8.355H6.66v1.649h1.694V8.355ZM11.168 5.431H9.475v1.65h1.693v-1.65ZM10.534 1.761C6.273 1.761 2.82 5.215 2.82 9.475c0 4.26 3.453 7.713 7.714 7.713 4.26 0 7.714-3.453 7.714-7.713 0-4.26-3.454-7.714-7.714-7.714ZM3.315 15.65c-2.073-1.423-3.08-3.957-2.73-6.49 1.157-1.157 2.92-1.464 4.417-1.077h.03c.538-2.614 2.651-4.726 5.426-4.994.038.307.076.615.076.884v1.883h5.992c1.767-1.42 2.766-3.61 2.766-6.028v-.154h.154c1.69 0 3.338.46 4.76 1.344 1.768 5.033 1.076 10.604-1.844 15.02-3.15 4.802-8.601 7.72-14.484 7.72-1.997 0-4.033-.346-5.993-1.037.422-.768.96-1.46 1.574-2.074.883 1.42 2.535 2.38 4.418 2.38 2.805 0 5.071-2.267 5.071-5.071s-2.266-5.072-5.07-5.072c-1.884 0-3.536.96-4.418 2.38-1.15-.65-2.074-1.573-2.727-2.726Z" />
  </svg>
);

const NpmLogo = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#CB3837" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
  </svg>
);

const ConnectionPicker = ({ value, onChange }) => {
  const { connections, loadConnections } = useConnectionStore();
  const [selectedConnectionId, setSelectedConnectionId] = useState(value?.connectionId || '');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(value?.model || '');

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (!selectedConnectionId && connections.length > 0) {
      setSelectedConnectionId(connections[0].id);
    }
  }, [connections]);

  useEffect(() => {
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
      setModels(conn.models || []);
      if (conn.models?.length > 0 && !conn.models.includes(selectedModel)) {
        setSelectedModel(conn.models[0]);
      } else if (!conn.models?.length) {
        setSelectedModel('');
      }
    }
  }, [selectedConnectionId]);

  useEffect(() => {
    if (selectedConnectionId && selectedModel) {
      const conn = connections.find(c => c.id === selectedConnectionId);
      if (conn) {
        onChange({ 
          connectionId: conn.id, 
          provider: conn.providerId, 
          key: conn.apiKey, 
          baseUrl: conn.baseUrl,
          model: selectedModel 
        });
      }
    }
  }, [selectedConnectionId, selectedModel]);

  if (connections.length === 0) {
    return (
      <div style={{ background: 'rgba(250,204,21,0.1)', border: '1px solid #facc15', padding: '12px', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px' }}>
        No Connections found in your Vault. Please close this and go to the <strong>Connection Hub (Settings)</strong> to add an AI connection first.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Dropdown
          value={selectedConnectionId}
          options={connections.map(c => {
             const p = PROVIDERS.find(p => p.id === c.providerId);
             return { value: c.id, label: `${c.name} (${p?.label || 'Unknown'})` };
          })}
          onChange={setSelectedConnectionId}
          minWidth="100%"
        />
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>Model</span>
        {models.length > 0 ? (
          <div style={{ flex: 1 }}>
            <Dropdown
              value={selectedModel}
              options={models}
              onChange={setSelectedModel}
              minWidth="100%"
            />
          </div>
        ) : (
          <input 
            value={selectedModel} 
            onChange={e => setSelectedModel(e.target.value)} 
            placeholder="Type custom model name..."
            style={{ flex: 1, padding: '8px', background: 'var(--app-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', fontFamily: 'monospace' }}
          />
        )}
      </div>
    </div>
  );
};

const InstallModal = ({ isOpen, onClose, platform }) => {
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState(''); // 'npm' | 'docker'
  const [logs, setLogs] = useState([]);
  const [installing, setInstalling] = useState(false);
  const [config, setConfig] = useState({});
  const { addPlatform } = usePlatformStore();
  const requireAuth = useRequireAuth();
  const terminalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(1); setLogs([]); setInstalling(false); setMethod('');
    } else if (platform) {
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
  }, [isOpen, platform]);

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

        <div className={styles.body}>
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
                <div className={`${styles.methodCard} ${method === 'docker' ? styles.selected : ''}`} onClick={() => setMethod('docker')}>
                  <div style={{ marginBottom: '12px', display: 'flex' }}><DockerLogo size={28} /></div>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>Docker / Podman</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Isolated container. Best for stability and uninstalls. Requires Docker Desktop.</div>
                </div>
                <div className={`${styles.methodCard} ${method === 'npm' ? styles.selected : ''}`} onClick={() => setMethod('npm')}>
                  <div style={{ marginBottom: '12px', display: 'flex' }}><NpmLogo size={28} /></div>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>NPM (Node)</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Runs natively on your host OS. Faster, but requires Node.js globals.</div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Pre-flight Check</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>Verifying your system capabilities.</p>
              
              <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--status-running)', fontSize: '13px' }}>
                  <CheckCircle size={14} /> {method === 'docker' ? 'Docker daemon running' : 'Node.js v20.x detected'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--status-running)', fontSize: '13px' }}>
                  <CheckCircle size={14} /> At least 4GB RAM available
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-update)', fontSize: '13px' }}>
                  <AlertCircle size={14} /> Port {platform?.port || 18789} check completed.
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Global Configuration</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>Set up base parameters for this instance.</p>
              
              {!platform?.configSchema ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>No additional configuration required for this platform.</div>
              ) : (
                platform.configSchema.map(field => {
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
              <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Installing</h2>
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
              <button className={styles.btnPrimary} onClick={onClose}>Finish & Return</button>
            </div>
          ) : (
            <button className={styles.btnPrimary} onClick={step === 3 ? requireAuth(startInstall) : handleNext} disabled={!method || (step === 3 && config?.llm_config && !config.llm_config.model)}>
              {step === 3 ? 'Start Installation' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstallModal;
