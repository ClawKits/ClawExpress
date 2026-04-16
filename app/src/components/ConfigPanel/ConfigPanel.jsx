import React, { useState, useEffect } from 'react';
import { X, Settings2, MessageSquare, Code, CheckCircle2 } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useConnectionStore } from '../../store/useConnectionStore';
import { toast } from '../Toast/Toast';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import ConnectionManagerModal from '../ConnectionManager/ConnectionManagerModal';
import QRLoginModal from '../QRLoginModal/QRLoginModal';
import RawConfigEditor from '../RawConfigEditor/RawConfigEditor';
import CHANNEL_REGISTRY from '../../constants/channelRegistry';
import RestartBanner from './RestartBanner';
import UnlinkConfirmModal from './UnlinkConfirmModal';
import StopConfirmModal from './StopConfirmModal';
import GeneralTab from './GeneralTab';
import ChatIntegrationsTab from './ChatIntegrationsTab';
import UninstallModal from '../UninstallModal/UninstallModal';
import styles from './ConfigPanel.module.css';

const DEFAULT_SCHEMA = {
  features: ['ai_engine_setup', 'chat_integrations', 'custom_env'],
  fields: [
    { key: 'port', label: 'Port', type: 'number', placeholder: 'e.g. 3030' },
  ],
};

