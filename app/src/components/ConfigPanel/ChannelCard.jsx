import React from 'react';
import { QrCode, WifiOff, Loader2, Settings2 } from 'lucide-react';

const ChannelCard = ({ channel: ch, isConnected, linkedPhone, isUnlinking, onUnlink, onConnect, onSettings }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', borderRadius: '8px',
    background: isConnected ? `${ch.color}10` : 'rgba(255,255,255,0.03)',
    border: `1px solid ${isConnected ? `${ch.color}40` : 'rgba(255,255,255,0.07)'}`,
    transition: 'all 0.2s',
    opacity: isConnected ? 1 : 0.8,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{ fontSize: '22px' }}>{ch.icon}</span>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {ch.label}
          {isConnected && (
            <span style={{ fontSize: '10px', background: `${ch.color}20`, color: ch.color, padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>
              Connected
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {isConnected && linkedPhone ? `Linked to ${linkedPhone}` : ch.desc}
        </div>
      </div>
    </div>

    <div style={{ display: 'flex', gap: '8px' }}>
      {isConnected && (
        <button
          onClick={onUnlink}
          disabled={isUnlinking}
          title={`Unlink ${ch.label}`}
          style={{
            background: !isUnlinking ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
            color: !isUnlinking ? '#ef4444' : 'var(--text-muted)',
            border: `1px solid ${!isUnlinking ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
            padding: '7px 14px', borderRadius: '6px',
            cursor: !isUnlinking ? 'pointer' : 'not-allowed',
            fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s',
          }}
        >
          {isUnlinking
            ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            : <WifiOff size={12} />}
          {isUnlinking ? 'Unlinking...' : 'Unlink'}
        </button>
      )}

      {!isConnected && (
        <button
          onClick={onConnect}
          title={`Connect ${ch.label}`}
          style={{
            background: 'var(--primary)', color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s',
          }}
        >
          <QrCode size={12} /> Connect
        </button>
      )}

      <button
        onClick={onSettings}
        title="Channel Settings"
        style={{
          background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '7px 11px', borderRadius: '6px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
        }}
      >
        <Settings2 size={13} />
      </button>
    </div>
  </div>
);

export default ChannelCard;
