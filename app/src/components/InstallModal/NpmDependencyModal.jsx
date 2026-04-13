import React, { useState, useEffect, useRef } from 'react';
import { X, Terminal, Copy, Check, Loader2, Play, DownloadCloud, AlertTriangle } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import styles from './NpmDependencyModal.module.css';

const NpmDependencyModal = () => {
  const { missingNpmDependencyFor, closeNpmDependencyModal, startPlatform } = usePlatformStore();
  const [copied, setCopied] = useState(false);
  
  const [isInstalling, setIsInstalling] = useState(false);
  const [logs, setLogs] = useState([]);
  const [installStatus, setInstallStatus] = useState('idle'); // 'idle', 'loading', 'success', 'error'
  const [errorMsg, setErrorMsg] = useState('');
  
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    if (!missingNpmDependencyFor) {
      setInstallStatus('idle');
      setLogs([]);
      setIsInstalling(false);
      setErrorMsg('');
      setCopied(false);
      return;
    }

    if (window.electron && window.electron.ipcRenderer) {
      const unsub = window.electron.ipcRenderer.on('dependency-log', (msg) => {
        setLogs(prev => [...prev, msg].slice(-200)); // Keep last 200 lines to preserve memory
      });
      return () => {
        if (typeof unsub === 'function') unsub();
      };
    }
  }, [missingNpmDependencyFor]);

  if (!missingNpmDependencyFor) return null;

  const codeToCopy = 'npm install -g openclaw';

  const handleCopy = () => {
    navigator.clipboard.writeText(codeToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallStatus('loading');
    setLogs([]);
    setErrorMsg('');
    
    try {
      const result = await window.electron?.ipcRenderer.invoke('install-global-dependency');
      if (result && result.success) {
        setInstallStatus('success');
      } else {
        setInstallStatus('error');
        setErrorMsg(result?.reason || 'Unknown error occurred.');
      }
    } catch (err) {
      setInstallStatus('error');
      setErrorMsg(err.message);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleContinue = () => {
    const id = missingNpmDependencyFor;
    closeNpmDependencyModal();
    // Give modal time to close
    setTimeout(() => {
      startPlatform(id);
    }, 400);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {(installStatus === 'idle' || installStatus === 'error' || installStatus === 'success') && (
          <button className={styles.closeBtn} onClick={closeNpmDependencyModal} title="Close">
            <X size={20} />
          </button>
        )}

        <div className={styles.content}>
          <div className={`${styles.iconWrapper} ${installStatus === 'success' ? styles.successIcon : installStatus === 'error' ? styles.errorIcon : ''}`}>
            {installStatus === 'loading' ? (
               <Loader2 size={32} className={styles.spin} />
            ) : installStatus === 'success' ? (
               <Check size={32} />
            ) : installStatus === 'error' ? (
               <AlertTriangle size={32} />
            ) : (
               <DownloadCloud size={32} />
            )}
          </div>
          
          <h2 className={styles.title}>
            {installStatus === 'loading' ? 'Installing Dependency...' : 
             installStatus === 'success' ? 'Installation Complete!' : 
             installStatus === 'error' ? 'Installation Failed' : 
             'Missing Global Dependency'}
          </h2>
          
          {installStatus === 'idle' && (
            <>
              <p className={styles.description}>
                To start OpenClaw using the NPM method on your machine, you must install the <strong style={{color: 'var(--text-primary)'}}>openclaw</strong> CLI package globally as a prerequisite.
              </p>
              
              <div className={styles.actionArea}>
                <button className={styles.installBtn} onClick={handleInstall}>
                  <Play size={16} />
                  Install Automatically
                </button>
              </div>

              <div className={styles.divider}>
                <span>OR DO IT MANUALLY</span>
              </div>

              <div className={styles.codeBox}>
                <code className={styles.codeText}>{codeToCopy}</code>
                <button 
                  className={`${styles.copyBtn} ${copied ? styles.copied : ''}`} 
                  onClick={handleCopy} 
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </>
          )}

          {(installStatus === 'loading' || installStatus === 'success' || installStatus === 'error') && (
            <div className={styles.progressContainer}>
              <div className={styles.logWindow}>
                {logs.length === 0 ? (
                  <span className={styles.logMuted}>Waiting for logs...</span>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={styles.logLine}>
                      {log.includes('[ERROR]') ? (
                        <span style={{ color: 'var(--red, #ef4444)' }}>{log}</span>
                      ) : log.includes('[WARN]') ? (
                        <span style={{ color: 'var(--yellow, #eab308)' }}>{log}</span>
                      ) : log.includes('[SUCCESS]') ? (
                        <span style={{ color: 'var(--green, #10b981)' }}>{log}</span>
                      ) : (
                        <span>{log}</span>
                      )}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>

              {installStatus === 'error' && (
                <div className={styles.errorMessage}>
                  <strong>Error:</strong> {errorMsg}
                  <button className={styles.retryBtn} onClick={handleInstall}>Retry Installation</button>
                </div>
              )}

              {installStatus === 'success' && (
                <button className={styles.continueBtn} onClick={handleContinue}>
                  Continue & Start Platform
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NpmDependencyModal;
