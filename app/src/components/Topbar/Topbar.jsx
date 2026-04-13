import React from 'react';
import { Minus, Square, X } from 'lucide-react';

/**
 * Topbar — Unified titlebar + page header (48px)
 *
 * Merges the Electron window controls with the page title and an optional
 * primary action slot. Replaces the old dual-layer header (36px titlebar +
 * 64px topbar = 100px) with a single cohesive bar.
 *
 * Usage:
 *   <Topbar title="Dashboard" />
 *   <Topbar title="Backups"><button>Create Backup</button></Topbar>
 */
const Topbar = ({ title, children }) => {
  return (
    <header
      className="topbar"
      style={{
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 0 0 32px',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    >
      {/* Left — Page title */}
      <h1
        style={{
          fontSize: '15px',
          fontWeight: 500,
          letterSpacing: '-0.3px',
          margin: 0,
          color: 'var(--text-primary)',
        }}
      >
        {title}
      </h1>

      {/* Right — Optional primary action + window controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0',
          height: '100%',
        }}
      >
        {/* Page-specific action slot */}
        {children && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              paddingRight: '16px',
              WebkitAppRegion: 'no-drag',
            }}
          >
            {children}
          </div>
        )}

        {/* Window controls */}
        <div
          style={{
            display: 'flex',
            height: '100%',
            WebkitAppRegion: 'no-drag',
          }}
        >
          <button
            onClick={() => window.electron?.ipcRenderer.invoke('window-min')}
            className="win-ctrl-btn"
            aria-label="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => window.electron?.ipcRenderer.invoke('window-max')}
            className="win-ctrl-btn"
            aria-label="Maximize"
          >
            <Square size={10} />
          </button>
          <button
            onClick={() => window.electron?.ipcRenderer.invoke('window-close')}
            className="win-ctrl-btn win-ctrl-close"
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Topbar;
