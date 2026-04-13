import React, { useState } from 'react';
import styles from './ConfigPanel.module.css';

const PlaygroundTest = ({ activeConnection, finalModel, activeProvider, customProxyTarget }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('Hello, are you responding well?');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleTest = async () => {
    if (!finalModel) return;
    setLoading(true);
    setResult(null);

    try {
      const resp = await window.electron?.ipcRenderer.invoke('test-model-chat', {
        providerId: activeProvider.id,
        model: finalModel,
        apiKey: activeConnection.apiKey,
        baseUrl: activeConnection.baseUrl,
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
    <div className={styles.playgroundContainer} style={{ marginTop: '16px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          width: '100%', 
          padding: '12px', 
          background: 'transparent', 
          border: 'none', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          cursor: 'pointer',
          color: 'var(--text-color)',
          fontWeight: '500'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#00dc82' }}>⚡</span> Test Connect & Chat (Playground)
        </span>
        <span style={{ fontSize: '12px', opacity: 0.7 }}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input 
              type="text" 
              value={prompt} 
              onChange={e => setPrompt(e.target.value)} 
              className={styles.input} 
              placeholder="Enter a test prompt..." 
              style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-color)' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTest();
              }}
            />
            <button 
              type="button" 
              className={styles.btnSecondary} 
              onClick={handleTest} 
              disabled={loading || !finalModel || (!activeConnection.apiKey && activeProvider.id !== 'custom' && activeProvider.id !== 'ollama')}
              style={{ background: 'var(--primary-color)', color: '#fff', border: 'none', padding: '0 16px', borderRadius: '4px', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Sending...' : 'Send'}
            </button>
          </div>

          {(result || loading) && (
            <div style={{ 
              background: 'var(--bg-dark)', 
              padding: '12px', 
              borderRadius: '4px', 
              border: '1px solid var(--border-color)',
              minHeight: '60px',
              fontSize: '13px',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              color: result?.success === false ? '#ff5555' : 'var(--text-color)'
            }}>
              {loading ? <span style={{ opacity: 0.6 }}>...Waiting for AI response...</span> : (
                result.success ? `🤖: ${result.text}` : `❌ Error: ${result.error}`
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlaygroundTest;