const INTERNAL_KEYS = ['CLAWEXPRESS_CONNECTION_ID', 'CLAWEXPRESS_PROVIDER'];
const CHAT_KEYS = ['TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'ZALO_BOT_TOKEN', 'LINE_CHANNEL_TOKEN', 'MSTEAMS_BOT_TOKEN', 'TWITCH_TOKEN'];

export const stripModelPrefix = (model) => {
  if (!model) return '';
  return model
    .replace(/^litellm\//i, '')
    .replace(/^openai-codex\//i, '')
    .replace(/^openai\//i, '')
    .replace(/^ollama\//i, '')
    .replace(/^nvidia_nim\//i, '')
    .replace(/^groq\//i, '')
    .replace(/^xai\//i, '')
    .replace(/^openrouter\//i, '')
    .replace(/^anthropic\//i, '')
    .replace(/^gemini\//i, '')
    .replace(/^deepseek\//i, '')
    .replace(/^together_ai\//i, '')
    .replace(/^moonshot\//i, '')
    .replace(/^mistral\//i, '')
    .replace(/^local\//i, '');
};

const ConfigPanel = ({ platform: platformProp, onClose }) => {
  // Subscribe to LIVE platform data from the store (the prop is a stale snapshot)
  const livePlatform = usePlatformStore(state => state.platforms.find(p => p.id === platformProp.id));
  const platform = livePlatform || platformProp;

  const schema = platform.schema || DEFAULT_SCHEMA;
  const { updatePlatform, removePlatform, startPlatform, stopPlatform } = usePlatformStore();
  const { connections, loadConnections } = useConnectionStore();

  const [draft, setDraft] = useState({
    name: platform.name || '',
    port: platform.port || '',
    method: platform.method || 'npm',
    startCmd: platform.startCmd || '',
    cwd: platform.cwd || '',
    container: platform.container || '',
    env: Object.entries(platform.env || {}).map(([k, v]) => ({ key: k, value: v })),
  });

  const [saved, setSaved] = useState(false);
  const [showUninstallModal, setShowUninstallModal] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(null);
  const [showConnectionManager, setShowConnectionManager] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState(null);

  const [chatDraft, setChatDraft] = useState(() => {
    const d = { SLACK_APP_TOKEN: '' };
    for (const key of CHAT_KEYS) d[key] = '';
    return d;
  });
  const [activeTab, setActiveTab] = useState('general');
  const [qrModal, setQrModal] = useState(null);
  const [channelSettingsMode, setChannelSettingsMode] = useState(null);
  const [connectedChannels, setConnectedChannels] = useState(new Set());
  const [channelLinkInfo, setChannelLinkInfo] = useState({});

  const connectionHintEntry = draft.env.find(e => e.key === 'CLAWEXPRESS_CONNECTION_ID');
  const [selectedConnectionId, setSelectedConnectionId] = useState(connectionHintEntry?.value || '');

  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const [waConfig, setWaConfig] = useState({ dmPolicy: 'pairing', allowFrom: '', groupPolicy: 'allowlist', groupAllowFrom: '' });
  const [zaloConfig, setZaloConfig] = useState({ dmPolicy: 'pairing', allowFrom: '', groupPolicy: 'allowlist', groupAllowFrom: '' });
  const [pairingCodes, setPairingCodes] = useState({});
  const [unlinkConfirm, setUnlinkConfirm] = useState(null);
  const [stopGatewayConfirm, setStopGatewayConfirm] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  useEffect(() => { loadConnections(); }, []);

  // Unified Channel Checker: runs on mount and whenever platform status changes.
  // Checks all QR channels via their filesystem configs regardless of Gateway status.
  useEffect(() => {
    let isMounted = true;
    const checkAllChannels = async () => {
      setCheckingStatus(true);
      const qrChannels = Object.entries(CHANNEL_REGISTRY).filter(([_, ch]) => ch.authType === 'qr');
      for (const [id] of qrChannels) {
        try {
          const result = await window.electron?.ipcRenderer.invoke('channel-check-linked', { channel: id });
          console.log(`[ConfigPanel] ${id} check result:`, result);
          if (!isMounted) break;
          if (result?.linked) {
            setConnectedChannels(prev => new Set([...prev, id]));
            if (result.phone) setChannelLinkInfo(prev => ({ ...prev, [id]: result.phone }));
          } else {
            setConnectedChannels(prev => { const n = new Set(prev); n.delete(id); return n; });
            setChannelLinkInfo(prev => { const n = { ...prev }; delete n[id]; return n; });
          }
        } catch (e) {
          console.error(`[ConfigPanel] ${id} check error:`, e);
        }
      }
      if (isMounted) setCheckingStatus(false);
    };
    checkAllChannels();
    return () => { isMounted = false; };
  }, [platform.status]);

  useEffect(() => {
    if (!platform.cwd) return;
    window.electron?.ipcRenderer.invoke('read-platform-config', { cwd: platform.cwd })
      .then(result => {
        if (result?.env && Object.keys(result.env).length > 0) {
          setDraft(d => ({ ...d, env: Object.entries(result.env).map(([k, v]) => ({ key: k, value: v })) }));
          if (result.env['CLAWEXPRESS_CONNECTION_ID']) {
            setSelectedConnectionId(result.env['CLAWEXPRESS_CONNECTION_ID']);
          }
        }
        const newChatDraft = { SLACK_APP_TOKEN: result?.env?.['SLACK_APP_TOKEN'] || platform.env?.['SLACK_APP_TOKEN'] || '' };
        for (const key of CHAT_KEYS) {
          newChatDraft[key] = result?.env?.[key] || platform.env?.[key] || '';
        }
        setChatDraft(newChatDraft);

        if (result?.channels?.whatsapp) {
          const wa = result.channels.whatsapp;
          const cleanAllowFrom = Array.isArray(wa.allowFrom) ? wa.allowFrom.filter(a => a !== '*').join(', ') : '';
          setWaConfig(prev => ({ ...prev, dmPolicy: (wa.dmPolicy === 'allowlist' || !wa.dmPolicy) ? 'pairing' : wa.dmPolicy, allowFrom: cleanAllowFrom }));
        }
        if (result?.channels?.zalouser) {
          const zu = result.channels.zalouser;
          const cleanAllowFrom = Array.isArray(zu.allowFrom) ? zu.allowFrom.filter(a => a !== '*').join(', ') : '';
          setZaloConfig(prev => ({ ...prev, dmPolicy: (zu.dmPolicy === 'allowlist' || !zu.dmPolicy) ? 'pairing' : zu.dmPolicy, allowFrom: cleanAllowFrom }));
        }
        if (result?.model) {
          const rawModel = stripModelPrefix(result.model);
          setSelectedModel(rawModel);
          setCustomModel(rawModel);
        }
      })
      .catch(() => {});
  }, [platform.cwd]);

  // Derive active connection/provider
  const activeConnection = connections.find(c => c.id === selectedConnectionId);
  const activeProvider = activeConnection
    ? PROVIDERS.find(p => p.id === activeConnection.providerId)
    : PROVIDERS[0];

  // Auto-set customModel toggle if model isn't in the connection's list
  useEffect(() => {
    const models = activeConnection?.models?.length > 0 ? activeConnection.models : availableModels;
    if (activeConnection && selectedModel) {
      if (models.length > 0) {
        const stripped = stripModelPrefix(selectedModel);
        const matched = models.find(m => m === selectedModel || m === stripped || stripModelPrefix(m) === stripped);
        if (matched) {
          setSelectedModel(matched);
          setUseCustomModel(false);
        } else {
          setUseCustomModel(true);
          setCustomModel(selectedModel);
        }
      } else {
        setUseCustomModel(true);
        setCustomModel(selectedModel);
      }
    }
  }, [selectedConnectionId, connections.length, selectedModel, activeConnection, availableModels]);

  // Merge provider static models with any extra fetched/saved models from connection
  useEffect(() => {
    if (!activeProvider) { setAvailableModels([]); return; }
    const providerModels = activeProvider.models || [];
    const providerPrefixMatch = activeProvider.defaultModel?.match(/^[^/]+\//);
    const expectedPrefix = providerPrefixMatch ? providerPrefixMatch[0] : '';
    const connectionModels = (activeConnection?.models || []).filter(m => {
      if (expectedPrefix && !m.startsWith(expectedPrefix)) return false;
      return !providerModels.includes(m);
    });
    const merged = [...new Set([...providerModels, ...connectionModels])];
    setAvailableModels(merged.length > 0 ? merged : []);
  }, [selectedConnectionId, activeProvider, connections]);

  const fetchModels = async () => {
    const isCliProvider = activeProvider?.category === 'cli' && activeProvider?.gatewayModelPrefix;
    if (!activeConnection?.baseUrl && !activeProvider?.modelsEndpoint && !isCliProvider) return;
    setFetchingModels(true);
    try {
      let res;
      if (isCliProvider) {
        // CLI providers: run `openclaw models list --json` directly — no gateway needed.
        res = await window.electron?.ipcRenderer.invoke('read-gateway-models', {
          gatewayModelPrefix: activeProvider.gatewayModelPrefix,
        });
      } else {
        res = await window.electron?.ipcRenderer.invoke('fetch-models', {
          baseUrl: activeConnection.baseUrl,
          apiKey: activeConnection.apiKey,
          providerId: activeConnection.providerId,
        });
      }

      if (res?.success && res.models?.length > 0) {
        setAvailableModels(res.models);
        setUseCustomModel(false);
        setSelectedModel(res.models[0]);
        const { updateConnection } = useConnectionStore.getState();
        await updateConnection(activeConnection.id, { models: res.models });
      } else {
        toast.error(res?.message || 'No models returned from provider');
      }
    } catch (e) {
      toast.error('Error fetching models: ' + e.message);
    } finally {
      setFetchingModels(false);
    }
  };

  const activeModel = useCustomModel ? customModel : selectedModel;

  // Draft helpers
  const set = (field, value) => setDraft(d => ({ ...d, [field]: value }));
  const setEnv = (i, field, value) => setDraft(d => {
    const env = [...d.env];
    env[i] = { ...env[i], [field]: value };
    return { ...d, env };
  });
  const addEnv = () => setDraft(d => ({ ...d, env: [...d.env, { key: '', value: '' }] }));
  const removeEnv = (i) => setDraft(d => ({ ...d, env: d.env.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    const ALL_PROVIDER_ENV_KEYS = PROVIDERS.flatMap(p => [
      p.envKey,
      p.envKey.replace(/(_API_KEY|_TOKEN|_KEY)$/, '_BASE_URL'),
    ]);
    const ALL_REMOVABLE_KEYS = [...ALL_PROVIDER_ENV_KEYS, ...CHAT_KEYS];

    let envObj = {};
    draft.env
      .filter(e => e.key.trim())
      .filter(e => !ALL_REMOVABLE_KEYS.includes(e.key) && !INTERNAL_KEYS.includes(e.key))
      .forEach(e => { envObj[e.key] = e.value; });

    let finalModel = activeModel;
    let cleanCustomTarget = null;

    if (activeConnection && activeProvider) {
      envObj['CLAWEXPRESS_CONNECTION_ID'] = activeConnection.id;
      envObj['CLAWEXPRESS_PROVIDER'] = activeProvider.id;
      if (activeConnection.apiKey) envObj[activeProvider.envKey] = activeConnection.apiKey;
      if (activeConnection.baseUrl) {
        const baseUrlKey = activeProvider.envKey.replace(/(_API_KEY|_TOKEN|_KEY)$/, '_BASE_URL');
        envObj[baseUrlKey] = activeConnection.baseUrl;
      }
      if (activeProvider.id === 'custom' || activeConnection.category === PROVIDER_CATEGORIES.PROXY) {
        cleanCustomTarget = finalModel.replace(/^openai\//i, '').replace(/^litellm\//i, '');
      }
    }

    for (const key of CHAT_KEYS) {
      if (chatDraft[key]?.trim()) envObj[key] = chatDraft[key].trim();
    }
    if (chatDraft.SLACK_APP_TOKEN?.trim()) envObj.SLACK_APP_TOKEN = chatDraft.SLACK_APP_TOKEN.trim();

    const methodChanged = draft.method && draft.method !== platform.method;
    const wasRunning = platform.status === 'RUNNING';

    // To prevent zombie processes, we must STOP the old runtime method 
    // BEFORE updating the Zustand state to the new method.
    if (methodChanged && wasRunning) {
      const toastId = toast.loading(`Switching runtime to ${draft.method}...`);
      await stopPlatform(platform.id);
      // Let the OS release file/port locks safely
      await new Promise(r => setTimeout(r, 1500));
      toast.dismiss(toastId);
    }

    updatePlatform(platform.id, {
      name: draft.name,
      port: draft.port ? Number(draft.port) : null,
      method: draft.method,
      startCmd: draft.startCmd,
      cwd: draft.cwd || null,
      container: draft.container || null,
      env: envObj,
      ...(methodChanged ? { version: '-' } : {})
    });

    const envToRemove = ALL_REMOVABLE_KEYS.filter(k => !(k in envObj));
    if (draft.cwd) {
      await window.electron?.ipcRenderer.invoke('write-platform-config', {
        cwd: draft.cwd,
        env: envObj,
        envToRemove,
        model: finalModel || undefined,
        customProxyTarget: cleanCustomTarget,
        channelConfig: {
          whatsapp: {
            dmPolicy: waConfig.dmPolicy,
            allowFrom: waConfig.dmPolicy === 'open' ? ['*'] : waConfig.allowFrom.split(',').map(s => s.trim()).filter(Boolean),
          },
          zalouser: {
            dmPolicy: zaloConfig.dmPolicy,
            allowFrom: zaloConfig.dmPolicy === 'open' ? ['*'] : zaloConfig.allowFrom.split(',').map(s => s.trim()).filter(Boolean),
          },
        },
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);

    if (methodChanged && wasRunning) {
      // Seamlessly start the new runtime method automatically
      await startPlatform(platform.id);
      toast.success('Runtime updated seamlessly.');
    } else if (wasRunning) {
      setRestartRequired(true);
    }

  };

  const handleRestartNow = async () => {
    setRestarting(true);
    setRestartRequired(false);
    await stopPlatform(platform.id);
    await new Promise(r => setTimeout(r, 1500));
    await startPlatform(platform.id);
    setRestarting(false);
    onClose();
  };

  const handleDelete = async () => {
    setShowUninstallModal(true);
  };

  const handleUnlinkConfirm = async () => {
    const ch = unlinkConfirm;
    setUnlinkConfirm(null);
    setIsUnlinking(ch.id);
    const toastId = toast.loading(`Unlinking ${ch.label}...`);

    const wasRunning = platform.status === 'RUNNING';
    if (wasRunning) {
      toast.loading('Stopping Gateway to release file locks safely...', { id: toastId });
      await stopPlatform(platform.id);
      // Brief wait so Windows fully releases any remaining file handles
      await new Promise(r => setTimeout(r, 1000));
    }

    toast.loading(`Unlinking ${ch.label}...`, { id: toastId });
    const res = await window.electron.ipcRenderer.invoke('channel-logout', { channel: ch.id });
    setIsUnlinking(null);

    if (res.success) {
      setConnectedChannels(prev => { const n = new Set(prev); n.delete(ch.id); return n; });
      setChannelLinkInfo(prev => { const n = { ...prev }; delete n[ch.id]; return n; });
      toast.success(`${ch.label} unlinked successfully!`, { id: toastId });
    } else {
      toast.error(`Failed to unlink: ${res.output || 'Unknown error'}`, { id: toastId });
    }

    if (wasRunning) {
      setTimeout(async () => {
        const rId = toast.loading('Restarting Gateway...');
        await startPlatform(platform.id);
        toast.success('Gateway Restarted!', { id: rId });
      }, 1500);
    }
  };

  const otherEnv = draft.env.filter(e =>
    !INTERNAL_KEYS.includes(e.key) &&
    !CHAT_KEYS.includes(e.key) &&
    !PROVIDERS.some(p => p.envKey === e.key)
  );

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div
        className={styles.drawer}
        style={activeTab === 'raw' && isFullscreen
          ? { width: '100vw', transition: 'width 0.3s ease' }
          : { transition: 'width 0.3s ease' }}
      >
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Configure — {platform.name}</div>
            <div className={styles.subtitle}>Changes take effect on next start</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.tabNav}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'general' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <Settings2 size={13} /> General
          </button>
          {schema.features.includes('chat_integrations') && (
            <button
              className={`${styles.tabBtn} ${activeTab === 'chat' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare size={13} /> Chat Integrations
            </button>
          )}
          <button
            className={`${styles.tabBtn} ${activeTab === 'raw' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('raw')}
          >
            <Code size={13} /> Advanced JSON
          </button>
        </div>

        <div className={styles.body}>
          {activeTab === 'general' && (
            <GeneralTab
              schema={schema}
              draft={draft}
              set={set}
              otherEnv={otherEnv}
              setEnv={setEnv}
              addEnv={addEnv}
              removeEnv={removeEnv}
              INTERNAL_KEYS={INTERNAL_KEYS}
              CHAT_KEYS={CHAT_KEYS}
              connections={connections}
              selectedConnectionId={selectedConnectionId}
              setSelectedConnectionId={setSelectedConnectionId}
              activeConnection={activeConnection}
              availableModels={availableModels}
              setAvailableModels={setAvailableModels}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              useCustomModel={useCustomModel}
              setUseCustomModel={setUseCustomModel}
              customModel={customModel}
              setCustomModel={setCustomModel}
              fetchingModels={fetchingModels}
              fetchModels={fetchModels}
              activeModel={activeModel}
              onAddConnection={() => { setShowConnectionManager(true); setEditingConnectionId(null); }}
              onEditConnection={(id) => { setShowConnectionManager(true); setEditingConnectionId(id); }}
              platform={platform}
              handleDelete={handleDelete}
              onClose={onClose}
            />
          )}

          {activeTab === 'chat' && schema.features.includes('chat_integrations') && (
            <ChatIntegrationsTab
              connectedChannels={connectedChannels}
              channelLinkInfo={channelLinkInfo}
              checkingStatus={checkingStatus}
              platform={platform}
              channelSettingsMode={channelSettingsMode}
              setChannelSettingsMode={setChannelSettingsMode}
              waConfig={waConfig}
              setWaConfig={setWaConfig}
              zaloConfig={zaloConfig}
              setZaloConfig={setZaloConfig}
              pairingCodes={pairingCodes}
              setPairingCodes={setPairingCodes}
              isUnlinking={isUnlinking}
              setUnlinkConfirm={setUnlinkConfirm}
              setStopGatewayConfirm={setStopGatewayConfirm}
              setQrModal={setQrModal}
              chatDraft={chatDraft}
              setChatDraft={setChatDraft}
              stopPlatform={stopPlatform}
              startPlatform={startPlatform}
            />
          )}

          {activeTab === 'raw' && (
            <RawConfigEditor
              platformId={platform.id}
              onSaveAndRestart={handleRestartNow}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            />
          )}
        </div>

        {activeTab !== 'raw' && (
          <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {restartRequired && (
              <div style={{ paddingBottom: '12px' }}>
                <RestartBanner restarting={restarting} onRestart={handleRestartNow} />
              </div>
            )}
            <div className={styles.footer}>
            {saved && (
              <span className={styles.savedBadge}>
                <CheckCircle2 size={13} /> Saved
              </span>
            )}
            <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
            <button
              className={styles.btnSave}
              onClick={handleSave}
              disabled={!selectedConnectionId}
            >
              Save Changes
            </button>
          </div>
        </div>
        )}

      </div>

      {showConnectionManager && (
        <ConnectionManagerModal
          connectionId={editingConnectionId}
          category={editingConnectionId ? null : 'vendor'}
          onClose={() => { setShowConnectionManager(false); loadConnections(); }}
        />
      )}

      {qrModal && (
        <QRLoginModal
          channel={qrModal}
          platformId={platform.id}
          platformConfig={platform}
          onClose={() => setQrModal(null)}
          onConnected={(ch) => {
            // Update React state only — do NOT write to openclaw.json here.
            // Writing config while Baileys completes the multi-device handshake
            // triggers OpenClaw's clobber-protection watcher and can drop the WebSocket.
            setConnectedChannels(prev => new Set([...prev, ch]));
            if (ch === 'whatsapp') setWaConfig(prev => ({ ...prev, dmPolicy: 'open' }));
            if (ch === 'zalouser') setZaloConfig(prev => ({ ...prev, dmPolicy: 'open' }));
            const politeName = ch === 'whatsapp' ? 'WhatsApp' : 'Zalo Personal';
            toast.success(`${politeName} connected successfully!`);
            setQrModal(null);
          }}
        />
      )}

      {unlinkConfirm && (
        <UnlinkConfirmModal
          channel={unlinkConfirm}
          onCancel={() => setUnlinkConfirm(null)}
          onConfirm={handleUnlinkConfirm}
        />
      )}

      {stopGatewayConfirm && (
        <StopConfirmModal
          channel={stopGatewayConfirm}
          onCancel={() => setStopGatewayConfirm(null)}
          onConfirm={async () => {
            const channel = stopGatewayConfirm;
            setStopGatewayConfirm(null);
            await stopPlatform(platform.id);
            // Allow 1.5s for OS to release ports fully before Zalo's zca-js headless check begins
            setTimeout(() => setQrModal(channel.id), 1500);
          }}
        />
      )}

      {showUninstallModal && (
        <UninstallModal
          platform={platform}
          onClose={() => setShowUninstallModal(false)}
          onUninstalled={() => {
            setShowUninstallModal(false);
            onClose(); // Close the ConfigPanel entirely
          }}
        />
      )}
    </>
  );
};

export default ConfigPanel;
