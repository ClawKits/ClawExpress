import React, { useEffect, useState } from 'react';
import { UserCheck, X, Clock } from 'lucide-react';
import { toast } from '../Toast/Toast';
import { usePlatformStore } from '../../store/usePlatformStore';

/**
 * PairingModal
 * Listens to `pairing-request` IPC events (emitted by processManager's poller).
 * Shows a modal for each new pending request so the operator can Approve or Dismiss.
 */
export default function PairingModal() {
  const [request, setRequest] = useState(null); // { channel, code, senderName, senderId, expiresAt }
  const [loading, setLoading] = useState(false);
  const platforms = usePlatformStore(s => s.platforms);

  useEffect(() => {
    const cleanup = window.electron?.ipcRenderer.on('pairing-request', (ev) => {
      setRequest(ev);
    });
    return () => { if (cleanup) cleanup(); };
  }, []);

  if (!request) return null;

  const handleApprove = async () => {
    setLoading(true);
    // Find the active running platform to pass method/container
    const running = platforms.find(p => p.status === 'RUNNING');
    const res = await window.electron?.ipcRenderer.invoke('channel-pairing-accept', {
      channel: request.channel,
      code: request.code,
      method: running?.method,
      container: running?.container,
    });
    setLoading(false);
    if (res?.success) {
      toast.success(`✅ Pairing approved! ${request.senderName} can now chat with your bot.`);
    } else {
      toast.error(`❌ Approval failed: ${res?.error || 'Unknown error'}`);
    }
    setRequest(null);
  };

  const handleDismiss = () => setRequest(null);

  const channelLabel = request.channel === 'zalouser' ? 'Zalo Personal' : request.channel;
  const expires = request.expiresAt ? new Date(request.expiresAt).toLocaleTimeString() : null;

  return (
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
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserCheck size={16} color="#22c55e" />
            </div>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
              New Pairing Request — {channelLabel}
            </span>
          </div>
          <button onClick={handleDismiss} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', color: '#aaa', fontSize: '14px', lineHeight: '1.7' }}>
          <p style={{ margin: '0 0 12px' }}>
            A new user wants to chat with your bot on <b style={{ color: '#fff' }}>{channelLabel}</b>:
          </p>
          <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '12px 16px', border: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#666', fontSize: '12px' }}>Sender</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{request.senderName} <span style={{ color: '#555', fontSize: '11px' }}>#{request.senderId}</span></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666', fontSize: '12px' }}>Pairing Code</span>
              <span style={{ color: '#22c55e', fontWeight: 700, fontFamily: 'monospace', fontSize: '15px', letterSpacing: '2px' }}>{request.code}</span>
            </div>
          </div>
          {expires && (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#555', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Clock size={11} /> Expires at {expires}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid #222', background: '#0a0a0a', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={handleDismiss}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #333', background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
          >
            Dismiss
          </button>
          <button
            onClick={handleApprove}
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: loading ? '#1a4a28' : '#22c55e', color: '#000', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', transition: 'background 0.2s' }}
          >
            <UserCheck size={14} /> {loading ? 'Approving…' : 'Approve & Allow'}
          </button>
        </div>
      </div>
    </div>
  );
}
