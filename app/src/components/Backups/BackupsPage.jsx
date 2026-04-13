import React, { useState } from 'react';
import { Archive, Download, Trash2, RefreshCw, FolderOpen, CheckCircle2, Clock } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { toast } from '../Toast/Toast';
import Topbar from '../Topbar/Topbar';

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const MOCK_BACKUPS = [
  { id: 1, name: 'Full config snapshot', platforms: ['openclaw', 'zeroclaw'], size: 24576, createdAt: new Date(Date.now() - 86400 * 3 * 1000).toISOString(), type: 'auto' },
  { id: 2, name: 'Pre-update backup', platforms: ['openclaw'], size: 8192, createdAt: new Date(Date.now() - 86400 * 8 * 1000).toISOString(), type: 'manual' },
];

const BackupsPage = () => {
  const { platforms } = usePlatformStore();
  const requireAuth = useRequireAuth();
  const [backups, setBackups] = useState(MOCK_BACKUPS);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleCreate = async () => {
    setCreating(true);
    await new Promise(r => setTimeout(r, 1200));

    const snapshot = {
      id: Date.now(),
      name: 'Manual backup',
      platforms: platforms.map(p => p.id),
      size: JSON.stringify(platforms).length * 2,
      createdAt: new Date().toISOString(),
      type: 'manual',
    };

    setBackups(b => [snapshot, ...b]);
    setCreating(false);
    toast.success('Backup created successfully');
  };

  const handleDelete = (id) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setBackups(b => b.filter(bk => bk.id !== id));
    setConfirmDelete(null);
    toast.info('Backup removed');
  };

  const handleRestore = (backup) => {
    toast.warn(`Restore from "${backup.name}" — not yet connected to process manager`);
  };

  const handleExport = (backup) => {
    const content = JSON.stringify({ backup, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawexpress-backup-${backup.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup exported as JSON');
  };

  const totalSize = backups.reduce((s, b) => s + b.size, 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', backgroundColor: 'var(--app-bg)' }}>
      <Topbar title="Backups" />

      <div style={{ padding: '40px', flex: 1 }}>

        {/* Summary row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
          {[
            { label: 'Total Backups', value: backups.length, icon: <Archive size={16} color="#6366f1" /> },
            { label: 'Total Size', value: formatBytes(totalSize), icon: <FolderOpen size={16} color="#22c55e" /> },
            { label: 'Latest', value: backups.length ? formatDate(backups[0].createdAt).split(',')[0] : '—', icon: <Clock size={16} color="#f59e0b" /> },
          ].map(({ label, value, icon }) => (
            <div key={label} style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ flexShrink: 0 }}>{icon}</div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 500 }}>{value}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Snapshots header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Snapshots</div>
          <button
            onClick={requireAuth(handleCreate)}
            disabled={creating}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'transparent', border: '1px solid var(--border)',
              color: creating ? 'var(--text-muted)' : 'var(--text-secondary)',
              padding: '5px 12px', borderRadius: '5px', cursor: creating ? 'not-allowed' : 'pointer',
              fontSize: '12px', fontFamily: 'var(--font-primary)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!creating) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = creating ? 'var(--text-muted)' : 'var(--text-secondary)'; }}
          >
            <Archive size={12} style={{ animation: creating ? 'spin 1s linear infinite' : 'none' }} />
            {creating ? 'Creating…' : 'New Backup'}
          </button>
        </div>

        {backups.length === 0 ? (
          <div style={{ border: '1px dashed var(--border)', borderRadius: '8px', padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Archive size={32} style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No backups yet</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Create one to snapshot your current platform configs.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {backups.map(backup => (
              <div key={backup.id} style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: backup.type === 'manual' ? 'rgba(99,102,241,0.1)' : 'rgba(34,197,94,0.08)', border: `1px solid ${backup.type === 'manual' ? 'rgba(99,102,241,0.2)' : 'rgba(34,197,94,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Archive size={16} color={backup.type === 'manual' ? '#6366f1' : '#22c55e'} />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{backup.name}</span>
                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: backup.type === 'manual' ? 'rgba(99,102,241,0.1)' : 'rgba(34,197,94,0.08)', color: backup.type === 'manual' ? '#6366f1' : '#22c55e', textTransform: 'uppercase', fontWeight: 500 }}>
                      {backup.type}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                    {backup.platforms.length} platform{backup.platforms.length !== 1 ? 's' : ''} · {formatBytes(backup.size)} · {formatDate(backup.createdAt)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={requireAuth(() => handleRestore(backup))} title="Restore" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', width: '32px', height: '32px', borderRadius: '5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RefreshCw size={13} />
                  </button>
                  <button onClick={() => handleExport(backup)} title="Export JSON" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', width: '32px', height: '32px', borderRadius: '5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Download size={13} />
                  </button>
                  <button onClick={requireAuth(() => handleDelete(backup.id))} title={confirmDelete === backup.id ? 'Confirm delete' : 'Delete'} style={{ background: confirmDelete === backup.id ? 'rgba(239,68,68,0.1)' : 'transparent', border: `1px solid ${confirmDelete === backup.id ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`, color: confirmDelete === backup.id ? '#ef4444' : 'var(--text-muted)', width: '32px', height: '32px', borderRadius: '5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '28px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Backups contain platform configurations, environment variables, and registry metadata. Process data and API keys are stored separately.
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default BackupsPage;
