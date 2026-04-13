import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { RefreshCw, CheckCircle2, AlertTriangle, PlaySquare, Clock, History, Maximize, Minimize, Save } from 'lucide-react';
import { toast } from '../Toast/Toast';

export default function RawConfigEditor({ platformId, onSaveAndRestart, isFullscreen, onToggleFullscreen }) {
  const [content, setContent] = useState('// Loading...');
  const [isValid, setIsValid] = useState(true);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    loadConfig();
    loadHistory();
  }, [platformId]);

  const loadConfig = async () => {
    try {
      const res = await window.electron.ipcRenderer.invoke('read-raw-config');
      if (res.success) {
        setContent(res.text);
        setIsValid(true);
      } else {
        toast.error(`Failed to load config: ${res.reason}`);
      }
    } catch (e) {
      toast.error('Error loading config.');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await window.electron.ipcRenderer.invoke('get-config-history');
      if (res.success) {
        setHistory(res.history);
      }
    } catch (e) { }
  };

  const handleEditorChange = (value) => {
    setContent(value);
    try {
      JSON.parse(value);
      setIsValid(true);
    } catch (e) {
      setIsValid(false);
    }
  };

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
  };

  const formatDoc = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument').run();
    }
  };

  const performSave = async (shouldRestart) => {
    if (!isValid) {
      toast.error('Syntax Error: Cannot save invalid JSON.');
      return;
    }
    
    // Auto-format before saving
    formatDoc();

    // Small delay to let format finish visually
    setTimeout(async () => {
      const formattedContent = editorRef.current.getValue() || content;
      try {
        const res = await window.electron.ipcRenderer.invoke('write-raw-config', { rawJson: formattedContent });
        if (res.success) {
          toast.success(shouldRestart ? 'Config saved & Restarting...' : 'Raw Config Saved successfully!');
          loadHistory(); // Reload history
          if (shouldRestart) {
            onSaveAndRestart();
          }
        } else {
          toast.error(`Error saving: ${res.reason}`);
        }
      } catch (e) {
        toast.error('Error saving config.');
      }
    }, 100);
  };

  const restoreHistory = async (filename) => {
    if (!window.confirm(`Are you sure you want to restore from ${filename}? Current changes will be overwritten.`)) return;
    try {
      const res = await window.electron.ipcRenderer.invoke('restore-config-history', { filename });
      if (res.success) {
        setContent(res.text);
        setIsValid(true);
        toast.success('History restored. Please review and click Save & Restart to apply.');
        setShowHistory(false);
      } else {
        toast.error(`Failed to restore: ${res.reason}`);
      }
    } catch (e) {
      toast.error('Error reading history');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', flex: 1, minHeight: '400px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, paddingLeft: '4px' }}>
          Directly edit the `openclaw.json` configuration file.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={onToggleFullscreen} 
            style={{ 
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-primary)', padding: '5px 10px', borderRadius: '5px',
              cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            {isFullscreen ? <><Minimize size={13}/> Exit Fullscreen</> : <><Maximize size={13}/> Fullscreen</>}
          </button>
          <div style={{ position: 'relative' }}>
             <button 
                onClick={() => setShowHistory(!showHistory)}
                style={{ 
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-primary)', padding: '5px 10px', borderRadius: '5px',
                  cursor: 'pointer', fontSize: '12px',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
             >
               <History size={13} /> {showHistory ? 'Hide History' : 'History'}
             </button>
             {showHistory && (
               <div style={{
                 position: 'absolute', right: 0, top: 'calc(100% + 5px)', zIndex: 10,
                 background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                 borderRadius: '6px', minWidth: '220px', maxHeight: '250px', overflowY: 'auto',
                 boxShadow: '0 4px 12px rgba(0,0,0,0.5)', padding: '8px 0'
               }}>
                 <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-color)', marginBottom: '4px' }}>
                   Recent Backups
                 </div>
                 {history.length === 0 ? (
                   <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>No history available.</div>
                 ) : (
                   history.map(h => (
                     <div key={h.filename} onClick={() => restoreHistory(h.filename)} style={{
                       padding: '6px 12px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                       color: 'var(--text-primary)', borderBottom: '1px solid rgba(255,255,255,0.02)'
                     }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                       <Clock size={11} color="var(--text-muted)" />
                       {h.dateStr}
                     </div>
                   ))
                 )}
               </div>
             )}
          </div>
          <button 
            onClick={formatDoc} 
            style={{ 
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-primary)', padding: '5px 10px', borderRadius: '5px',
              cursor: 'pointer', fontSize: '12px'
            }}
          >
            Format
          </button>
        </div>
      </div>

      <div style={{ flex: 1, borderRadius: '8px', overflow: 'hidden', border: isValid ? '1px solid rgba(255,255,255,0.1)' : '1px solid #ef4444' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '13px' }}>
            Loading Editor...
          </div>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="json"
            theme="vs-dark"
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: '"Fira Code", monospace',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              formatOnPaste: true,
            }}
          />
        )}
      </div>

      <div style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
        padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div>
          {!isValid ? (
            <span style={{ color: '#ef4444', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} /> Syntax Error detected.
            </span>
          ) : (
            <span style={{ color: '#22c55e', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
              <CheckCircle2 size={14} /> JSON Valid
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            disabled={!isValid}
            onClick={() => performSave(false)}
            style={{
              background: 'transparent',
              color: isValid ? 'var(--text-secondary)' : 'var(--text-muted)',
              border: '1px solid var(--border)', padding: '8px 16px', borderRadius: '5px', cursor: isValid ? 'pointer' : 'not-allowed',
              fontWeight: 500, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-primary)'
            }}
          >
            <Save size={14} /> Save
          </button>
          
          <button 
            disabled={!isValid}
            onClick={() => performSave(true)}
            style={{
              background: isValid ? 'var(--text-primary)' : 'rgba(255,255,255,0.1)',
              color: isValid ? 'var(--app-bg)' : 'var(--text-muted)',
              border: 'none', padding: '8px 16px', borderRadius: '5px', cursor: isValid ? 'pointer' : 'not-allowed',
              fontWeight: 500, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-primary)'
            }}
          >
            <PlaySquare size={14} /> Save &amp; Restart
          </button>
        </div>
      </div>

    </div>
  );
}
