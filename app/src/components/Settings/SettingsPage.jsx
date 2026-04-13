import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Moon, Sun, Monitor, FolderOpen } from 'lucide-react';
import Topbar from '../Topbar/Topbar';

// ── Sub-components ────────────────────────────────────────────────────────────

const SECTION = ({ title, children }) => (
  <div style={{ marginBottom: '36px' }}>
    <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-muted)', paddingBottom: '12px', borderBottom: '1px solid var(--border)', marginBottom: '20px' }}>
      {title}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {children}
    </div>
  </div>
);

const ROW = ({ label, hint, children }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '40px' }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '3px' }}>{label}</div>
      {hint && <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{hint}</div>}
    </div>
    <div style={{ flexShrink: 0 }}>
      {children}
    </div>
  </div>
);

const Toggle = ({ value, onChange, disabled = false }) => (
  <div
    onClick={() => !disabled && onChange(!value)}
    style={{
      width: '40px', height: '22px', borderRadius: '11px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: value ? '#22c55e' : 'var(--border)',
      position: 'relative', transition: 'background 0.2s',
      opacity: disabled ? 0.5 : 1,
    }}
  >
    <div style={{
      position: 'absolute', top: '3px',
      left: value ? '21px' : '3px',
      width: '16px', height: '16px', borderRadius: '50%',
      background: '#fff', transition: 'left 0.2s',
    }} />
  </div>
);

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  theme: 'dark',
  launchOnStartup: false,
  minimizeToTray: true,
};

// ── Component ─────────────────────────────────────────────────────────────────

const SettingsPage = () => {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savedBadge, setSavedBadge] = useState(false);
  const [appVersion, setAppVersion] = useState('...');
  const isFirstRender = useRef(true);
  const saveTimer = useRef(null);
  const badgeTimer = useRef(null);

  // ── Load settings from main process (userData/settings.json) ────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [saved, version] = await Promise.all([
          window.electron?.ipcRenderer.invoke('settings-load'),
          window.electron?.ipcRenderer.invoke('get-app-version'),
        ]);
        setPrefs({ ...DEFAULTS, ...saved });
        if (version) setAppVersion(version);
      } catch (e) {
        console.warn('[SettingsPage] Failed to load settings:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Apply theme immediately + auto-save on every prefs change
  useEffect(() => {
    if (loading) return;
    document.documentElement.setAttribute('data-theme', prefs.theme);

    // Skip saving on the very first render after load
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Debounce: wait 300ms after last change before writing to disk
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.electron?.ipcRenderer.invoke('settings-save', prefs);
        setSavedBadge(true);
        clearTimeout(badgeTimer.current);
        badgeTimer.current = setTimeout(() => setSavedBadge(false), 1500);
      } catch (e) {
        console.error('[SettingsPage] Auto-save failed:', e);
      }
    }, 300);

    return () => clearTimeout(saveTimer.current);
  }, [prefs, loading]);

  const set = (key, value) => setPrefs(p => ({ ...p, [key]: value }));

  // ── Open userData folder ─────────────────────────────────────────────────────
  const handleOpenFolder = () => {
    window.electron?.ipcRenderer.invoke('open-user-data');
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--app-bg)' }}>
        <Topbar title="Settings" />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          Loading settings…
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', backgroundColor: 'var(--app-bg)' }}>
      <Topbar title="Settings" />

      <div style={{ padding: '40px', maxWidth: '720px' }}>

        {/* ── Appearance ── */}
        <SECTION title="Appearance">
          <ROW label="Theme" hint="Controls the color scheme of the application.">
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                ['dark',   <Moon size={13} />],
                ['light',  <Sun size={13} />],
                ['system', <Monitor size={13} />],
              ].map(([val, icon]) => (
                <button
                  key={val}
                  onClick={() => set('theme', val)}
                  style={{
                    background: prefs.theme === val ? 'var(--text-primary)' : 'transparent',
                    color: prefs.theme === val ? 'var(--app-bg)' : 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                    padding: '6px 14px', borderRadius: '5px',
                    cursor: 'pointer', fontSize: '12px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontFamily: 'var(--font-primary)', textTransform: 'capitalize',
                    transition: 'all 0.2s',
                  }}
                >
                  {icon} {val}
                </button>
              ))}
            </div>
          </ROW>
        </SECTION>

        {/* ── Startup ── */}
        <SECTION title="Startup">
          <ROW
            label="Launch at system startup"
            hint="Automatically open ClawExpress when Windows starts."
          >
            <Toggle value={prefs.launchOnStartup} onChange={v => set('launchOnStartup', v)} />
          </ROW>
          <ROW
            label="Minimize to system tray"
            hint="Keep running in the background when window is closed. A tray icon will appear."
          >
            <Toggle value={prefs.minimizeToTray} onChange={v => set('minimizeToTray', v)} />
          </ROW>
        </SECTION>

        {/* ── About ── */}
        <SECTION title="About">
          <ROW label="Vision" hint="A unified desktop platform for running, managing, and interacting with your AI agent applications." />
          <ROW label="Community" hint="Have questions or feature ideas? Join our official Discord server!">
            <button
              onClick={() => window.electron?.ipcRenderer.invoke('open-url', 'https://discord.gg/qMx3jkWCs')}
              style={{
                background: '#5865F2', border: '1px solid #5865F2',
                color: '#fff', padding: '6px 12px', borderRadius: '5px',
                cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: '6px',
                fontFamily: 'var(--font-primary)', transition: 'all 0.15s',
                boxShadow: '0 2px 4px rgba(88, 101, 242, 0.2)'
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              Join Discord
            </button>
          </ROW>
          <div style={{ height: '1px', background: 'var(--border)', margin: '10px 0' }}></div>
          <ROW label="ClawExpress version" hint="">
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              v{appVersion}
            </span>
          </ROW>
          <ROW label="Data directory" hint="Where platform configs, logs, and settings are stored.">
            <button
              onClick={handleOpenFolder}
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: '5px',
                cursor: 'pointer', fontSize: '12px',
                display: 'flex', alignItems: 'center', gap: '6px',
                fontFamily: 'var(--font-primary)', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <FolderOpen size={13} /> Open Folder
            </button>
          </ROW>
        </SECTION>

        {/* ── Auto-save indicator ── */}
        <div style={{ height: '24px', display: 'flex', alignItems: 'center' }}>
          {savedBadge && (
            <span style={{
              fontSize: '12px', color: '#22c55e',
              display: 'flex', alignItems: 'center', gap: '4px',
              opacity: savedBadge ? 1 : 0, transition: 'opacity 0.3s',
            }}>
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
        </div>

      </div>
    </div>
  );
};

export default SettingsPage;
