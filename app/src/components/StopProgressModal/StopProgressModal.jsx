import React, { useEffect, useState } from 'react';
import { Check, AlertTriangle, Loader, Square, ArrowUpRight } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import styles from './StopProgressModal.module.css';

const STEP_LABELS = {
  commit: 'Saving container state',
  stop:   'Stopping container',
};

const StatusIcon = ({ status }) => {
  if (status === 'running')    return <Loader        size={14} className={styles.spin} />;
  if (status === 'done')       return <Check         size={14} className={styles.iconDone} />;
  if (status === 'error')      return <AlertTriangle size={14} className={styles.iconError} />;
  if (status === 'background') return <ArrowUpRight  size={14} className={styles.iconBg} />;
  return <span className={styles.iconPending} />;
};

const StopProgressModal = () => {
  const { stoppingPlatform, clearStoppingPlatform } = usePlatformStore();
  // Steps built dynamically from events — order preserved by insertion
  const [steps, setSteps] = useState([]);
  const [done, setDone] = useState(false);

  // Reset each time a new stop begins
  useEffect(() => {
    if (!stoppingPlatform) return;
    setDone(false);
    setSteps([]);
  }, [stoppingPlatform?.id]);

  useEffect(() => {
    if (!stoppingPlatform) return;

    const cleanup = window.electron?.ipcRenderer.on('platform-stop-progress', (data) => {
      if (data.platformId !== stoppingPlatform.id) return;

      if (data.step === 'complete') {
        setDone(true);
        setTimeout(() => clearStoppingPlatform(), 2000);
        return;
      }

      setSteps(prev => {
        const exists = prev.find(s => s.id === data.step);
        if (exists) {
          return prev.map(s => s.id === data.step ? { ...s, status: data.status, msg: data.msg ?? s.msg } : s);
        }
        return [...prev, { id: data.step, status: data.status, msg: data.msg ?? '' }];
      });
    });

    return () => { if (cleanup) cleanup(); };
  }, [stoppingPlatform?.id]);

  if (!stoppingPlatform) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <Square size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
          <span>Stopping <strong>{stoppingPlatform.name}</strong></span>
        </div>

        <div className={styles.steps}>
          {steps.length === 0 && (
            <div className={`${styles.step} ${styles.step_running}`}>
              <div className={styles.stepIcon}><Loader size={14} className={styles.spin} /></div>
              <div className={styles.stepBody}>
                <span className={styles.stepLabel}>Preparing...</span>
              </div>
            </div>
          )}
          {steps.map(step => (
            <div key={step.id} className={`${styles.step} ${styles[`step_${step.status}`]}`}>
              <div className={styles.stepIcon}>
                <StatusIcon status={step.status} />
              </div>
              <div className={styles.stepBody}>
                <span className={styles.stepLabel}>{STEP_LABELS[step.id] ?? step.id}</span>
                {step.msg && <span className={styles.stepMsg}>{step.msg}</span>}
              </div>
            </div>
          ))}
        </div>

        {done && (
          <div className={styles.doneRow}>
            <Check size={13} className={styles.iconDone} />
            <span>Done</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default StopProgressModal;
