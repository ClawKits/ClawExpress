import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const ConfirmModal = ({
  isOpen,
  title,
  description,
  bullets = [],
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          width: '420px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          animation: 'slideUp 0.18s ease',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={16} color={danger ? '#ef4444' : '#f59e0b'} />
            </div>
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {title}
            </span>
          </div>
          <button onClick={onCancel} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          {description && (
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: bullets.length ? '12px' : 0, lineHeight: 1.6 }}>
              {description}
            </p>
          )}
          {bullets.length > 0 && (
            <ul style={{ margin: '0 0 0 2px', padding: 0, listStyle: 'none' }}>
              {bullets.map((b, i) => (
                <li key={i} style={{
                  fontSize: '13px', color: 'var(--text-secondary)',
                  padding: '3px 0', display: 'flex', alignItems: 'flex-start', gap: '8px',
                }}>
                  <span style={{ color: danger ? '#ef4444' : '#f59e0b', marginTop: '1px', flexShrink: 0 }}>•</span>
                  {b}
                </li>
              ))}
            </ul>
          )}
          <p style={{
            fontSize: '12px', color: 'var(--text-muted)',
            marginTop: '14px', fontStyle: 'italic',
          }}>
            This action cannot be undone.
          </p>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: '10px', justifyContent: 'flex-end',
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <button onClick={onCancel} style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', padding: '8px 18px',
            borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            transition: 'all 0.15s',
          }}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} style={{
            background: danger ? 'rgba(239,68,68,0.15)' : 'var(--text-primary)',
            border: danger ? '1px solid rgba(239,68,68,0.4)' : 'none',
            color: danger ? '#ef4444' : 'var(--app-bg)',
            padding: '8px 18px', borderRadius: '6px',
            cursor: 'pointer', fontSize: '13px', fontWeight: 500,
            transition: 'all 0.15s',
          }}>
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default ConfirmModal;
