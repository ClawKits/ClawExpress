import React, { useRef, useState } from 'react';
import { Plus, Trash2, RotateCw, Download, Upload } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { PROVIDERS } from '../../constants/providers';
import { toast } from '../Toast/Toast';
import Dropdown from '../Dropdown/Dropdown';
import styles from './ConfigPanel.module.css';

const GeneralTab = ({
  schema,
  draft,
  set,
  otherEnv,
  setEnv,
  addEnv,
  removeEnv,
  INTERNAL_KEYS,
  CHAT_KEYS,
  connections,
  selectedConnectionId,
  setSelectedConnectionId,
  activeConnection,
  availableModels,
  setAvailableModels,
  selectedModel,
  setSelectedModel,
  useCustomModel,
  setUseCustomModel,
  customModel,
  setCustomModel,
  fetchingModels,
  fetchModels,
  activeModel,
  onAddConnection,
  onEditConnection,
  platform,
  handleDelete,
  onClose,
}) => {
  const { updatePlatform } = usePlatformStore();
  const importRef = useRef(null);
  const [importing, setImporting] = useState(false);
  
  const activeProvider = activeConnection ? PROVIDERS.find(p => p.id === activeConnection.providerId) : null;

  const handleExport = () => {
    // Exclude transient runtime fields
    const { status, uptime, dashboardUrl, ...exportable } = platform;
    const payload = {
      version: '1',
      exportedAt: new Date().toISOString(),
      platform: exportable,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${platform.id}-config-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Config exported');
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.platform || typeof data.platform !== 'object') {
        throw new Error('Invalid file — expected a single platform config.');
      }

      // Strip identity/transient fields so they don't overwrite this platform's ID or status
      const { id: _id, status: _s, uptime: _u, dashboardUrl: _d, ...restorable } = data.platform;
      updatePlatform(platform.id, restorable);
      toast.success('Config imported — close and reopen to see updated settings.');
      onClose();
    } catch (err) {
      console.error('[Import] Failed:', err);
      toast.error('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
  <>
    {schema.fields?.length > 0 && (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>General</div>
        <div className={styles.field}>
          <label className={styles.label}>Runtime Method</label>
          <input
            className={styles.input}
            disabled
            value={draft.method === 'docker' ? 'Docker / Podman' : 'NPM (Node.js)'}
            style={{ color: 'var(--text-muted)', cursor: 'not-allowed', backgroundColor: 'rgba(255,255,255,0.02)' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            To change the architecture mode, you must remove OpenClaw and reinstall.
          </span>
        </div>
        {schema.fields.map(field => (
          <div key={field.key} className={styles.field}>
            <label className={styles.label}>{field.label}</label>
            <input
              className={styles.input}
              type={field.type || 'text'}
              value={draft[field.key] !== undefined ? draft[field.key] : ''}
              onChange={e => set(field.key, e.target.value)}
              placeholder={field.placeholder || ''}
            />
            {field.hint && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{field.hint}</span>
            )}
          </div>
        ))}
      </div>
    )}

    {schema.features.includes('ai_engine_setup') && (
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>AI Engine Setup</span>
          <div style={{ display: 'flex', gap: '12px' }}>
            {selectedConnectionId && (
              <button
                onClick={() => onEditConnection(selectedConnectionId)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                Edit
              </button>
            )}
            <button
              onClick={onAddConnection}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={12} /> Add New
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Connection Profile</label>
          <Dropdown
            value={selectedConnectionId || ''}
            options={[
              ...(connections.length === 0
                ? [{ value: '', label: 'No connections available' }]
                : []),
              ...(!selectedConnectionId && connections.length > 0
                ? [{ value: '', label: 'Select a connection...' }]
                : []),
              ...connections
                .filter(c => c.enabled !== false || c.id === selectedConnectionId)
                .map(c => ({
                  value: c.id,
                  label: `${c.name} (${PROVIDERS.find(p => p.id === c.providerId)?.label || 'Unknown'})${c.enabled === false ? ' (Disabled)' : ''}`,
                })),
              ...(selectedConnectionId && !connections.some(c => c.id === selectedConnectionId)
                ? [{ value: selectedConnectionId, label: 'Unknown Connection (Deleted)' }]
                : [])
            ]}
            onChange={val => {
              setSelectedConnectionId(val);
              setAvailableModels([]);
              const conn = connections.find(c => c.id === val);
              if (conn?.models?.length > 0) {
                setAvailableModels(conn.models);
                setSelectedModel(conn.models[0]);
                setUseCustomModel(false);
              } else {
                setUseCustomModel(true);
                setCustomModel('');
              }
            }}
            minWidth="100%"
          />
        </div>

        {activeConnection && (
          <div className={styles.field}>
            <label className={styles.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Target Model</span>
              {(activeConnection.baseUrl || activeProvider?.modelsEndpoint || activeProvider?.gatewayModelPrefix) && (
                <button
                  type="button"
                  onClick={fetchModels}
                  disabled={fetchingModels}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '0' }}
                >
                  <RotateCw size={11} style={{ animation: fetchingModels ? 'spin 1s linear infinite' : 'none' }} />
                  {fetchingModels ? 'Fetching...' : 'Refresh Models'}
                </button>
              )}
            </label>
            {(() => {
              const modelList = availableModels.length > 0 ? availableModels : (activeConnection.models || []);
              return !useCustomModel && modelList.length > 0 ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <Dropdown value={selectedModel} options={modelList} onChange={setSelectedModel} minWidth="100%" />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setUseCustomModel(true); setCustomModel(selectedModel); }}
                    style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '7px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}
                  >
                    Custom
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    className={styles.input}
                    value={customModel}
                    onChange={e => setCustomModel(e.target.value)}
                    placeholder="e.g. gpt-4o or local-model-name"
                    style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}
                  />
                  {modelList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setUseCustomModel(false); setSelectedModel(modelList[0] || ''); }}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '7px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}
                    >
                      List
                    </button>
                  )}
                </div>
              );
            })()}
            <span className={styles.hint}>
              Active:{' '}
              <code style={{ fontSize: '11px', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '3px' }}>
                {activeModel || 'Not Set'}
              </code>
            </span>
          </div>
        )}
      </div>
    )}

    {schema.features.includes('custom_env') && (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Environment Variables</div>
        {otherEnv.length === 0 && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No other variables configured.</span>
        )}
        {draft.env.map((entry, i) => {
          if (
            INTERNAL_KEYS.includes(entry.key) ||
            CHAT_KEYS.includes(entry.key) ||
            PROVIDERS.some(p =>
              p.envKey === entry.key ||
              p.envKey.replace(/(_API_KEY|_TOKEN|_KEY)$/, '_BASE_URL') === entry.key
            )
          ) return null;
          return (
            <div key={i} className={styles.envRow}>
              <input
                className={styles.input}
                placeholder="KEY"
                value={entry.key}
                onChange={e => setEnv(i, 'key', e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
              <input
                className={styles.input}
                placeholder="value"
                value={entry.value}
                onChange={e => setEnv(i, 'value', e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
              <button className={styles.removeBtn} onClick={() => removeEnv(i)}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
        <button className={styles.addBtn} onClick={addEnv}>
          <Plus size={13} /> Add Variable
        </button>
      </div>
    )}

    {/* ── Portability ── */}
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Portability</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleExport}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: '5px',
            cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-primary)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <Download size={12} /> Export Config
        </button>

        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <button
          onClick={() => importRef.current?.click()}
          disabled={importing}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'transparent', border: '1px solid var(--border)',
            color: importing ? 'var(--text-muted)' : 'var(--text-secondary)',
            padding: '6px 12px', borderRadius: '5px',
            cursor: importing ? 'not-allowed' : 'pointer', fontSize: '12px',
            fontFamily: 'var(--font-primary)', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!importing) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = importing ? 'var(--text-muted)' : 'var(--text-secondary)'; }}
        >
          <Upload size={12} /> {importing ? 'Importing…' : 'Import Config'}
        </button>
      </div>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', display: 'block' }}>
        Export saves this platform's configuration as a JSON file. Import restores from a previously exported file.
      </span>
    </div>

    <div className={styles.dangerZone}>
      <div className={styles.dangerTitle}>Danger Zone</div>
      <div className={styles.dangerDesc}>Removing this platform will delete it from ClawExpress.</div>
      <button className={styles.btnDanger} onClick={handleDelete}>
        Remove {platform.name}
      </button>
    </div>
  </>
  );
};

export default GeneralTab;
