import React from 'react';
import { Settings2, CheckCircle2 } from 'lucide-react';
import { toast } from '../Toast/Toast';
import Dropdown from '../Dropdown/Dropdown';
import styles from './ConfigPanel.module.css';

const ChannelSettingsPanel = ({
  channel: ch,
  config: cfg,
  setConfig: setCfg,
  pairingCode,
  setPairingCode,
  platform,
  stopPlatform,
  startPlatform,
  onClose,
}) => {
  const handleSave = async () => {
    const res = await window.electron.ipcRenderer.invoke('read-platform-config', { cwd: platform.cwd, platformId: platform.registryId || platform.id });
    if (!res.success) return;

    const newChannels = res.channels || {};
    if (!newChannels[ch.id]) newChannels[ch.id] = {};
    newChannels[ch.id].dmPolicy = cfg.dmPolicy === 'pairing' ? undefined : cfg.dmPolicy;

    const parsedAllowFrom = cfg.dmPolicy === 'open'
      ? ['*']
      : (typeof cfg.allowFrom === 'string'
          ? cfg.allowFrom.split(',').map(s => s.trim()).filter(Boolean)
          : cfg.allowFrom);
    newChannels[ch.id].allowFrom =
      cfg.dmPolicy === 'pairing' && (!parsedAllowFrom || parsedAllowFrom.length === 0)
        ? undefined
        : parsedAllowFrom;

    await window.electron.ipcRenderer.invoke('write-platform-config', {
      platformId: platform.registryId || platform.id,
      cwd: platform.cwd,
      env: {},
      channelConfig: { [ch.id]: newChannels[ch.id] },
    });

    toast.success(`${ch.label} settings saved!`);
    onClose();

    if (platform.status === 'RUNNING') {
      toast.success('Restarting Gateway to apply changes...', { autoClose: 2000 });
      await stopPlatform(platform.id);
      setTimeout(async () => { await startPlatform(platform.id); }, 1000);
    }
  };

  const handlePairingAccept = async () => {
    if (!pairingCode || pairingCode.length !== 8) {
      return toast.error('Pairing code must be 8 characters long');
    }
    const res = await window.electron.ipcRenderer.invoke('channel-pairing-accept', {
      channel: ch.id,
      code: pairingCode,
      cwd: platform.cwd,
      method: platform.method,
      version: platform.version,
      platformId: platform.id,
    });
    if (res.success) {
      toast.success('Pairing Accepted! Restarting Gateway to sync changes...');
      setPairingCode('');
      await window.electron.ipcRenderer.invoke('platform-stop', { platformId: platform.id, method: platform.method });
      setTimeout(async () => {
        await window.electron.ipcRenderer.invoke('platform-start', { platformId: platform.id, config: platform });
      }, 1000);
    } else {
      toast.error('Pairing failed: ' + res.reason);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '12px',
      padding: '14px', borderRadius: '8px',
      background: 'rgba(0,0,0,0.2)',
      border: `1px solid ${ch.color}50`,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
        <Settings2 size={16} color={ch.color} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{ch.label} Settings</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-primary)' }}>Direct Message Policy</label>
        <Dropdown
          value={cfg.dmPolicy}
          options={[
            { label: 'Pairing Mode (Auto-Accept via Code)', value: 'pairing' },
            { label: 'Allow Everyone (Open Mode)', value: 'open' },
          ]}
          onChange={(val) => setCfg(prev => ({ ...prev, dmPolicy: val }))}
          minWidth="100%"
        />

        {cfg.dmPolicy === 'pairing' && (
          <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              <strong>1.</strong> Send any message to the bot.<br />
              <strong>2.</strong> Bot replies with an 8-character Pairing Code.<br />
              <strong>3.</strong> Enter the code here to approve access:
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                className={styles.input}
                placeholder="Enter 8-character code..."
                value={pairingCode}
                onChange={e => setPairingCode(e.target.value.toUpperCase())}
                style={{ flex: 1, padding: '6px 10px', fontSize: '13px', fontFamily: 'monospace', letterSpacing: '2px' }}
                maxLength={8}
                disabled={cfg._isPairing}
              />
              <button
                onClick={async () => {
                  setCfg(prev => ({ ...prev, _isPairing: true }));
                  await handlePairingAccept();
                  setCfg(prev => ({ ...prev, _isPairing: false }));
                }}
                disabled={cfg._isPairing}
                style={{ background: 'var(--status-running)', color: '#fff', border: 'none', padding: '0 12px', borderRadius: '4px', cursor: cfg._isPairing ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600, opacity: cfg._isPairing ? 0.7 : 1 }}
              >
                {cfg._isPairing ? 'Verifying...' : 'Accept'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
        <button
          onClick={onClose}
          style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: 'none' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: 'var(--primary)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <CheckCircle2 size={12} /> Save
        </button>
      </div>
    </div>
  );
};

export default ChannelSettingsPanel;
