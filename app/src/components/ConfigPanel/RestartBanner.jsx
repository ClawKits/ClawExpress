import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const RestartBanner = ({ restarting, onRestart }) => (
  <div style={{
    margin: '0 20px', padding: '12px 16px', borderRadius: '8px',
    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <AlertTriangle size={14} color="#f59e0b" />
      <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 500 }}>
        Config saved. Restart required to apply changes.
      </span>
    </div>
    <button
      onClick={onRestart}
      disabled={restarting}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 12px', borderRadius: '5px', cursor: 'pointer',
        background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)',
        color: '#f59e0b', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap',
      }}
    >
      <RefreshCw size={12} style={{ animation: restarting ? 'spin 1s linear infinite' : 'none' }} />
      {restarting ? 'Restarting...' : 'Restart Now'}
    </button>
  </div>
);

export default RestartBanner;
