import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { RefreshCw, Plus, Bot, Cpu, TerminalSquare, PlusCircle, AlertTriangle, X, ExternalLink, ArrowUpCircle, Lock, Check } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Topbar from '../Topbar/Topbar';
import { toast } from '../Toast/Toast';

// Inline confirm modal — no external dependency
const ConfirmDialog = ({ platform, onConfirm, onCancel }) => {
  if (!platform) return null;
  return ReactDOM.createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111', border: '1px solid #333',
          borderRadius: '12px', width: '400px', overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={16} color="#ef4444" />
            </div>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>Uninstall "{platform.name}"?</span>
          </div>
          <button onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: '13px', color: '#aaa', marginBottom: '12px' }}>This will permanently remove:</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {['Stop and remove Docker container', 'Delete all platform data & config'].map((b, i) => (
              <li key={i} style={{ fontSize: '13px', color: '#aaa', padding: '3px 0', display: 'flex', gap: '8px' }}>
                <span style={{ color: '#ef4444' }}>•</span>{b}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: '12px', color: '#555', marginTop: '14px', fontStyle: 'italic' }}>This action cannot be undone.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
          <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #333', color: '#aaa', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
            Uninstall
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const DockerLogo = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#2496ED" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.983 11.278h-1.693v1.651h1.693v-1.651ZM11.168 11.278H9.475v1.651h1.693v-1.651ZM8.354 11.278H6.66v1.651h1.694v-1.651ZM16.797 11.278h-1.693v1.651h1.693v-1.651ZM13.983 8.355h-1.693v1.649h1.693V8.355ZM11.168 8.355H9.475v1.649h1.693V8.355ZM8.354 8.355H6.66v1.649h1.694V8.355ZM11.168 5.431H9.475v1.65h1.693v-1.65ZM10.534 1.761C6.273 1.761 2.82 5.215 2.82 9.475c0 4.26 3.453 7.713 7.714 7.713 4.26 0 7.714-3.453 7.714-7.713 0-4.26-3.454-7.714-7.714-7.714ZM3.315 15.65c-2.073-1.423-3.08-3.957-2.73-6.49 1.157-1.157 2.92-1.464 4.417-1.077h.03c.538-2.614 2.651-4.726 5.426-4.994.038.307.076.615.076.884v1.883h5.992c1.767-1.42 2.766-3.61 2.766-6.028v-.154h.154c1.69 0 3.338.46 4.76 1.344 1.768 5.033 1.076 10.604-1.844 15.02-3.15 4.802-8.601 7.72-14.484 7.72-1.997 0-4.033-.346-5.993-1.037.422-.768.96-1.46 1.574-2.074.883 1.42 2.535 2.38 4.418 2.38 2.805 0 5.071-2.267 5.071-5.071s-2.266-5.072-5.07-5.072c-1.884 0-3.536.96-4.418 2.38-1.15-.65-2.074-1.573-2.727-2.726Z" />
  </svg>
);

const NpmLogo = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#CB3837" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
  </svg>
);

