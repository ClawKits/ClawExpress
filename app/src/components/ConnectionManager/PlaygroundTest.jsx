import React, { useState } from 'react';
import styles from '../ConfigPanel/ConfigPanel.module.css';
import Dropdown from '../Dropdown/Dropdown';

const PlaygroundTest = ({ draft, selectedProvider }) => {
  const [prompt, setPrompt] = useState('Hello! I am ready!');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // CLI providers don't fetch models in Connection Hub, so always use the provider defaults.
  const isCli = selectedProvider?.category === 'cli';
  const availableModels = isCli ? (selectedProvider?.models || []) : ((draft?.models?.length > 0) ? draft.models : (selectedProvider?.models || []));
  const defaultModel = availableModels.length > 0 ? availableModels[0] : '';
  const [testModel, setTestModel] = useState(defaultModel);
  const [useCustomModel, setUseCustomModel] = useState(availableModels.length === 0);
  const [customModelStr, setCustomModelStr] = useState(selectedProvider?.defaultModel || '');

  // Keep testModel in sync with availableModels
  React.useEffect(() => {
    if (availableModels.length > 0) {
      setUseCustomModel(false);
      if (!availableModels.includes(testModel)) {
        setTestModel(availableModels[0]);
      }
    } else {
      setUseCustomModel(true);
    }
  }, [availableModels]);

  if (!selectedProvider) return null;

  if (isCli) {
    return (
      <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '8px' }}>
          <span style={{ color: '#fbbf24', fontSize: '12px' }}>ℹ️</span> CLI Connection Ready
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Playground testing is not available for CLI providers at this step because the local engine is not yet installed. Your authentication token has been saved successfully. Please click <b>Save Connection</b> to finish, and then proceed to install the <b>OpenClaw Engine</b>.
        </div>
      </div>
    );
  }

  const finalModel = useCustomModel ? customModelStr : testModel;

  const handleTest = async () => {
    if (!finalModel) return;
    setLoading(true);
    setResult(null);

    try {
      const resp = await window.electron?.ipcRenderer.invoke('test-model-chat', {
        providerId: draft.providerId || selectedProvider?.id,
        model: finalModel,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl,
        prompt: prompt,
      });
      setResult(resp || { success: false, error: 'No response from IPC' });
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };



  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '12px' }}>
        <span style={{ color: '#00dc82', fontSize: '12px' }}>⚡</span> Test Connect & Chat (Playground)
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Model {availableModels.length > 0 && `(${availableModels.length} available)`}
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {useCustomModel ? (
                 <input 
                   type="text" 
                   value={customModelStr} 
                   onChange={e => setCustomModelStr(e.target.value)} 
                   placeholder="Enter model name..." 
                   style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
                 />
              ) : (
                 <div style={{ flex: 1, minWidth: 0 }}>
                   <Dropdown 
                     value={testModel} 
                     onChange={setTestModel} 
                     options={availableModels}
                     minWidth="100%"
                     dropUp={true}
                   />
                 </div>
              )}
              <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                 <input type="checkbox" checked={useCustomModel} onChange={e => setUseCustomModel(e.target.checked)} />
                 Custom
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Test Message</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                value={prompt} 
                onChange={e => setPrompt(e.target.value)} 
                placeholder="Enter test message..." 
                style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTest();
                }}
              />
              <button 
                type="button" 
                onClick={handleTest} 
                disabled={loading || !finalModel || (!draft.apiKey && selectedProvider.id !== 'custom' && selectedProvider.category !== 'proxy')}
                style={{ padding: '0 18px', borderRadius: '6px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? 'Sending' : 'Send'}
              </button>
            </div>
          </div>

          {(result || loading) && (
            <div style={{ 
              background: 'rgba(0,0,0,0.2)', 
              padding: '12px', 
              borderRadius: '6px', 
              border: '1px solid var(--border)',
              minHeight: '60px',
              maxHeight: '250px',
              overflowY: 'auto',
              fontSize: '13px',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              color: result?.success === false ? '#ff5555' : '#00dc82'
            }}>
              {loading ? <span style={{ opacity: 0.6, color: 'var(--text-color)' }}>...Waiting for AI reply...</span> : (
                result.success ? `🤖 AI: ${result.text}` : `❌ Error: ${result.error}`
              )}
            </div>
          )}
      </div>
    </div>
  );
};

export default PlaygroundTest;
