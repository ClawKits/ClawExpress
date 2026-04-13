import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, Trash2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useConnectionStore } from '../../store/useConnectionStore';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import Dropdown from '../Dropdown/Dropdown';
import { toast } from '../Toast/Toast';
import styles from './ConnectionManager.module.css';
import PlaygroundTest from './PlaygroundTest';

// ─── OAuth Flow Subview ───────────────────────────────────────────────────────
const OAuthFlow = ({ provider, draft, setDraft, onSuccess }) => {
  const [oauthState, setOauthState] = useState('idle'); // idle|waiting|success|fallback
  const [authUrl, setAuthUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const listenerRef = useRef(null);

  const startOAuth = async () => {
    setOauthState('waiting');
    setErrorMsg('');

    // Listen for auto-captured token from backend
    listenerRef.current = window.electron.ipcRenderer.on('oauth-token-received', (data) => {
      if (data.providerId !== provider.id) return;
      if (data.error) {
        setErrorMsg(data.error);
        setOauthState('fallback');
      } else {
        handleTokenReceived(data.tokens);
      }
    });

    try {
      const res = await window.electron.ipcRenderer.invoke('oauth-start', {
        providerId: provider.id,
        oauthConfig: provider.oauth,
      });
      if (!res.success) {
        setErrorMsg(res.message || 'Failed to start OAuth');
        setOauthState('fallback');
        return;
      }
      setAuthUrl(res.authUrl);
      // Stays in 'waiting' — listening for oauth-token-received event
    } catch (e) {
      setErrorMsg(e.message);
      setOauthState('fallback');
    }
  };

  const handleTokenReceived = (tokens) => {
    setOauthState('success');
    const apiKey = tokens.access_token || tokens.token || '';
    setDraft(d => ({ ...d, apiKey, oauthTokens: tokens }));
    if (listenerRef.current) listenerRef.current();
    onSuccess();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(authUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualExchange = async () => {
    if (!callbackUrl.trim()) return;
    setOauthState('waiting');
    try {
      const res = await window.electron.ipcRenderer.invoke('oauth-exchange', {
        callbackUrl: callbackUrl.trim(),
        providerId: provider.id,  // backend uses this to retrieve session codeVerifier
      });
      if (res.success) {
        handleTokenReceived(res.tokens);
      } else {
        setErrorMsg(res.message);
        setOauthState('fallback');
      }
    } catch (e) {
      setErrorMsg(e.message);
      setOauthState('fallback');
    }
  };

  // ── Idle: explain the flow & show Connect button ──────────────────────────
  if (oauthState === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ padding: '14px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: '6px' }}>How this works</div>
          <div>1. ClawExpress starts a local listener on port {provider.oauth.redirectPort}</div>
          <div>2. Your browser opens the {provider.label} authorization page</div>
          <div>3. After you approve, the token is captured automatically</div>
          <div>4. No copy-paste needed — connection saves immediately</div>
        </div>
        <button
          onClick={startOAuth}
          style={{ padding: '11px 20px', borderRadius: '8px', border: 'none', background: 'var(--text-primary)', color: 'var(--app-bg)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <ExternalLink size={14} />
          Connect with {provider.label}
        </button>
      </div>
    );
  }

  // ── Waiting: show spinner + auth URL ─────────────────────────────────────
  if (oauthState === 'waiting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {authUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Authorization URL</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input readOnly value={authUrl} style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }} />
              <button onClick={handleCopy} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                <Copy size={11} />{copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '8px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <Loader2 size={15} color="#22c55e" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: '#22c55e' }}>
            Waiting for browser authorization…{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>will complete automatically</span>
          </div>
        </div>
        <button onClick={() => setOauthState('fallback')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
          Browser didn't open or auto-capture failed? Paste callback URL manually →
        </button>
      </div>
    );
  }

  // ── Fallback: manual paste mode ───────────────────────────────────────────
  if (oauthState === 'fallback') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {authUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>Step 1 — Open this URL in your browser</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input readOnly value={authUrl} style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }} />
              <button onClick={handleCopy} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                <Copy size={11} />{copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>Step 2 — Paste the callback URL here</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>After authorizing, copy the full URL from your browser address bar.</div>
          <input
            value={callbackUrl}
            onChange={e => setCallbackUrl(e.target.value)}
            placeholder={`http://localhost:${provider.oauth.redirectPort}${provider.oauth.redirectPath}?code=...`}
            style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {errorMsg && <div style={{ fontSize: '12px', color: '#f59e0b' }}>⚠ {errorMsg}</div>}
        <button
          onClick={handleManualExchange}
          disabled={!callbackUrl.trim()}
          style={{ padding: '9px 18px', borderRadius: '6px', border: 'none', background: callbackUrl.trim() ? 'var(--text-primary)' : 'rgba(255,255,255,0.08)', color: callbackUrl.trim() ? 'var(--app-bg)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, cursor: callbackUrl.trim() ? 'pointer' : 'not-allowed' }}
        >
          Connect
        </button>
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (oauthState === 'success') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderRadius: '8px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <CheckCircle2 size={16} color="#22c55e" />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#22c55e' }}>Authorization successful!</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Token saved. Click "Save Connection" to finish.</div>
          </div>
        </div>
        {draft.models?.length > 0 && (
          <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Available Models ({draft.models.length}):</div>
            <select style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--app-bg)', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', opacity: 0.9 }}>
              {draft.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
      </div>
    );
  }

  return null;
};

// ─── Main Modal ───────────────────────────────────────────────────────────────
const ConnectionManagerModal = ({ connectionId, category, onClose }) => {
  const { connections, addConnection, updateConnection, removeConnection } = useConnectionStore();

  const isCreating = !connectionId;
  const [draft, setDraft] = useState(null);
  const [verifyStatus, setVerifyStatus] = useState('idle');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [oauthDone, setOauthDone] = useState(false);

  useEffect(() => {
    if (isCreating) {
      const defaultProvider = PROVIDERS.find(p => p.category === category) || PROVIDERS[0];
      setDraft({
        name: '',
        category: category || defaultProvider.category,
        providerId: '',
        apiKey: '',
        baseUrl: '',
        models: [],
      });
    } else {
      const conn = connections.find(c => c.id === connectionId);
      if (conn) setDraft({ ...conn });
    }
  }, [connectionId, category, isCreating, connections]);

  if (!draft) return null;

  const validProviders = PROVIDERS.filter(p => p.category === draft.category).sort((a, b) => a.label.localeCompare(b.label));
  const selectedProvider = PROVIDERS.find(p => p.id === draft.providerId);
  const isOAuthProvider = !!selectedProvider?.oauth;

  const handleVerify = async () => {
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
    try {
      if (isCreating) {
        if (draft.category === 'vendor' && verifyStatus !== 'success') {
          if (!window.confirm('This API key has not been verified. Save anyway?')) return;
        }
        if (isOAuthProvider && !draft.apiKey && !oauthDone) {
          if (!window.confirm('OAuth authorization not completed. Save anyway?')) return;
        }
        await addConnection({ ...draft, enabled: true });
      } else {
        await updateConnection(connectionId, draft);
      }
      onClose();
    } catch (err) {
      toast.error('Error saving connection: ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (window.confirm(`Remove connection "${draft.name}"?`)) {
      await removeConnection(connectionId);
      onClose();
    }
  };

  const getModalTitle = () => {
    if (!isCreating) return 'Edit Connection';
    if (draft.category === 'cli') return `Connect ${selectedProvider?.label || 'OAuth/CLI'}`;
    if (draft.category === 'proxy') return 'Add Local/Proxy Connection';
    return 'Add API Key Connection';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '100%', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{getModalTitle()}</div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* Connection Name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Connection Name</label>
            <input
              style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder={
                draft.category === 'cli' ? 'e.g. My Codex Account' :
                draft.category === 'proxy' ? 'e.g. LM Studio Local' :
                'e.g. My OpenAI Key'
              }
            />
          </div>

          {/* Provider Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Provider</label>
            <Dropdown
              value={draft.providerId || ''}
              options={[
                { value: '', label: 'Select a provider...' },
                ...validProviders.map(p => ({ value: p.id, label: p.label }))
              ]}
              onChange={val => {
                if (!val) {
                  setDraft({ ...draft, providerId: '', models: [] });
                  return;
                }
                const p = PROVIDERS.find(x => x.id === val);
                setDraft({ ...draft, providerId: p.id, models: p.models || [] });
                setVerifyStatus('idle'); setVerifyMsg(''); setOauthDone(false);
              }}
              minWidth="100%"
            />

          </div>

          {/* CLI + OAuth flow */}
          {draft.category === 'cli' && isOAuthProvider && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Authorization</label>
              <OAuthFlow
                provider={selectedProvider}
                draft={draft}
                setDraft={setDraft}
                onSuccess={() => setOauthDone(true)}
              />
            </div>
          )}

          {/* CLI: executable path */}
          {draft.category === 'cli' && !isOAuthProvider && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Executable Path</label>
              <input
                style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
                value={draft.baseUrl || ''}
                onChange={e => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="/usr/local/bin/gemini"
              />
            </div>
          )}

          {/* Vendor & Proxy: API Key */}
          {draft.category !== 'cli' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {draft.category === 'proxy' ? 'API Key (Optional)' : 'API Key'}
                </label>
                {selectedProvider?.url && (
                  <a href="#" onClick={e => { e.preventDefault(); window.electron.ipcRenderer.invoke('open-url', { url: selectedProvider.url }); }} style={{ fontSize: '11px', color: 'var(--accent, #6366f1)', textDecoration: 'none' }}>
                    Get API Key ↗
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'monospace' }}
                  type="password"
                  value={draft.apiKey}
                  onChange={e => { setDraft({ ...draft, apiKey: e.target.value }); setVerifyStatus('idle'); }}
                  placeholder={selectedProvider?.hint || 'sk-...'}
                />
                <button
                  type="button"
                  style={{ padding: '0 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={handleVerify}
                  disabled={(draft.category === 'proxy' ? !draft.baseUrl : !draft.apiKey) || verifyStatus === 'checking'}
                >
                  {verifyStatus === 'checking' ? 'Wait...' : 'Verify'}
                </button>
              </div>
              {verifyStatus === 'success' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
                  <div style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={12} /> {verifyMsg}
                  </div>
                </div>
              )}
              {verifyStatus === 'error' && (
                <div style={{ fontSize: '12px', color: '#ef4444' }}>{verifyMsg}</div>
              )}
            </div>
          )}

          {/* Proxy: Base URL */}
          {draft.category === 'proxy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Custom Base URL</label>
              <input
                style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
                value={draft.baseUrl || ''}
                onChange={e => { setDraft({ ...draft, baseUrl: e.target.value }); setVerifyStatus('idle'); }}
                placeholder="http://127.0.0.1:1234/v1"
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Local endpoint serving the proxy. Include /v1 path.</span>
            </div>
          )}

          {/* Playground / Test Chat Modal Module */}
          <PlaygroundTest 
            draft={draft}
            selectedProvider={selectedProvider}
          />

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '14px', borderTop: '1px solid var(--border)', marginTop: '8px' }}>
            {!isCreating && (
              <button onClick={handleDelete} style={{ padding: '7px', marginRight: 'auto', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <Trash2 size={14} />
              </button>
            )}
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', background: 'var(--text-primary)', color: 'var(--app-bg)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
            >
              {isCreating ? 'Save Connection' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionManagerModal;
