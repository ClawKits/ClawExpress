import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, Trash2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useConnectionStore } from '../../store/useConnectionStore';
import { usePlatformStore } from '../../store/usePlatformStore';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import Dropdown from '../Dropdown/Dropdown';
import { toast } from '../Toast/Toast';
import styles from './ConnectionManager.module.css';
import PlaygroundTest from './PlaygroundTest';
import { AlertCircle, FlaskConical, Plus } from 'lucide-react';

const AddCustomModelModal = ({ provider, onAdd, onClose, testModel, setDraft }) => {
  const [newModel, setNewModel] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const finalModelStr = provider.id === 'codex' && newModel.trim() && !newModel.trim().startsWith('openai-codex/') ? `openai-codex/${newModel.trim()}` : newModel.trim();

  const handleTest = async () => {
    if (!finalModelStr) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testModel(finalModelStr);
      setTestResult(res?.success ? 'success' : 'fail');
      if (res?.newTokens) {
        setDraft(d => ({ ...d, apiKey: res.newTokens.access_token, oauthTokens: res.newTokens }));
      }
      if (!res?.success) toast.error(`Test failed: ${res?.error || 'Unknown error'}`);
      else toast.success(`Test passed for ${finalModelStr}`);
    } catch (e) {
      setTestResult('fail');
      toast.error('Test failed: ' + e.message);
    } finally {
      setIsTesting(false);
    }
  };

  const submitAdd = () => {
    if (finalModelStr) onAdd(finalModelStr);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ backgroundColor: 'var(--card-bg)', borderRadius: '12px', width: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', color: 'var(--text-primary)' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: '6px', marginRight: '16px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ff5f56' }} />
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#27c93f' }} />
          </div>
          <div style={{ flex: 1, fontSize: '15px', fontWeight: 600 }}>Add Custom Model</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Model ID</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              autoFocus
              value={newModel}
              onChange={e => setNewModel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') onClose(); }}
              placeholder={provider.id === 'cli_gemini' ? 'e.g. gemini-2.5-pro' : 'e.g. claude-opus-4-5'}
              style={{ flex: 1, padding: '10px 12px', borderRadius: '6px', border: '1px solid #d97757', background: 'transparent', outline: 'none', fontSize: '14px', color: 'var(--text-primary)', transition: 'border-color 0.2s', boxSizing: 'border-box' }}
            />
            <button 
              onClick={handleTest}
              disabled={!finalModelStr || isTesting}
              style={{ padding: '0 16px', borderRadius: '6px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', fontSize: '13px', cursor: (!finalModelStr || isTesting) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isTesting ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />}
              Test
            </button>
          </div>
          {finalModelStr && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Sent to provider as: <code style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--border)' }}>{finalModelStr}</code>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submitAdd} disabled={!finalModelStr} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#d9a691', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: !finalModelStr ? 'not-allowed' : 'pointer' }}>Add Model</button>
        </div>
      </div>
    </div>
  );
};
const ModelTagsManager = ({ draft, setDraft, provider }) => {
  const [testResults, setTestResults] = useState({}); // { [model]: 'success' | 'fail' | 'testing' }
  const [newModel, setNewModel] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const prefixHint = provider.id === 'codex' ? 'openai-codex/' : '';

  const handleAdd = (m) => {
    if (!draft.models.includes(m)) setDraft(d => ({ ...d, models: [...(d.models || []), m] }));
    setIsAdding(false);
  };

  const handleRemove = (m) => {
    setDraft(d => ({ ...d, models: (d.models || []).filter(x => x !== m) }));
  };

  const testModel = async (model) => {
    return await window.electron.ipcRenderer.invoke('test-model-chat', {
      providerId: draft.providerId,
      model: model,
      apiKey: draft.apiKey,
      oauthTokens: draft.oauthTokens,
      baseUrl: draft.baseUrl,
      prompt: 'Hello! I am ready!'
    });
  };

  const handleTest = async (model) => {
    setTestResults(prev => ({ ...prev, [model]: 'testing' }));
    try {
      const res = await testModel(model);
      setTestResults(prev => ({ ...prev, [model]: res?.success ? 'success' : 'fail' }));
      if (res?.newTokens) {
        setDraft(d => ({ ...d, apiKey: res.newTokens.access_token, oauthTokens: res.newTokens }));
      }
      if (!res?.success) toast.error(`Test failed: ${res?.error || 'Unknown error'}`);
      else toast.success(`Test passed for ${model}`);
    } catch (e) {
      setTestResults(prev => ({ ...prev, [model]: 'fail' }));
      toast.error('Test failed: ' + e.message);
    }
  };

  return (
    <div style={{ padding: '12px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)', marginTop: '8px' }}>
      <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>Available Models</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {(draft.models || []).map(m => {
          const status = testResults[m];
          return (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--app-bg)', border: `1px solid ${status === 'success' ? '#22c55e' : status === 'fail' ? '#ef4444' : 'var(--border)'}`, borderRadius: '4px', padding: '4px 8px', fontSize: '11.5px', color: 'var(--text-primary)' }}>
              {status === 'success' && <CheckCircle2 size={12} color="#22c55e" />}
              {status === 'fail' && <AlertCircle size={12} color="#ef4444" />}
              <span>{m}</span>
              <div style={{ width: '1px', height: '12px', background: 'var(--border)', margin: '0 2px' }}></div>
              <button onClick={() => handleTest(m)} disabled={status === 'testing'} title="Test this model" style={{ background: 'transparent', border: 'none', padding: '2px', cursor: status === 'testing' ? 'wait' : 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                {status === 'testing' ? <Loader2 size={12} className="spin" /> : <FlaskConical size={12} />}
              </button>
              <button onClick={() => handleRemove(m)} title="Remove model" style={{ background: 'transparent', border: 'none', padding: '2px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={12} />
              </button>
            </div>
          );
        })}
        {isAdding && (
          <AddCustomModelModal 
            provider={provider} 
            onAdd={handleAdd} 
            onClose={() => setIsAdding(false)} 
            testModel={testModel} 
            setDraft={setDraft} 
          />
        )}
        {!isAdding && (
          <button onClick={() => setIsAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '4px', padding: '4px 8px', fontSize: '11.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <Plus size={12} /> Add Model
          </button>
        )}
      </div>
    </div>
  );
};

// ─── OAuth Flow Subview ───────────────────────────────────────────────────────
const OAuthFlow = ({ provider, draft, setDraft, onSuccess }) => {
  const [oauthState, setOauthState] = useState(draft.apiKey ? 'authenticated' : 'idle'); // idle|waiting|success|fallback|authenticated
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
      let finalOauthConfig = { ...provider.oauth };
      
      // 1. Try to load from environment variables first (.env / .env.local)
      if (provider.id === 'cli_gemini') {
        if (import.meta.env.VITE_GEMINI_CLIENT_ID) {
          finalOauthConfig.clientId = import.meta.env.VITE_GEMINI_CLIENT_ID;
        }
        if (import.meta.env.VITE_GEMINI_CLIENT_SECRET) {
          finalOauthConfig.clientSecret = import.meta.env.VITE_GEMINI_CLIENT_SECRET;
        }
      }

      // 2. Load runtime OAuth credentials from Cloudflare if they are still missing
      if (!finalOauthConfig.clientId || !finalOauthConfig.clientSecret) {
        try {
          const res = await fetch('https://clawexpress-api.pages.dev/api/v1/config/oauth');
          const data = await res.json();
          if (data && data[provider.id]) {
            finalOauthConfig.clientId = finalOauthConfig.clientId || data[provider.id].clientId;
            finalOauthConfig.clientSecret = finalOauthConfig.clientSecret || data[provider.id].clientSecret;
          }
        } catch (fetchErr) {
          console.warn('Failed to load runtime OAuth config:', fetchErr);
        }
      }

      if (!finalOauthConfig.clientId) {
        throw new Error('OAuth Client ID is missing. Please check the backend configuration.');
      }

      const res = await window.electron.ipcRenderer.invoke('oauth-start', {
        providerId: provider.id,
        oauthConfig: finalOauthConfig,
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
        <ModelTagsManager draft={draft} setDraft={setDraft} provider={provider} />
      </div>
    );
  }

  // ── Authenticated (Already have API Key) ──────────────────────────────────
  if (oauthState === 'authenticated') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: '8px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckCircle2 size={16} color="#22c55e" />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#22c55e' }}>Authenticated</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>This connection already has a valid token.</div>
            </div>
          </div>
          <button 
            onClick={() => setOauthState('idle')}
            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Re-authenticate
          </button>
        </div>
        <ModelTagsManager draft={draft} setDraft={setDraft} provider={provider} />
      </div>
    );
  }

  return null;
};

