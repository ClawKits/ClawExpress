import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, X, CheckCircle, Loader2, Trash2 } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { toast } from '../Toast/Toast';

const UninstallModal = ({ platform, onClose, onUninstalled }) => {
  const { stopPlatform, removePlatform } = usePlatformStore();
  const [step, setStep] = useState('confirm'); // 'confirm', 'stopping', 'uninstalling', 'finishing', 'done', 'error'
  const [errorMsg, setErrorMsg] = useState('');

  if (!platform) return null;

  const handleUninstallFlow = async () => {
    setStep('stopping');
    try {
      // Step 1: Stop the platform if it is running
      if (platform.status === 'RUNNING') {
        await stopPlatform(platform.id);
        // Wait a bit to ensure OS releases file locks
        await new Promise(r => setTimeout(r, 1000));
      }

      setStep('uninstalling');
      await new Promise(r => setTimeout(r, 1200)); // Artificial delay for visibility

      // Step 2: Call backend to run uninstaller, remove npm package and data dirs
      const res = await window.electron?.ipcRenderer.invoke('platform-uninstall', {
        platformId: platform.id,
        registryId: platform.registryId,
        method: platform.method,
        container: platform.container,
        cwd: platform.cwd,
        wipeConfig: true, // Always wipe since dual-mode is no longer supported
      });

      if (res && res.success === false) {
        throw new Error(res.reason || 'Uninstall command failed');
      }

      setStep('finishing');
      await new Promise(r => setTimeout(r, 1200)); // Artificial delay for visibility

      // Step 3: Remove from local Zustand store
      await removePlatform(platform.id);
      
      setStep('done');
      toast.success(`${platform.name} was completely uninstalled.`);

      // Give user time to see "Done" state
      setTimeout(() => {
        if (onUninstalled) onUninstalled();
        onClose();
      }, 1500);

    } catch (err) {
      console.error('Uninstall failed:', err);
      setErrorMsg(err.message || 'Unknown error occurred.');
      setStep('error');
    }
  };

  const isWorking = ['stopping', 'uninstalling', 'finishing'].includes(step);

  return ReactDOM.createPortal(
    <div
      onClick={isWorking ? null : onClose}
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
          borderRadius: '12px', width: '420px', overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ 
              width: '32px', height: '32px', borderRadius: '8px', 
              background: step === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.15)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }}>
              <Trash2 size={16} color="#ef4444" />
            </div>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
              Uninstall "{platform.name}"
            </span>
          </div>
          {!isWorking && step !== 'done' && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', display: 'flex' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {step === 'confirm' && (
          <>
            <div style={{ padding: '20px' }}>
              <p style={{ fontSize: '13px', color: '#aaa', marginBottom: '12px' }}>This will permanently remove the platform from your system:</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                <li style={{ fontSize: '13px', color: '#aaa', padding: '3px 0', display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#ef4444' }}>•</span> Stop Gateway service (if running)
                </li>
                {platform.method === 'npm' ? (
                  <li style={{ fontSize: '13px', color: '#aaa', padding: '3px 0', display: 'flex', gap: '8px' }}>
                    <span style={{ color: '#ef4444' }}>•</span> Uninstall global NPM package 
                  </li>
                ) : platform.method === 'docker' ? (
                  <li style={{ fontSize: '13px', color: '#aaa', padding: '3px 0', display: 'flex', gap: '8px' }}>
                    <span style={{ color: '#ef4444' }}>•</span> Stop and remove Docker container
                  </li>
                ) : null}
                <li style={{ fontSize: '13px', color: '#aaa', padding: '3px 0', display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <span style={{ color: '#ef4444' }}>•</span> Wipe configuration &amp; data directory <span style={{ color: '#555', fontFamily: 'monospace', fontSize: '11px' }}>~/.openclaw</span>
                </li>
              </ul>

              <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', padding: '12px', borderRadius: '6px', marginTop: '16px', display: 'flex', gap: '10px' }}>
                <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: '12px', color: '#fca5a5', lineHeight: 1.4 }}>
                  All linked integrations, sessions and runtime configurations will be permanently wiped to ensure a clean state for future installations.
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid #222', background: 'rgba(0,0,0,0.3)' }}>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #333', color: '#aaa', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Cancel
              </button>
              <button onClick={handleUninstallFlow} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', padding: '8px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                Yes, Uninstall
              </button>
            </div>
          </>
        )}

        {(isWorking || step === 'done' || step === 'error') && (
          <div style={{ padding: '30px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Step 1: Stop Gateway */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {step === 'stopping' ? <Loader2 size={16} color="#38bdf8" className="spin-anim" /> 
                : ['uninstalling', 'finishing', 'done'].includes(step) ? <CheckCircle size={16} color="#22c55e" />
                : <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #444' }} />}
              <span style={{ fontSize: '13px', color: ['uninstalling', 'finishing', 'done'].includes(step) ? '#fff' : '#aaa' }}>
                Stopping Gateway service...
              </span>
            </div>

            {/* Step 2: Uninstall & Clean files */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {step === 'uninstalling' ? <Loader2 size={16} color="#38bdf8" className="spin-anim" /> 
                : ['finishing', 'done'].includes(step) ? <CheckCircle size={16} color="#22c55e" />
                : <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #444' }} />}
              <span style={{ fontSize: '13px', color: ['finishing', 'done'].includes(step) ? '#fff' : '#aaa' }}>
                Removing packages and cleaning data directories...
              </span>
            </div>

            {/* Step 3: Finish */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {step === 'finishing' ? <Loader2 size={16} color="#38bdf8" className="spin-anim" /> 
                : step === 'done' ? <CheckCircle size={16} color="#22c55e" />
                : <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #444' }} />}
              <span style={{ fontSize: '13px', color: step === 'done' ? '#fff' : '#aaa' }}>
                Finalizing...
              </span>
            </div>

            {step === 'error' && (
              <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: 500 }}>Uninstallation Error:</div>
                <div style={{ fontSize: '11px', color: '#fca5a5', marginTop: '4px', wordBreak: 'break-all' }}>{errorMsg}</div>
                <button onClick={onClose} style={{ marginTop: '10px', background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid #ef4444', padding: '4px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            )}
          </div>
        )}

        <style dangerouslySetInnerHTML={{__html: `
          @keyframes spin { 100% { transform: rotate(360deg); } }
          .spin-anim { animation: spin 1s linear infinite; }
        `}} />
      </div>
    </div>,
    document.body
  );
};

export default UninstallModal;
