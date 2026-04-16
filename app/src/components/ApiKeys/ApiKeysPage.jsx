import React, { useState, useEffect } from 'react';
import { Settings2, Plus, MonitorSmartphone } from 'lucide-react';
import { useConnectionStore } from '../../store/useConnectionStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { PROVIDERS, PROVIDER_CATEGORIES } from '../../constants/providers';
import ConnectionManagerModal from '../ConnectionManager/ConnectionManagerModal';
import Topbar from '../Topbar/Topbar';

const SERVICE_COLORS = {
  openrouter: '#7c3aed', anthropic: '#d97706', openai: '#16a34a',
  groq: '#0ea5e9', google: '#3b82f6', mistral: '#ec4899', custom: '#6b7280',
  xai: '#ffffff', moonshot: '#0d9488', deepseek: '#3b82f6', venice: '#8b5cf6'
};

const ApiKeysPage = () => {
  const { connections, loadConnections, updateConnection } = useConnectionStore();
  const requireAuth = useRequireAuth();
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [statuses, setStatuses] = useState({});
  const [hoveredCardId, setHoveredCardId] = useState(null);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    connections.forEach(async (c) => {
      if (c.enabled === false) return;
      if (statuses[c.id]) return;

      setStatuses(s => ({ ...s, [c.id]: 'checking' }));
      try {
        const res = await window.electron.ipcRenderer.invoke('verify-api-key', {
          providerId: c.providerId,
          apiKey: c.apiKey,
          baseUrl: c.baseUrl
        });
        setStatuses(s => ({ ...s, [c.id]: res.valid ? 'online' : 'error' }));
      } catch {
        setStatuses(s => ({ ...s, [c.id]: 'error' }));
      }
    });
  }, [connections]);

  const getProviderColor = (providerId) => {
    return SERVICE_COLORS[providerId] || '#6b7280';
  };

  const renderConnectionCard = (conn) => {
    const p = PROVIDERS.find(x => x.id === conn.providerId);
    if (!p) return null;
    const color = getProviderColor(p.id);

    return (
      <div 
        key={conn.id}
        onClick={requireAuth(() => setSelectedConnectionId(conn.id))}
        style={{
          backgroundColor: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}
        onMouseEnter={e => {
          setHoveredCardId(conn.id);
          e.currentTarget.style.borderColor = 'var(--border-hover)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={e => {
          setHoveredCardId(null);
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <div style={{
          width: '40px', height: '40px',
          borderRadius: '8px',
          background: `${color}20`,
          border: `1px solid ${color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '14px', fontWeight: 700, color: color, flexShrink: 0
        }}>
          {p.id === 'custom' ? <MonitorSmartphone size={18} /> : p.label.slice(0, 2).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: conn.enabled === false ? 0.5 : 1 }}>
            {conn.name} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({p.label})</span>
          </div>
          <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {conn.enabled === false ? (
              <span style={{ color: 'var(--text-muted)' }}>Disabled</span>
            ) : (
              <>
                <span style={{ 
                  width: '6px', height: '6px', borderRadius: '50%', 
                  backgroundColor: statuses[conn.id] === 'online' ? '#10b981' : statuses[conn.id] === 'error' ? '#ef4444' : '#f59e0b'
                }} />
                <span style={{ color: statuses[conn.id] === 'online' ? '#10b981' : statuses[conn.id] === 'error' ? '#ef4444' : '#f59e0b' }}>
                  {statuses[conn.id] === 'online' ? 'Connected' : statuses[conn.id] === 'error' ? 'Offline / Error' : 'Checking...'}
                </span>
              </>
            )}
          </div>
        </div>

        <div 
          onClick={(e) => { 
            e.stopPropagation();
            requireAuth(() => { 
              updateConnection(conn.id, { enabled: conn.enabled !== false ? false : true });
              if (conn.enabled === false) {
                 setStatuses(s => {
                   const next = { ...s };
                   delete next[conn.id];
                   return next;
                 });
              }
            })(e);
          }}
          style={{ 
            opacity: hoveredCardId === conn.id ? 1 : 0,
            pointerEvents: hoveredCardId === conn.id ? 'auto' : 'none',
            visibility: hoveredCardId === conn.id ? 'visible' : 'hidden',
            width: '36px', height: '20px', borderRadius: '10px', 
            backgroundColor: conn.enabled !== false ? '#3b82f6' : '#6b7280', 
            display: 'flex', alignItems: 'center', padding: '2px', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0
          }}
        >
          <div style={{ 
            width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#fff', 
            transform: conn.enabled !== false ? 'translateX(16px)' : 'translateX(0)', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' 
          }} />
        </div>
      </div>
    );
  };

  const renderSection = (title, category, categoryId) => {
    const list = connections.filter(c => c.category === category);

    return (
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>{title}</h2>
          <button
            onClick={requireAuth(() => setIsCreatingNew(category))}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', padding: '4px 10px',
              borderRadius: '5px', cursor: 'pointer', fontSize: '12px',
              fontFamily: 'var(--font-primary)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <Plus size={11} /> Add
          </button>
        </div>
        
        {list.length === 0 ? (
          <div style={{ padding: '20px', borderRadius: '10px', border: '1px dashed var(--border)', background: 'var(--card-bg)', opacity: 0.7, fontSize: '13px', color: 'var(--text-muted)' }}>
            No connections in this category.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {list.map(renderConnectionCard)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', backgroundColor: 'var(--app-bg)' }}>
      <Topbar title="Connections" />

      <div style={{ padding: '24px 40px', flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '28px' }}>All Connections</div>
        {renderSection('OAuth Providers', PROVIDER_CATEGORIES.CLI, 'cli')}
        {renderSection('API Key Providers', PROVIDER_CATEGORIES.VENDOR, 'vendor')}
        {renderSection('Local Providers', PROVIDER_CATEGORIES.PROXY, 'proxy')}
      </div>

      {(selectedConnectionId || isCreatingNew) && (
        <ConnectionManagerModal 
          connectionId={selectedConnectionId} 
          category={isCreatingNew}
          onClose={() => { 
            setSelectedConnectionId(null); 
            setIsCreatingNew(null);
            loadConnections(); 
          }} 
        />
      )}
    </div>
  );
};

export default ApiKeysPage;
