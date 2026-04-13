import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Loader2 } from 'lucide-react';

// ─── Toast Store (singleton, no Zustand needed) ────────────────────────────
let listeners = [];
let toasts = [];
const dismissTimers = new Map(); // id → timer handle

const notify = () => listeners.forEach(fn => fn([...toasts]));

const scheduleAutoDismiss = (id, duration) => {
  if (dismissTimers.has(id)) clearTimeout(dismissTimers.get(id));
  if (duration > 0) {
    dismissTimers.set(id, setTimeout(() => toast.dismiss(id), duration));
  }
};

export const toast = {
  show: (message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    toasts = [{ id, message, type }, ...toasts].slice(0, 5);
    notify();
    scheduleAutoDismiss(id, duration);
    return id;
  },

  // Update an existing toast in-place (same id, new message/type/duration).
  update: (id, message, type, duration = 4000) => {
    toasts = toasts.map(t => t.id === id ? { ...t, message, type } : t);
    notify();
    scheduleAutoDismiss(id, duration);
    return id;
  },

  dismiss: (id) => {
    if (dismissTimers.has(id)) { clearTimeout(dismissTimers.get(id)); dismissTimers.delete(id); }
    toasts = toasts.filter(t => t.id !== id);
    notify();
  },

  // ── Helpers — second arg can be a plain number (duration) or { id } opts ──
  loading: (msg, opts) => {
    if (opts?.id != null) return toast.update(opts.id, msg, 'loading', 0);
    return toast.show(msg, 'loading', 0); // loading toasts persist until updated
  },

  success: (msg, opts) => {
    const duration = typeof opts === 'number' ? opts : 4000;
    if (opts?.id != null) return toast.update(opts.id, msg, 'success', duration);
    return toast.show(msg, 'success', duration);
  },

  error: (msg, opts) => {
    const duration = typeof opts === 'number' ? opts : 6000;
    if (opts?.id != null) return toast.update(opts.id, msg, 'error', duration);
    return toast.show(msg, 'error', duration);
  },

  warn:    (msg, opts) => toast.show(msg, 'warn',    typeof opts === 'number' ? opts : 4000),
  warning: (msg, opts) => toast.warn(msg, opts),
  info:    (msg, opts) => toast.show(msg, 'info',    typeof opts === 'number' ? opts : 4000),
};

// ─── Individual Toast ──────────────────────────────────────────────────────
const ICONS = {
  success: <CheckCircle2 size={15} color="#22c55e" />,
  error:   <XCircle     size={15} color="#ef4444" />,
  warn:    <AlertTriangle size={15} color="#f59e0b" />,
  info:    <Info         size={15} color="#6366f1" />,
  loading: <Loader2      size={15} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />,
};

const BORDER_COLORS = {
  success: 'rgba(34,197,94,0.25)',
  error:   'rgba(239,68,68,0.25)',
  warn:    'rgba(245,158,11,0.25)',
  info:    'rgba(99,102,241,0.25)',
  loading: 'rgba(148,163,184,0.2)',
};

const ToastItem = ({ item, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        background: 'var(--sidebar-bg)',
        border: `1px solid ${BORDER_COLORS[item.type] || 'var(--border)'}`,
        borderRadius: '8px', padding: '12px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        pointerEvents: 'all', cursor: 'default',
        transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.97)',
        maxWidth: '360px', minWidth: '260px',
      }}
    >
      <div style={{ flexShrink: 0, marginTop: '1px' }}>{ICONS[item.type]}</div>
      <div style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
        {item.message}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0', display: 'flex', flexShrink: 0, marginTop: '1px' }}
      >
        <X size={14} />
      </button>
    </div>
  );
};

// ─── Toast Container (mount once in App root) ──────────────────────────────
export const ToastContainer = () => {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const handler = (list) => setItems(list);
    listeners.push(handler);
    return () => { listeners = listeners.filter(l => l !== handler); };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', bottom: '24px', right: '24px',
        display: 'flex', flexDirection: 'column-reverse', gap: '10px',
        zIndex: 9999, pointerEvents: 'none',
      }}
    >
      {items.map(item => (
        <ToastItem key={item.id} item={item} onDismiss={toast.dismiss} />
      ))}
    </div>
  );
};
