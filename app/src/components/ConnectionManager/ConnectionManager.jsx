import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useConnectionStore } from '../../store/useConnectionStore';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import styles from './ConnectionManager.module.css';
import { toast } from '../Toast/Toast';

const ConnectionManager = ({ onClose }) => {
  const { connections, loadConnections, addConnection, updateConnection, removeConnection } = useConnectionStore();
  const [selectedId, setSelectedId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  
  // Draft state for creating/editing
  const [draft, setDraft] = useState(null);
  const [verifyStatus, setVerifyStatus] = useState('idle'); // idle, checking, success, error
  const [verifyMsg, setVerifyMsg] = useState('');

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedId && !isCreating) {
      const conn = connections.find(c => c.id === selectedId);
      if (conn) {
        setDraft({ ...conn });
        setVerifyStatus('idle');
        setVerifyMsg('');
      } else {
        setSelectedId(null);
        setDraft(null);
      }
    }
  }, [selectedId, connections, isCreating]);

  const handleCreateNew = (category) => {
    setIsCreating(true);
    setSelectedId(null);
    setVerifyStatus('idle');
    setVerifyMsg('');
    
    const defaultProvider = PROVIDERS.find(p => p.category === category) || PROVIDERS[0];
    setDraft({
      name: '',
      category: category,
      providerId: '',
      apiKey: '',
      baseUrl: '',
      models: [],
    });
  };

  const selectedProvider = draft ? PROVIDERS.find(p => p.id === draft.providerId) : null;

  const handleVerify = async () => {
    if (!draft) return;
    if (draft.category === 'vendor' && !draft.apiKey) return;
    if (draft.category === 'proxy' && !draft.baseUrl) return;
    setVerifyStatus('checking');
    setVerifyMsg('');
    try {
      const res = await window.electron.ipcRenderer.invoke('verify-api-key', {
        providerId: draft.providerId,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl
      });
      if (res?.valid) {
        setVerifyStatus('success');
        setVerifyMsg('Connection verified successfully.');
        if (res.models?.length > 0) setDraft(d => ({ ...d, models: res.models }));
      } else {
        setVerifyStatus('error');
        setVerifyMsg(res?.message || 'Verification failed');
      }
    } catch (err) {
      setVerifyStatus('error');
      setVerifyMsg(err.message);
    }
  };

  const handleSave = async () => {
    if (!draft.name.trim()) return toast.warn('Please enter a connection name.');
    if (!draft.providerId) return toast.warn('Please select a provider.');
    if (isCreating) {
      const added = await addConnection(draft);
      setSelectedId(added.id);
      setIsCreating(false);
    } else {
      await updateConnection(selectedId, draft);
    }
  };

  const handleDelete = async () => {
    if (window.confirm(`Remove connection "${draft.name}"?`)) {
      await removeConnection(selectedId);
      setDraft(null);
      setSelectedId(null);
    }
  };

  const renderCategoryList = (category, title) => {
    const list = connections.filter(c => c.category === category);
    return (
      <div className={styles.categoryGroup}>
        <div className={styles.categoryTitle}>
          {title}
          <button 
            type="button"
            className={styles.closeBtn} 
            style={{float: 'right', padding: '0 4px', marginTop: '-4px'}}
            onClick={(e) => { e.stopPropagation(); handleCreateNew(category); }}
            title="Add New"
          >
            <Plus size={14} />
          </button>
        </div>
        {list.length === 0 && <div className={styles.connItem} style={{pointerEvents: 'none', fontStyle: 'italic', opacity: 0.5}}>None</div>}
        {list.map(c => (
          <div 
            key={c.id} 
            className={`${styles.connItem} ${selectedId === c.id ? styles.active : ''}`}
            onClick={() => { setIsCreating(false); setSelectedId(c.id); }}
          >
            <span className={styles.label}>{c.name}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Connection Hub</div>
            <div className={styles.subtitle}>Manage your AI API Keys and Proxy endpoints centrally</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            {renderCategoryList(PROVIDER_CATEGORIES.VENDOR, 'Direct Vendors')}
            {renderCategoryList(PROVIDER_CATEGORIES.PROXY, 'Proxies & Local')}
            {renderCategoryList(PROVIDER_CATEGORIES.CLI, 'CLI Tools')}
          </div>

          <div className={styles.content}>
            {!draft ? (
              <div className={styles.emptyState}>
                Select a connection to edit or click + to add a new one.
              </div>
            ) : (
              <div>
                <div className={styles.field}>
                  <label className={styles.label}>Connection Name</label>
                  <input 
                    className={styles.input} 
                    value={draft.name} 
                    onChange={e => setDraft({...draft, name: e.target.value})}
                    placeholder="e.g. My OpenAI Key"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Provider Backend</label>
                  <select 
                    className={styles.select}
                    value={draft.providerId || ''}
                    onChange={e => {
                      const val = e.target.value;
                      if (!val) {
                        setDraft({...draft, providerId: '', models: []});
                        return;
                      }
                      const p = PROVIDERS.find(x => x.id === val);
                      setDraft({...draft, providerId: p.id, models: p.models || []});
                      setVerifyStatus('idle');
                    }}
                  >
                    <option value="" disabled>Select a provider...</option>
                    {PROVIDERS.filter(p => p.category === draft.category).sort((a, b) => a.label.localeCompare(b.label)).map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {draft.category !== PROVIDER_CATEGORIES.CLI && (
                  <>
                    <div className={styles.field}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
                        <label className={styles.label} style={{ margin: 0 }}>API Key</label>
                        {selectedProvider?.url && (
                          <a href="#" onClick={(e) => { e.preventDefault(); window.electron.ipcRenderer.invoke('open-url', { url: selectedProvider.url }); }} style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>
                            Get API Key ↗
                          </a>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                          className={styles.input} 
                          type="password"
                          value={draft.apiKey} 
                          onChange={e => { setDraft({...draft, apiKey: e.target.value}); setVerifyStatus('idle'); }}
                          placeholder={selectedProvider?.hint || 'sk-...'}
                          style={{ fontFamily: 'monospace' }}
                        />
                        <button 
                          type="button"
                          className={styles.btnSecondary}
                          onClick={handleVerify}
                          disabled={(draft.category === 'proxy' ? !draft.baseUrl : !draft.apiKey) || verifyStatus === 'checking'}
                        >
                          {verifyStatus === 'checking' ? 'Checking...' : 'Verify'}
                        </button>
                      </div>
                      {verifyStatus === 'success' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
                          <div className={styles.hint} style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', margin: 0 }}>
                            <CheckCircle2 size={12} /> {verifyMsg}
                          </div>
                          {draft.models?.length > 0 && (
                            <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Available Models ({draft.models.length}):</div>
                              <select className={styles.select} style={{ width: '100%', padding: '6px 8px', fontSize: '12px', opacity: 0.9 }}>
                                {draft.models.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                      {verifyStatus === 'error' && <div className={styles.hint} style={{color: '#ef4444'}}>{verifyMsg}</div>}
                    </div>

                    {(draft.category === PROVIDER_CATEGORIES.PROXY || draft.providerId === 'custom') && (
                      <div className={styles.field}>
                        <label className={styles.label}>Custom Base URL</label>
                        <input 
                          className={styles.input} 
                          value={draft.baseUrl || ''} 
                          onChange={e => { setDraft({...draft, baseUrl: e.target.value}); setVerifyStatus('idle'); }}
                          placeholder="e.g. http://127.0.0.1:1234/v1"
                          style={{ fontFamily: 'monospace' }}
                        />
                        <span className={styles.hint}>Required if connecting to a proxy or local inference server.</span>
                      </div>
                    )}
                  </>
                )}

                {draft.category === PROVIDER_CATEGORIES.CLI && (
                  <div className={styles.field}>
                    <label className={styles.label}>Executable Path</label>
                    <input 
                      className={styles.input} 
                      value={draft.baseUrl || ''} 
                      onChange={e => setDraft({...draft, baseUrl: e.target.value})}
                      placeholder="/usr/local/bin/claude"
                      style={{ fontFamily: 'monospace' }}
                    />
                    <span className={styles.hint}>Absolute path to the CLI executable.</span>
                  </div>
                )}

                <div className={styles.actions}>
                  <button className={styles.btnPrimary} onClick={handleSave}>
                    {isCreating ? 'Create Connection' : 'Save Changes'}
                  </button>
                  <button className={styles.btnSecondary} onClick={() => { setDraft(null); setIsCreating(false); setSelectedId(null); }}>
                    Cancel
                  </button>
                  {!isCreating && (
                    <button className={styles.btnDanger} onClick={handleDelete}>
                      <Trash2 size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }}/>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionManager;
