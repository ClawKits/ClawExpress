import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, Play, Square, Loader2, Plus } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useConnectionStore } from '../../store/useConnectionStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { PROVIDERS } from '../../constants/providers';
import CHANNEL_REGISTRY from '../../constants/channelRegistry';
import Topbar from '../Topbar/Topbar';

// Token channels keyed by envKey for O(1) lookup, with id preserved
const TOKEN_CHANNEL_MAP = Object.entries(CHANNEL_REGISTRY)
  .filter(([_, ch]) => ch.authType === 'token')
  .reduce((acc, [id, ch]) => { acc[ch.envKey] = { ...ch, id }; return acc; }, {});

// QR channels keyed by channel id (whatsapp, zalouser, ...)
const QR_CHANNEL_MAP = Object.entries(CHANNEL_REGISTRY)
  .filter(([_, ch]) => ch.authType === 'qr')
  .reduce((acc, [id, ch]) => { acc[id] = ch; return acc; }, {});

const formatUptime = (uptimeMs) => {
  if (!uptimeMs) return null;
  const mins = Math.floor(Math.max(0, Date.now() - uptimeMs) / 60000);
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `Up ${hrs}h ${mins % 60}m` : `Up ${mins}m`;
};

const STATUS_CONFIG = {
  RUNNING:  { color: '#22c55e', label: 'Running',  glow: true },
  STOPPED:  { color: '#525252', label: 'Stopped',  glow: false },
  STARTING: { color: '#f59e0b', label: 'Starting', glow: false },
  STOPPING: { color: '#f59e0b', label: 'Stopping', glow: false },
  ERROR:    { color: '#ef4444', label: 'Error',     glow: false },
};

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color }) => (
  <div style={{
    backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)',
    borderRadius: '8px', padding: '20px 24px',
  }}>
    <div style={{ fontSize: '28px', fontWeight: 500, letterSpacing: '-1px', lineHeight: 1, color }}>
      {value}
    </div>
    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>{label}</div>
    {sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
  </div>
);