const InstalledPage = ({ onNavigate, setLogTarget, setConfigTarget }) => {
  const { platforms, toggleStatus, removePlatform, stopPlatform, startPlatform, setDashboardUrl } = usePlatformStore();
  const requireAuth = useRequireAuth();
  const [uninstallingId, setUninstallingId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const [openclawInfo, setOpenclawInfo] = useState(null);
  const [updateStates, setUpdateStates] = useState({});

  // Listen for platform-ready events emitted when gateway starts and token is available
  useEffect(() => {
    const cleanup = window.electron?.ipcRenderer.on('platform-ready', ({ platformId, dashboardUrl }) => {
      setDashboardUrl(platformId, dashboardUrl);
    });
    return cleanup;
  }, []);

  // Fetch OpenClaw version info if it is installed
  useEffect(() => {
    const clawPlatform = platforms.find(p => p.id.includes('openclaw'));
    if (clawPlatform) {
      window.electron?.ipcRenderer.invoke('get-openclaw-versions', { method: clawPlatform.method }).then(res => {
        if (res && res.success) {
          setOpenclawInfo({ current: res.current, latest: res.latest, versions: res.versions });
          
          // Auto-sync the real discovered version into the global store so Config, Log, and Card views match
          if (res.current !== 'unknown') {
            const realVer = `v${res.current.replace(/^v+/i, '').trim()}`;
            if (clawPlatform.version !== realVer) {
              const { updatePlatform } = usePlatformStore.getState();
              // Prevent infinite loops by only updating if strictly different
              updatePlatform(clawPlatform.id, { version: realVer });
            }
          }
        }
      }).catch(err => {
        console.error("IPC Error fetching version:", err);
      });
    }
  }, [platforms.length]);

  const handleUpdateOpenClaw = async (platformId, cwd, method) => {
    if (!openclawInfo || !openclawInfo.latest) return;
    const p = platforms.find(x => x.id === platformId);
    const wasRunning = p?.status === 'RUNNING';
    setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'updating' } }));
    try {
      const res = await window.electron?.ipcRenderer.invoke('openclaw-install-version', { targetVersion: openclawInfo.latest, cwd, method });
      if (res && res.success) {
        setOpenclawInfo(prev => ({ ...prev, current: openclawInfo.latest }));
        
        // Persist the new version info to the local database so it doesn't revert visually on next boot
        const { updatePlatform } = usePlatformStore.getState();
        updatePlatform(platformId, { version: openclawInfo.latest });

        setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'success' } }));
        toast.success(`Successfully updated to version v${openclawInfo.latest}`);
        
        // Auto Restart Logic
        setTimeout(async () => {
          const tId = toast.loading('Restarting gateway to apply update...');
          try {
            if (wasRunning) {
              await stopPlatform(platformId);
              await new Promise(r => setTimeout(r, 1500));
            }
            await startPlatform(platformId);
            toast.success('Gateway restarted successfully!', { id: tId });
          } catch (e) {
            toast.error('Failed to auto-restart gateway: ' + e.message, { id: tId });
          }
        }, 500);

        setTimeout(() => setUpdateStates(prev => {
          const next = {...prev}; delete next[platformId]; return next;
        }), 4000);
      } else {
        setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'failed', error: res?.reason || 'Unknown error' } }));
        toast.error(`Update failed: ${res?.reason || 'Unknown error'}`);
      }
    } catch (e) {
      setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'failed', error: e.message } }));
      toast.error(`Update failed: ${e.message}`);
    }
  };

  const handleUninstall = async () => {
    const platform = confirmTarget;
    setConfirmTarget(null);
    if (!platform) return;
    setUninstallingId(platform.id);
    try {
      if (platform.status === 'RUNNING') await stopPlatform(platform.id);
      await window.electron?.ipcRenderer.invoke('platform-uninstall', {
        platformId: platform.id,
        method: platform.method,
        container: platform.container,
        cwd: platform.cwd,
      });
      await removePlatform(platform.id);
    } catch (e) {
      console.error('Uninstall failed:', e);
    } finally {
      setUninstallingId(null);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'RUNNING': return { dot: 'var(--status-running)', glow: 'rgba(34, 197, 94, 0.4)' };
      case 'STOPPED': return { dot: 'var(--status-stopped)', glow: 'transparent' };
      case 'UPDATE': return { dot: 'var(--status-update)', glow: 'rgba(245, 158, 11, 0.4)' };
      case 'ERROR': return { dot: 'var(--status-error)', glow: 'rgba(239, 68, 68, 0.4)' };
      default: return { dot: 'var(--status-stopped)', glow: 'transparent' };
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--app-bg)' }}>
      <Topbar title="Installed Platforms" />

      <div style={{ padding: '32px 40px', flex: 1, overflowY: 'auto' }}>

        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Installed Platforms</div>
          <button
            onClick={() => onNavigate('marketplace')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', padding: '5px 12px',
              borderRadius: '5px', cursor: 'pointer', fontSize: '12px',
              fontFamily: 'var(--font-primary)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <Plus size={12} /> Install New
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px' }}>
          {platforms.map(platform => {
            const statusColors = getStatusColor(platform.status);
            const upState = updateStates[platform.id] || {};
            const isUpdating = upState.status === 'updating';
            const hasUpdateError = upState.status === 'failed';
            const isUpdateSuccess = upState.status === 'success';
            const isStarting = platform.status === 'STARTING';
            const isActionDisabled = uninstallingId === platform.id || isUpdating || isStarting;

            return (
              <div key={platform.id} style={{ backgroundColor: 'var(--card-bg)', border: '1px solid', borderColor: isUpdating ? 'rgba(56, 189, 248, 0.4)' : 'var(--border)', borderRadius: '8px', overflow: 'hidden', transition: 'border-color 0.3s' }}>
                <div style={{ height: '120px', background: 'linear-gradient(145deg, #1f1f1f, #0a0a0a)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {platform.id.includes('openclaw') ? (
                    platform.method === 'docker' ? <DockerLogo size={64} />
                    : platform.method === 'npm' ? <NpmLogo size={64} />
                    : <img src="./openclaw-logo.png" alt="OpenClaw" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '16px', boxSizing: 'border-box' }} />
                  ) : <Cpu size={40} color="var(--text-secondary)" />}
                </div>
                <div style={{ padding: '24px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 600 }}>
                      {platform.name}
                    </div>
                  </div>
                  
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <span>{platform.version} · via {platform.method}</span>
                    
                    {(() => {
                      const isOpenClaw = platform.id.includes('openclaw');
                      const hasUpdate = isOpenClaw && openclawInfo && openclawInfo.current !== 'unknown' && openclawInfo.current !== openclawInfo.latest;
                      const cleanVer = (v) => v ? v.toString().replace(/^v+/i, '').trim() : '';
                      
                      if (hasUpdate || hasUpdateError || isUpdateSuccess || isUpdating) {
                        let btnBg = 'rgba(56, 189, 248, 0.1)';
                        let btnHoverBg = 'rgba(56, 189, 248, 0.2)';
                        let btnBorder = '1px solid rgba(56, 189, 248, 0.3)';
                        let btnColor = '#38bdf8';
                        let btnText = `v${cleanVer(openclawInfo.latest)}`;
                        let btnTitle = `Update to v${cleanVer(openclawInfo.latest)}`;
                        let btnIcon = <ArrowUpCircle size={11} />;
                        
                        if (isUpdating) {
                           btnText = 'Updating...';
                           btnTitle = 'Update in progress... Check logs';
                           btnIcon = <RefreshCw size={10} style={{ animation: 'spin 1.5s linear infinite' }} />;
                        } else if (hasUpdateError) {
                           btnBg = 'rgba(239, 68, 68, 0.1)';
                           btnHoverBg = 'rgba(239, 68, 68, 0.2)';
                           btnBorder = '1px solid rgba(239, 68, 68, 0.3)';
                           btnColor = '#ef4444';
                           btnText = 'Update Failed';
                           btnTitle = `Failed: ${upState.error} (Click to retry)`;
                           btnIcon = <AlertTriangle size={11} />;
                        } else if (isUpdateSuccess) {
                           btnBg = 'rgba(34, 197, 94, 0.1)';
                           btnHoverBg = 'rgba(34, 197, 94, 0.1)';
                           btnBorder = '1px solid rgba(34, 197, 94, 0.3)';
                           btnColor = '#22c55e';
                           btnText = 'Update Success';
                           btnTitle = 'Updated successfully, please restart';
                           btnIcon = <Check size={11} />;
                        }

                        return (
                          <button
                            onClick={requireAuth(() => {
                              if (!isUpdating && !isUpdateSuccess) handleUpdateOpenClaw(platform.id, platform.cwd, platform.method);
                            })}
                            disabled={isUpdating || isUpdateSuccess}
                            title={btnTitle}
                            style={{
                              background: btnBg,
                              border: btnBorder,
                              color: btnColor,
                              padding: '2px 8px', borderRadius: '12px', cursor: (isUpdating || isUpdateSuccess) ? 'default' : 'pointer',
                              fontSize: '10px', fontWeight: 600,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                              transition: 'all 0.2s ease', whiteSpace: 'nowrap'
                            }}
                            onMouseEnter={e => !(isUpdating || isUpdateSuccess) && (e.currentTarget.style.background = btnHoverBg)}
                            onMouseLeave={e => !(isUpdating || isUpdateSuccess) && (e.currentTarget.style.background = btnBg)}
                          >
                            {btnIcon}
                            {btnText}
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  
                  {/* Unified status / dashboard button — always visible */}
                  <div style={{ marginBottom: '12px' }}>
                    {(() => {
                      const isRunning = platform.status === 'RUNNING';
                      const isDashboardReady = isRunning && platform.dashboardUrl;
                      // Starting = status is not RUNNING but also not cleanly STOPPED (transitional)
                      const isStarting = platform.status === 'STARTING';

                      // STATE 1: Dashboard ready → green Open Dashboard
                      if (isDashboardReady) {
                        return (
                          <button
                            onClick={() => window.electron?.ipcRenderer.invoke('open-url', { url: platform.dashboardUrl })}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              gap: '7px', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                              background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)',
                              color: '#4ade80', fontSize: '12px', fontWeight: 500,
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(34, 197, 94, 0.15)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(34, 197, 94, 0.08)'}
                            title={platform.dashboardUrl}
                          >
                            <ExternalLink size={13} />
                            Open Dashboard
                          </button>
                        );
                      }

                      // STATE 2: Running but dashboard not ready yet → animated "Starting..."
                      if (isRunning && !platform.dashboardUrl) {
                        return (
                          <div
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              gap: '7px', padding: '8px 12px', borderRadius: '6px',
                              background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.25)',
                              color: '#38bdf8', fontSize: '12px', fontWeight: 500,
                            }}
                          >
                            <RefreshCw size={13} style={{ animation: 'spin 1.5s linear infinite' }} />
                            Starting…
                          </div>
                        );
                      }

                      // STATE 3: Starting state → animated pulse
                      if (isStarting) {
                        return (
                          <div
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              gap: '7px', padding: '8px 12px', borderRadius: '6px',
                              background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.25)',
                              color: '#38bdf8', fontSize: '12px', fontWeight: 500,
                            }}
                          >
                            <RefreshCw size={13} style={{ animation: 'spin 1.5s linear infinite' }} />
                            Starting…
                          </div>
                        );
                      }

                      // STATE 4: Not running → neutral gray indicator
                      return (
                        <div
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '7px', padding: '8px 12px', borderRadius: '6px',
                            background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: 'var(--text-muted, #888)', fontSize: '12px', fontWeight: 500,
                          }}
                        >
                          <div style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            backgroundColor: 'var(--text-muted, #666)',
                          }} />
                          Not Running
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button 
                      onClick={requireAuth(() => toggleStatus(platform.id))}
                      disabled={isActionDisabled}
                      title={isUpdating ? "Cannot change status while updating" : ""}
                      style={{ 
                        flex: 1, 
                        background: platform.status === 'RUNNING' ? 'transparent' : 'var(--text-primary)', 
                        border: '1px solid',
                        borderColor: platform.status === 'RUNNING' ? 'var(--border)' : 'var(--text-primary)',
                        color: platform.status === 'RUNNING' ? 'var(--text-primary)' : 'var(--app-bg)', 
                        padding: '7px 12px', borderRadius: '4px', cursor: isActionDisabled ? 'not-allowed' : 'pointer', fontSize: '13px', 
                        fontWeight: platform.status === 'RUNNING' ? 500 : 600,
                        whiteSpace: 'nowrap', transition: 'all 0.2s ease',
                        opacity: isActionDisabled ? 0.3 : 1
                      }}
                      onMouseEnter={e => {
                        if (isActionDisabled) return;
                        if (platform.status === 'RUNNING') {
                          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                          e.currentTarget.style.color = '#ef4444';
                        } else {
                          e.currentTarget.style.opacity = '0.85';
                        }
                      }}
                      onMouseLeave={e => {
                        if (isActionDisabled) return;
                        if (platform.status === 'RUNNING') {
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.color = 'var(--text-primary)';
                        } else {
                          e.currentTarget.style.opacity = '1';
                        }
                      }}
                    >
                      {platform.status === 'STARTING' ? 'Starting...' : platform.status === 'RUNNING' ? 'Stop' : 'Start'}
                    </button>
                    
                  {/* Config & Logs — free (read-only view) */}
                    <button 
                      onClick={() => setConfigTarget(platform)} 
                      disabled={isActionDisabled}
                      title={isUpdating ? "Cannot configure while updating" : ""}
                      style={{ 
                        flex: 1, background: 'transparent', border: '1px solid var(--border)', 
                        color: 'var(--text-secondary)', padding: '7px 12px', borderRadius: '4px', 
                        cursor: isActionDisabled ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap', transition: 'all 0.2s ease',
                        opacity: isActionDisabled ? 0.3 : 1
                      }}
                      onMouseEnter={e => !isActionDisabled && (e.currentTarget.style.borderColor = 'var(--text-secondary)', e.currentTarget.style.color = 'var(--text-primary)')}
                      onMouseLeave={e => !isActionDisabled && (e.currentTarget.style.borderColor = 'var(--border)', e.currentTarget.style.color = 'var(--text-secondary)')}
                    >
                      Config
                    </button>
                    
                    <button 
                      onClick={() => setLogTarget(platform)} 
                      disabled={uninstallingId === platform.id}
                      title="View Logs"
                      style={{ 
                        flex: 1, background: isUpdating ? 'rgba(56, 189, 248, 0.05)' : 'transparent', border: '1px solid',
                        borderColor: isUpdating ? 'rgba(56, 189, 248, 0.4)' : 'var(--border)', 
                        color: isUpdating ? '#38bdf8' : 'var(--text-secondary)', padding: '7px 12px', borderRadius: '4px', 
                        cursor: uninstallingId === platform.id ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap', transition: 'all 0.2s ease',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                      }}
                      onMouseEnter={e => {
                        if (uninstallingId === platform.id) return;
                        e.currentTarget.style.borderColor = isUpdating ? '#38bdf8' : 'var(--text-secondary)';
                        e.currentTarget.style.color = isUpdating ? '#7dd3fc' : 'var(--text-primary)';
                      }}
                      onMouseLeave={e => {
                        if (uninstallingId === platform.id) return;
                        e.currentTarget.style.borderColor = isUpdating ? 'rgba(56, 189, 248, 0.4)' : 'var(--border)';
                        e.currentTarget.style.color = isUpdating ? '#38bdf8' : 'var(--text-secondary)';
                      }}
                    >
                      Console {isUpdating && <RefreshCw size={12} style={{ animation: 'spin 1.5s linear infinite' }} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div onClick={() => onNavigate('marketplace')} style={{ border: '1px dashed var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-secondary)', cursor: 'pointer', minHeight: '250px', borderRadius: '8px' }}>
            <PlusCircle size={28} style={{ marginBottom: '12px' }} />
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Discover More Platforms</span>
            <span style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>Browse Marketplace</span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        platform={confirmTarget}
        onConfirm={handleUninstall}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
};

export default InstalledPage;
