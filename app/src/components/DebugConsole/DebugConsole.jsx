import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, RefreshCw, FileText, Trash2, ChevronDown } from 'lucide-react';

const LEVEL_COLORS = {
  INFO:  'var(--text-secondary)',
  DEBUG: '#60a5fa',
  WARN:  '#facc15',
  ERROR: '#f87171',
};

const DebugConsole = () => {
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef(null);
  const endRef = useRef(null);

  // Keyboard shortcut: Ctrl+Shift+L
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Fetch existing logs when opened
  useEffect(() => {
    if (!visible) return;
    window.electron?.ipcRenderer.invoke('get-logs', { n: 300 }).then(lines => {
      if (Array.isArray(lines)) {
        setLogs(lines.map(raw => parseLine(raw)));
      }
    });
  }, [visible]);

  // Live stream new log entries from main process
  useEffect(() => {
    const cleanup = window.electron?.ipcRenderer.on('app-log', ({ level, text, ts }) => {
      setLogs(prev => {
        const next = [...prev, { level, text, ts }];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    return cleanup;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const parseLine = (raw) => {
    // "[2026-04-06T..] [LEVEL] message"
    const m = raw.match(/^\[(.+?)\] \[(\w+)\] (.+)$/s);
    if (m) return { ts: m[1], level: m[2], text: m[3] };
    return { ts: '', level: 'INFO', text: raw };
  };

  const handleScroll = () => {
    if (!bodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = bodyRef.current;
    setAutoScroll(scrollTop + clientHeight >= scrollHeight - 32);
  };

  const filtered = filter
    ? logs.filter(l => l.text.toLowerCase().includes(filter.toLowerCase()) || l.level.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: '60px', right: 0, height: '300px',
      background: '#0a0a0a', borderTop: '1px solid #2a2a2a', zIndex: 9999,
      display: 'flex', flexDirection: 'column', fontFamily: 'monospace', fontSize: '12px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 12px', borderBottom: '1px solid #2a2a2a',
        background: '#111', flexShrink: 0,
      }}>
        <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: '11px' }}>DEBUG CONSOLE</span>
        <span style={{ color: '#555', fontSize: '11px' }}>Ctrl+Shift+L</span>
        <div style={{ flex: 1 }} />
        <input
          placeholder="Filter logs..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            background: '#1a1a1a', border: '1px solid #333', color: '#ccc',
            padding: '3px 8px', borderRadius: '4px', fontSize: '11px', width: '200px',
            outline: 'none',
          }}
        />
        <button
          onClick={() => window.electron?.ipcRenderer.invoke('get-logs', { n: 300 }).then(lines => {
            if (Array.isArray(lines)) setLogs(lines.map(parseLine));
          })}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '4px' }}
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={() => window.electron?.ipcRenderer.invoke('open-log-file')}
          title="Open log file"
          style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '4px' }}
        >
          <FileText size={13} />
        </button>
        <button
          onClick={() => setLogs([])}
          title="Clear"
          style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '4px' }}
        >
          <Trash2 size={13} />
        </button>
        {!autoScroll && (
          <button
            onClick={() => { setAutoScroll(true); endRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            title="Scroll to bottom"
            style={{ background: '#1c3d5a', border: '1px solid #60a5fa', color: '#60a5fa', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <ChevronDown size={11} /> Bottom
          </button>
        )}
        <button
          onClick={() => setVisible(false)}
          style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '4px' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Log Body */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 12px' }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: '#444', padding: '20px 0', textAlign: 'center' }}>No logs yet</div>
        ) : (
          filtered.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', lineHeight: '1.6', borderBottom: '1px solid #111' }}>
              <span style={{ color: '#444', flexShrink: 0, fontSize: '10px', paddingTop: '2px' }}>
                {l.ts ? l.ts.substring(11, 23) : ''}
              </span>
              <span style={{ color: LEVEL_COLORS[l.level] || '#ccc', flexShrink: 0, width: '40px', fontSize: '10px', paddingTop: '2px' }}>
                {l.level}
              </span>
              <span style={{ color: l.level === 'ERROR' ? '#fca5a5' : '#d1d5db', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {l.text}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Status bar */}
      <div style={{
        padding: '3px 12px', borderTop: '1px solid #1a1a1a',
        color: '#444', fontSize: '10px', display: 'flex', gap: '16px', flexShrink: 0,
      }}>
        <span>{filtered.length} lines</span>
        {filter && <span>filtered by: "{filter}"</span>}
        <span style={{ color: autoScroll ? '#4ade80' : '#555' }}>
          {autoScroll ? '⬤ live' : '⬤ paused'}
        </span>
      </div>
    </div>
  );
};

export default DebugConsole;
