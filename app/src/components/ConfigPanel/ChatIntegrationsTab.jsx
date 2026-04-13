import React from 'react';
import { toast } from '../Toast/Toast';
import CHANNEL_REGISTRY from '../../constants/channelRegistry';
import ChannelCard from './ChannelCard';
import ChannelSettingsPanel from './ChannelSettingsPanel';
import styles from './ConfigPanel.module.css';

const ChatIntegrationsTab = ({
  connectedChannels,
  channelLinkInfo,
  checkingStatus,
  platform,
  channelSettingsMode,
  setChannelSettingsMode,
  waConfig,
  setWaConfig,
  zaloConfig,
  setZaloConfig,
  pairingCodes,
  setPairingCodes,
  isUnlinking,
  setUnlinkConfirm,
  setQrModal,
  chatDraft,
  setChatDraft,
  stopPlatform,
  startPlatform,
}) => (
  <>
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Personal Accounts (QR Login)</div>

      {checkingStatus && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
          Checking channel status...
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {Object.entries(CHANNEL_REGISTRY)
          .filter(([_, ch]) => ch.authType === 'qr')
          .map(([id, ch]) => {
            const channel = { ...ch, id };
            const cfg = id === 'whatsapp' ? waConfig : zaloConfig;
            const setCfg = id === 'whatsapp' ? setWaConfig : setZaloConfig;

            if (channelSettingsMode === id) {
              return (
                <ChannelSettingsPanel
                  key={id + '-settings'}
                  channel={channel}
                  config={cfg}
                  setConfig={setCfg}
                  pairingCode={pairingCodes[id] || ''}
                  setPairingCode={(val) => setPairingCodes(prev => ({ ...prev, [id]: val }))}
                  platform={platform}
                  stopPlatform={stopPlatform}
                  startPlatform={startPlatform}
                  onClose={() => setChannelSettingsMode(null)}
                />
              );
            }

            return (
              <ChannelCard
                key={id}
                channel={channel}
                isConnected={connectedChannels.has(id)}
                linkedPhone={channelLinkInfo[id]}
                isGatewayReady={platform.status === 'RUNNING'}
                isUnlinking={isUnlinking === id}
                onUnlink={() => setUnlinkConfirm(channel)}
                onConnect={() => {
                  if (!channel.managesGateway) {
                    if (channel.requiresGateway && platform.status !== 'RUNNING') {
                      toast.error(`⚠️ Please START OpenClaw Gateway to connect ${channel.label}.`);
                      return;
                    }
                    if (!channel.requiresGateway && platform.status === 'RUNNING') {
                      toast.error(`🚫 Please STOP OpenClaw Gateway first to safely generate ${channel.label} QR!`);
                      return;
                    }
                  }
                  setQrModal(id);
                }}
                onSettings={() => setChannelSettingsMode(id)}
              />
            );
          })}
      </div>
    </div>

    <div className={styles.section}>
      <div className={styles.sectionTitle}>Bot Token Integrations</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {Object.entries(CHANNEL_REGISTRY)
          .filter(([_, ch]) => ch.authType === 'token')
          .map(([id, ch]) => (
            <div key={id} className={styles.field}>
              <label className={styles.label}>{ch.icon} {ch.label}</label>
              <input
                className={styles.input}
                type="password"
                value={chatDraft[ch.envKey] || ''}
                onChange={e => setChatDraft(d => ({ ...d, [ch.envKey]: e.target.value }))}
                placeholder={ch.placeholder}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>
          ))}

        <div className={styles.field}>
          <label className={styles.label}>💼 Slack App Token (Optional)</label>
          <input
            className={styles.input}
            type="password"
            value={chatDraft.SLACK_APP_TOKEN || ''}
            onChange={e => setChatDraft(d => ({ ...d, SLACK_APP_TOKEN: e.target.value }))}
            placeholder="xapp-..."
            style={{ fontFamily: 'monospace', fontSize: '12px' }}
          />
        </div>
      </div>
    </div>
  </>
);

export default ChatIntegrationsTab;
