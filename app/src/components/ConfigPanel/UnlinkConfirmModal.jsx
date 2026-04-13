import React from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';

const UnlinkConfirmModal = ({ channel, onCancel, onConfirm }) => (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  }}>
    <div style={{
      background: 'var(--bg-layer1)', border: '1px solid var(--border-color)',
      padding: '24px', borderRadius: '12px', width: '380px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '16px',
    }}>
      <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AlertTriangle size={18} color="#ef4444" /> Unlink {channel.label}
      </h3>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
        Are you sure you want to completely disconnect this account? This action cannot be undone
        and will require you to rescan the QR code to connect again.
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
        <button
          onClick={onCancel}
          style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <WifiOff size={14} /> Yes, Unlink
        </button>
      </div>
    </div>
  </div>
);

export default UnlinkConfirmModal;