// ─── Platform Card ────────────────────────────────────────────────────────────
const PlatformCard = ({ platform, linkedQrChannels, onStart, onStop }) => {
  const sc = STATUS_CONFIG[platform.status] || STATUS_CONFIG.STOPPED;
  const uptime = formatUptime(platform.uptime);
  const isTransitioning = platform.status === 'STARTING' || platform.status === 'STOPPING';

  // Token channels: only show if platform's channels config EXPLICITLY has enabled: true
  // This prevents token env vars (shared from Connection Hub) from showing badges on wrong platforms
  const channelConfig = platform.channels || {};
  const tokenChannels = Object.entries(platform.env || {})
    .filter(([k, v]) => {
      if (!TOKEN_CHANNEL_MAP[k] || !v?.trim()) return false;
      const chId = TOKEN_CHANNEL_MAP[k].id;
      const chCfg = channelConfig[chId];
      // Must be explicitly enabled in THIS platform's channels config
      return chCfg?.enabled === true;
    })
    .map(([k]) => ({ key: k, ...TOKEN_CHANNEL_MAP[k] }));

  // QR channels (WhatsApp, Zalo): session files belong to OpenClaw only.
  // Never show on other platforms to prevent cross-platform badge bleed.
  const platformId = platform.registryId || platform.id;
  const qrChannels = platformId === 'openclaw'
    ? [...linkedQrChannels]
        .filter(id => QR_CHANNEL_MAP[id])
        .map(id => ({ key: id, ...QR_CHANNEL_MAP[id] }))
    : [];

  const channels = [...tokenChannels, ...qrChannels];

  const btnStyle = platform.status === 'RUNNING'
    ? { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' }
    : platform.status === 'ERROR'
    ? { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' }
    : { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', border: 'rgba(34,197,94,0.3)' };

  return (
    <div style={{
      backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '16px 20px',
      borderLeft: `3px solid ${sc.color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Name + status badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              backgroundColor: sc.color,
              boxShadow: sc.glow ? `0 0 8px ${sc.color}60` : 'none',
            }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {platform.name}
            </span>
            <span style={{
              fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px',
              color: sc.color, background: `${sc.color}15`, padding: '2px 7px',
              borderRadius: '10px', flexShrink: 0,
            }}>
              {sc.label}
            </span>
          </div>

          {/* Meta row */}
          <div style={{
            display: 'flex', gap: '12px', flexWrap: 'wrap',
            fontSize: '12px', color: 'var(--text-muted)',
            marginTop: '6px', paddingLeft: '16px',
          }}>
            {platform.port    && <span>Port {platform.port}</span>}
            {platform.version && <span>v{String(platform.version).replace(/^v+/i, '')}</span>}
            {platform.method  && <span>{platform.method}</span>}
            {uptime           && <span style={{ color: '#22c55e' }}>{uptime}</span>}
          </div>

          {/* Configured channel pills */}
          {channels.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', paddingLeft: '16px', flexWrap: 'wrap' }}>
              {channels.map(ch => (
                <span key={ch.key} style={{
                  fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}>
                  {ch.icon} {ch.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Start / Stop button */}
        <button
          onClick={platform.status === 'RUNNING' ? onStop : onStart}
          disabled={isTransitioning}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
            padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
            cursor: isTransitioning ? 'not-allowed' : 'pointer',
            background: btnStyle.bg, color: btnStyle.color,
            border: `1px solid ${btnStyle.border}`,
            opacity: isTransitioning ? 0.5 : 1,
            fontFamily: 'var(--font-primary)',
            transition: 'opacity 0.2s',
          }}
        >
          {isTransitioning ? (
            <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              {platform.status === 'STARTING' ? 'Starting…' : 'Stopping…'}
            </>
          ) : platform.status === 'RUNNING' ? (
            <><Square size={12} /> Stop</>
          ) : (
            <><Play size={12} /> Start</>
          )}
        </button>
      </div>
    </div>
  );
};

// ─── Connections Health Panel ─────────────────────────────────────────────────
const ConnectionsPanel = ({ connections, onNavigate }) => {
  const [statuses, setStatuses] = useState({});
  const verifiedRef = useRef(new Set());

  useEffect(() => {
    const pending = connections.filter(
      c => c.enabled !== false && !verifiedRef.current.has(c.id)
    );
    pending.forEach(async (c) => {
      verifiedRef.current.add(c.id);
      setStatuses(s => ({ ...s, [c.id]: 'checking' }));
      try {
        const res = await window.electron?.ipcRenderer.invoke('verify-api-key', {
          providerId: c.providerId,
          apiKey: c.apiKey,
          baseUrl: c.baseUrl,
        });
        setStatuses(s => ({ ...s, [c.id]: res?.valid ? 'online' : 'error' }));
      } catch {
        setStatuses(s => ({ ...s, [c.id]: 'error' }));
      }
    });
  }, [connections]);

  const active = connections.filter(c => c.enabled !== false);

  return (
    <div>
      <div style={{
        fontSize: '12px', fontWeight: 500, textTransform: 'uppercase',
        letterSpacing: '0.4px', color: 'var(--text-muted)', marginBottom: '16px',
      }}>
        Connections Health
      </div>

      <div style={{
        backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: '8px', overflow: 'hidden',
      }}>
        {active.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No connections configured
          </div>
        ) : (
          active.map((c, i) => {
            const provider = PROVIDERS.find(p => p.id === c.providerId);
            const status = statuses[c.id];
            const statusColor = status === 'online' ? '#22c55e' : status === 'error' ? '#ef4444' : 'var(--text-muted)';
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '11px 16px',
                borderBottom: i < active.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                {/* Provider initials badge */}
                <div style={{
                  width: '30px', height: '30px', borderRadius: '6px', flexShrink: 0,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)',
                }}>
                  {provider?.label?.slice(0, 2).toUpperCase() ?? '??'}
                </div>

                {/* Name + provider */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {provider?.label ?? c.providerId}
                  </div>
                </div>

                {/* Status indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                  {status === 'checking' && <Loader2 size={12} color="var(--text-muted)" style={{ animation: 'spin 1s linear infinite' }} />}
                  {status === 'online'   && <CheckCircle2 size={13} color="#22c55e" />}
                  {status === 'error'    && <XCircle size={13} color="#ef4444" />}
                  <span style={{ fontSize: '11px', color: statusColor }}>
                    {status === 'checking' ? 'Checking' : status === 'online' ? 'Connected' : status === 'error' ? 'Error' : '—'}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {/* Manage link */}
        <button
          onClick={() => onNavigate('apikeys')}
          style={{
            width: '100%', padding: '10px 16px',
            background: 'transparent', fontFamily: 'var(--font-primary)',
            border: 'none', borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <Plus size={12} /> Manage Connections
        </button>
      </div>
    </div>
  );
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard = ({ onNavigate }) => {
  const { platforms, startPlatform, stopPlatform } = usePlatformStore();
  const { connections, loadConnections } = useConnectionStore();
  const requireAuth = useRequireAuth();
  const [linkedQrChannels, setLinkedQrChannels] = useState(new Set());
  // Map of platformId -> channels config object (e.g. { telegram: { enabled: false } })
  const [platformChannels, setPlatformChannels] = useState({});

  useEffect(() => { loadConnections(); }, []);

  // Load channels config from disk for all installed platforms
  useEffect(() => {
    platforms.forEach(async (p) => {
      try {
        const result = await window.electron?.ipcRenderer.invoke('read-platform-config', {
          cwd: p.cwd,
          platformId: p.registryId || p.id,
        });
        if (result?.channels) {
          setPlatformChannels(prev => ({ ...prev, [p.id]: result.channels }));
        }
      } catch (_) {}
    });
  }, [platforms.length]);

  // Check QR-based channels (WhatsApp, Zalo Personal) via filesystem sessions
  useEffect(() => {
    const qrIds = Object.keys(QR_CHANNEL_MAP);
    qrIds.forEach(async (id) => {
      try {
        const result = await window.electron?.ipcRenderer.invoke('channel-check-linked', { channel: id });
        if (result?.linked) {
          setLinkedQrChannels(prev => new Set([...prev, id]));
        }
      } catch (_) {}
    });
  }, []);

  const running     = platforms.filter(p => p.status === 'RUNNING').length;
  const errors      = platforms.filter(p => p.status === 'ERROR').length;
  const activeConns = connections.filter(c => c.enabled !== false).length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', backgroundColor: 'var(--app-bg)' }}>
      <Topbar title="Dashboard" />

      <div style={{ padding: '40px', flex: 1 }}>

        {/* ── 3 Stat Cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '40px' }}>
          <StatCard
            label="Platforms Running"
            value={`${running} / ${platforms.length}`}
            sub={running > 0 ? 'Processes active' : platforms.length > 0 ? 'All stopped' : 'None installed'}
            color={running > 0 ? '#22c55e' : 'var(--text-muted)'}
          />
          <StatCard
            label="Connections"
            value={activeConns}
            sub={activeConns > 0 ? 'API keys configured' : 'No connections yet'}
            color={activeConns > 0 ? '#6366f1' : 'var(--text-muted)'}
          />
          <StatCard
            label="Issues"
            value={errors}
            sub={errors > 0 ? 'Action required' : 'All healthy'}
            color={errors > 0 ? '#ef4444' : 'var(--text-muted)'}
          />
        </div>

        {/* ── Main grid: platforms | connections ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '32px', alignItems: 'start' }}>

          {/* Platforms */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-muted)' }}>
                Installed Platforms
              </div>
              <button
                onClick={() => onNavigate('installed')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}
              >
                Manage →
              </button>
            </div>

            {platforms.length === 0 ? (
              <div
                onClick={() => onNavigate('marketplace')}
                style={{
                  backgroundColor: 'var(--card-bg)', border: '1px dashed var(--border)',
                  borderRadius: '8px', padding: '40px', textAlign: 'center',
                  cursor: 'pointer', color: 'var(--text-muted)',
                }}
              >
                <div style={{ fontSize: '13px', marginBottom: '8px' }}>No platforms installed</div>
                <div style={{ fontSize: '12px', color: 'var(--accent)' }}>Browse Marketplace →</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[...platforms].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => (
                  <PlatformCard
                    key={p.id}
                    platform={{ ...p, channels: platformChannels[p.id] || p.channels || {} }}
                    linkedQrChannels={linkedQrChannels}
                    onStart={requireAuth(() => startPlatform(p.id))}
                    onStop={requireAuth(() => stopPlatform(p.id))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Connections Health */}
          <ConnectionsPanel connections={connections} onNavigate={onNavigate} />
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default Dashboard;