// ─── Main Modal ───────────────────────────────────────────────────────────────
const ConnectionManagerModal = ({ connectionId, category, onClose }) => {
  const { connections, addConnection, updateConnection, removeConnection } = useConnectionStore();
  const { platforms, updatePlatform } = usePlatformStore();

  const isCreating = !connectionId;
  const [draft, setDraft] = useState(null);
  const [verifyStatus, setVerifyStatus] = useState('idle');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [oauthDone, setOauthDone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

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

  const handleDelete = () => {
    const affectedPlatforms = platforms?.filter(p => p.env && p.env.CLAWEXPRESS_CONNECTION_ID === connectionId) || [];

    if (affectedPlatforms.length > 0) {
      const platformNames = affectedPlatforms.map(p => p.name).join(', ');
      setDeleteConfirm({
        type: 'in-use',
        title: 'Configuration In Use Warning',
        message: `Connection "${draft.name}" is currently linked to platform: ${platformNames}.\n\nIf deleted, the system will automatically unlink it from these platforms and reset OpenClaw to default (unlinked). Are you sure you want to proceed?`,
        platforms: affectedPlatforms
      });
    } else {
      setDeleteConfirm({
        type: 'normal',
        title: 'Delete API Connection',
        message: `Are you sure you want to permanently delete connection "${draft.name}"? This action cannot be undone.`
      });
    }
  };

  const processDelete = async () => {
    if (deleteConfirm.type === 'in-use') {
      const ALL_REMOVABLE_KEYS = PROVIDERS.flatMap(p => [
        p.envKey,
        p.envKey.replace(/(_API_KEY|_TOKEN|_KEY)$/, '_BASE_URL'),
      ]);

      for (const p of deleteConfirm.platforms) {
        const newEnv = { ...p.env };
        delete newEnv.CLAWEXPRESS_CONNECTION_ID;
        delete newEnv.CLAWEXPRESS_PROVIDER;
        
        await updatePlatform(p.id, { env: newEnv });
        
        if (p.cwd) {
          try {
            await window.electron?.ipcRenderer.invoke('write-platform-config', {
              cwd: p.cwd,
              env: {}, 
              envToRemove: ALL_REMOVABLE_KEYS,
            });
          } catch (err) {
            console.error('Failed to reset openclaw Gateway config', err);
          }
        }
      }
    }

    await removeConnection(connectionId);
    setDeleteConfirm(null);
    onClose();
  };

  const getModalTitle = () => {
    if (!isCreating) return 'Edit Connection';
    if (draft.category === 'cli') return `Connect ${selectedProvider?.label || 'OAuth/CLI'}`;
    if (draft.category === 'proxy') return 'Add Local/Proxy Connection';
    return 'Add API Key Connection';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '650px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{getModalTitle()}</div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '18px', overflowY: 'auto', minHeight: '450px' }}>

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
          {draft.category === 'cli' && selectedProvider && !isOAuthProvider && (
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
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 24px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--card-bg)', flexShrink: 0, borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
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

      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '400px', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: deleteConfirm.type === 'in-use' ? '#ef4444' : 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={16} /> {deleteConfirm.title}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {deleteConfirm.message}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
              <button 
                onClick={() => setDeleteConfirm(null)} 
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
              >
                Cancel
              </button>
              <button 
                onClick={processDelete} 
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionManagerModal;
