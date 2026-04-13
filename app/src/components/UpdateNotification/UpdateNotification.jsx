import React, { useState } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useAppUpdater, triggerInstall } from '../../hooks/useAppUpdater';
import styles from './UpdateNotification.module.css';

export default function UpdateNotification() {
  const { status, updateInfo, downloadProgress, isDownloading, isDownloaded } = useAppUpdater();
  const [dismissed, setDismissed] = useState(false);

  // Nothing to show
  if (dismissed) return null;
  if (!['available', 'downloading', 'downloaded', 'error'].includes(status)) return null;

  const version = updateInfo?.version;

  return (
    <div className={styles.container} role="alert" aria-live="polite">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.iconWrap}>
          {isDownloaded  ? <CheckCircle size={16} className={styles.iconGreen} /> :
           isDownloading ? <Download size={16} className={styles.iconBlue} /> :
           status === 'error' ? <AlertCircle size={16} className={styles.iconRed} /> :
           <RefreshCw size={16} className={styles.iconAccent} />}
        </div>
        <div className={styles.titleArea}>
          <div className={styles.title}>
            {isDownloaded  ? 'Update Ready to Install' :
             isDownloading ? `Downloading update ${version ? `v${version}` : ''}…` :
             status === 'error' ? 'Update Failed (Will retry later)' :
             `Update Available ${version ? `v${version}` : ''}`}
          </div>
        </div>
        <button
          className={styles.dismiss}
          onClick={() => setDismissed(true)}
          title="Dismiss until next session"
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar — shown while downloading */}
      {isDownloading && (
        <div className={styles.progressWrap} aria-label={`Download progress: ${downloadProgress}%`}>
          <div
            className={styles.progressBar}
            style={{ width: `${downloadProgress}%` }}
          />
          <span className={styles.progressLabel}>{downloadProgress}%</span>
        </div>
      )}

      {/* Actions */}
      {!isDownloading && status !== 'error' && (
        <div className={styles.actions}>
          {(isDownloaded || navigator.userAgent.includes('Mac')) && (
            <button
              id="update-install-btn"
              className={styles.btnPrimary}
              onClick={() => {
                if (navigator.userAgent.includes('Mac')) {
                  window.electron?.ipcRenderer?.invoke('open-url', 'https://github.com/ClawKits/ClawExpress/releases/latest');
                  setDismissed(true);
                } else {
                  triggerInstall();
                }
              }}
            >
              {navigator.userAgent.includes('Mac') ? (
                <><Download size={13} /> Download on GitHub</>
              ) : (
                <><RefreshCw size={13} /> Restart &amp; Install</>
              )}
            </button>
          )}
          <button
            className={styles.btnGhost}
            onClick={() => setDismissed(true)}
          >
            Later
          </button>
        </div>
      )}
    </div>
  );
}
