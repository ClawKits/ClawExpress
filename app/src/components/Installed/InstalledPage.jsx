import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { RefreshCw, Plus, Bot, Cpu, TerminalSquare, PlusCircle, AlertTriangle, X, ExternalLink, ArrowUpCircle, Lock, Check } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Topbar from '../Topbar/Topbar';
import { toast } from '../Toast/Toast';

import UninstallModal from '../UninstallModal/UninstallModal';
import UpdateModal from '../ConfigPanel/UpdateModal';
const DockerLogo = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#2496ED" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z" />
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
  const { updateStates, setUpdateStates } = usePlatformStore();
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateModalTarget, setUpdateModalTarget] = useState(null);
  const [updateLogs, setUpdateLogs] = useState([]);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  useEffect(() => {
    if (!showUpdateModal || !updateModalTarget) return;
    const logPlatformId = `openclaw-update-${updateModalTarget.id}`;
    const cleanup = window.electron?.ipcRenderer.on('platform-log', ({ platformId, msg }) => {
      if (platformId === logPlatformId) {
        setUpdateLogs(prev => {
          const next = [...prev, msg];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
      }
    });
    return cleanup;
  }, [showUpdateModal, updateModalTarget]);

  // platform-ready is now handled globally in App.jsx — works even when this page is not mounted.

  // Fetch OpenClaw version info if it is installed
  useEffect(() => {
    const clawPlatform = platforms.find(p => (p.registryId || p.id).includes('openclaw'));
    if (clawPlatform) {
      if (clawPlatform.method === 'docker' && clawPlatform.status !== 'RUNNING') {
        if (clawPlatform.version !== '-') {
          const { updatePlatform } = usePlatformStore.getState();
          updatePlatform(clawPlatform.id, { version: '-' });
        }
        
        // Still fetch latest versions from GH so we can show the Update button
        window.electron?.ipcRenderer.invoke('get-openclaw-versions', { 
          method: clawPlatform.method, 
          config: clawPlatform,
          pVersion: '-' 
        }).then(res => {
          if (res && res.success) {
            setOpenclawInfo({ current: 'unknown', latest: res.latest, versions: res.versions });
          }
        });
        return;
      }

      window.electron?.ipcRenderer.invoke('get-openclaw-versions', { 
        method: clawPlatform.method, 
        config: clawPlatform,
        pVersion: clawPlatform.version 
      }).then(res => {
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
  }, [platforms.length, platforms.find(p => (p.registryId || p.id).includes('openclaw'))?.method, platforms.find(p => (p.registryId || p.id).includes('openclaw'))?.status]);

  const handleUpdateOpenClaw = async (platformId, cwd, method) => {
    if (!openclawInfo || !openclawInfo.latest) return;
    const p = platforms.find(x => x.id === platformId);
    const wasRunning = p?.status === 'RUNNING';
    const showProgressModal = method === 'docker';
    const logPlatformId = `openclaw-update-${platformId}`;
    if (showProgressModal) {
      setUpdateModalTarget(p || { id: platformId, name: 'OpenClaw', method });
      setUpdateLogs([
        `[SYSTEM] Preparing OpenClaw Docker update to v${openclawInfo.latest}...`,
        '[SYSTEM] Download progress will appear here.',
      ]);
      setUpdateSuccess(false);
      setShowUpdateModal(true);
    }
    setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'updating' } }));
    try {
      const res = await window.electron?.ipcRenderer.invoke('openclaw-install-version', { targetVersion: openclawInfo.latest, cwd, method, logPlatformId });
      if (res && res.success) {
        setOpenclawInfo(prev => ({ ...prev, current: openclawInfo.latest }));
        
        setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'success' } }));
        if (showProgressModal) {
          setUpdateLogs(prev => [...prev, `[SUCCESS] OpenClaw image updated to v${openclawInfo.latest}.`]);
          setUpdateSuccess(true);
        }
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
        if (showProgressModal) {
          setUpdateLogs(prev => [...prev, `[ERROR] Update failed: ${res?.reason || 'Unknown error'}`]);
          setUpdateSuccess(false);
        }
        toast.error(`Update failed: ${res?.reason || 'Unknown error'}`);
      }
    } catch (e) {
      setUpdateStates(prev => ({ ...prev, [platformId]: { status: 'failed', error: e.message } }));
      if (showProgressModal) {
        setUpdateLogs(prev => [...prev, `[ERROR] Update failed: ${e.message}`]);
        setUpdateSuccess(false);
      }
      toast.error(`Update failed: ${e.message}`);
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
      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        platform={updateModalTarget}
        logs={updateLogs}
        updating={!!updateModalTarget && updateStates[updateModalTarget.id]?.status === 'updating'}
        success={updateSuccess}
      />
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
                  {platform.method?.includes('docker') ? <DockerLogo size={64} />
                    : platform.method?.includes('npm') ? <NpmLogo size={64} />
                    : (platform.registryId || platform.id).includes('openclaw') 
                      ? <img src="./openclaw-logo.png" alt="OpenClaw" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '16px', boxSizing: 'border-box' }} />
                      : <Cpu size={40} color="var(--text-secondary)" />}
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
                      const isOpenClaw = (platform.registryId || platform.id).includes('openclaw');
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
                      Console
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

      <UninstallModal
        platform={confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onUninstalled={() => {
          // Additional cleanup if needed when fully uninstalled
        }}
      />
    </div>
  );
};

export default InstalledPage;
