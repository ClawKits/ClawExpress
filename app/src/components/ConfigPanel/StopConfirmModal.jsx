import React from 'react';
import { AlertTriangle, Power, X } from 'lucide-react';

const StopConfirmModal = ({ channel, onCancel, onConfirm }) => (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 99999,
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <div style={{
      background: '#111', border: '1px solid #333',
      borderRadius: '12px', width: '420px', overflow: 'hidden',
      boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #222' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ 
            width: '32px', height: '32px', borderRadius: '8px', 
            background: 'rgba(239, 68, 68, 0.15)', 
            display: 'flex', alignItems: 'center', justifyContent: 'center' 
          }}>
            <Power size={16} color="#ef4444" />
          </div>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
            Stop OpenClaw Gateway
          </span>
        </div>
        <button onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>
      
      <div style={{ padding: '20px', color: '#aaa', fontSize: '14px', lineHeight: '1.6' }}>
        To safely generate the QR Code for <b>{channel.label}</b>, you must first STOP the OpenClaw Gateway. Do you want to stop it now?
      </div>
      
      <div style={{ padding: '16px 20px', borderTop: '1px solid #222', background: '#0a0a0a', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button
          onClick={onCancel}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #333', background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Power size={14} /> Yes, Stop Gateway
        </button>
      </div>
    </div>
  </div>
);

export default StopConfirmModal;
