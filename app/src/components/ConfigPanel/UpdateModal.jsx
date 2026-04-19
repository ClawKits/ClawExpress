import React, { useEffect, useRef } from 'react';
import { X, CheckCircle, Loader2 } from 'lucide-react';
import styles from '../InstallModal/InstallModal.module.css';

const UpdateModal = ({ isOpen, onClose, platform, logs, updating, success }) => {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} style={{ zIndex: 10000 }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Updating {platform?.name}</div>
          <button className={styles.closeBtn} onClick={onClose} disabled={updating}><X size={18} /></button>
        </div>

        <div className={styles.body}>
          {success && !updating ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle size={48} color="var(--status-running)" style={{ justifySelf: 'center', margin: '0 auto 16px auto' }} />
              <h2 style={{ fontSize: '18px', marginBottom: '8px' }}>Update Complete</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>The latest source has been built and configured.</p>
            </div>
          ) : (
            <div>
              <h2 style={{ fontSize: '16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Building from source {updating && <Loader2 size={16} className={styles.spin} />}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>Do not close this window or disconnect from the internet.</p>
              
              <div className={styles.terminal} ref={terminalRef}>
                {logs.map((log, i) => (
                  <div key={i} style={{ color: log.includes('WARN') ? '#f59e0b' : log.includes('SUCCESS') ? '#22c55e' : log.includes('ERROR') ? '#ef4444' : 'inherit', fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.4' }}>
                    {log}
                  </div>
                ))}
                {updating && <div style={{ animation: 'pulse 1s infinite' }}>_</div>}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer} style={{ justifyContent: 'flex-end' }}>
          {updating ? (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Working...</span>
          ) : (
            <button className={styles.btnSave} onClick={onClose}>Finish</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateModal;

