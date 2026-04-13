import React, { useState } from 'react';
import { LayoutDashboard, Package, Store, Key, Settings, Menu, UserCircle, Zap } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import useAuthStore from '../../store/useAuthStore';
import styles from './Sidebar.module.css';

const Sidebar = ({ activePage, onNavigate }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const { platforms } = usePlatformStore();
  const { user, openAuthModal } = useAuthStore();

  React.useEffect(() => {
    window.electron?.ipcRenderer.invoke('get-app-version')
      .then(setAppVersion)
      .catch(console.error);
  }, []);

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.header}>
        <div className={styles.brandArea}>
          <img src="./logo.png?v=2" alt="ClawExpress Logo" style={{ width: '24px', height: '24px', objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(239,68,68,0.4))' }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={styles.brandText}>ClawExpress</span>
            {appVersion && !collapsed && <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 600, letterSpacing: '0.5px' }}>v{appVersion}</span>}
          </div>
        </div>
        <button className={styles.toggleBtn} onClick={() => setCollapsed(!collapsed)} title="Toggle Sidebar"><Menu size={16} /></button>
      </div>

      <div className={styles.navGroup}>
        <div className={styles.navLabel}>Navigation</div>
        <a className={`${styles.navItem} ${activePage === 'dashboard' ? styles.active : ''}`} onClick={() => onNavigate('dashboard')}><LayoutDashboard size={16} /><span className={styles.navText}>Dashboard</span></a>
        <a className={`${styles.navItem} ${activePage === 'installed' ? styles.active : ''}`} onClick={() => onNavigate('installed')}>
          <Package size={16} />
          <span className={styles.navText}>Installed</span>
          {platforms.length > 0 && <span className={styles.navBadge}>{platforms.length}</span>}
        </a>
        <a className={`${styles.navItem} ${activePage === 'marketplace' ? styles.active : ''}`} onClick={() => onNavigate('marketplace')}><Store size={16} /><span className={styles.navText}>Marketplace</span></a>
        {/* <a className={`${styles.navItem} ${activePage === 'skills' ? styles.active : ''}`} onClick={() => onNavigate('skills')}><Zap size={16} /><span className={styles.navText}>Skills</span></a> */}
        <a className={`${styles.navItem} ${activePage === 'apikeys' ? styles.active : ''}`} onClick={() => onNavigate('apikeys')}><Key size={16} /><span className={styles.navText}>Connection Hub</span></a>
      </div>

      <div className={styles.footerGroup}>
        <div className={styles.navLabel}>System</div>
        <a className={`${styles.navItem} ${activePage === 'settings' ? styles.active : ''}`} onClick={() => onNavigate('settings')}><Settings size={16} /><span className={styles.navText}>Settings</span></a>
        <a className={styles.navItem} style={{ marginTop: '12px', opacity: 1, cursor: 'pointer' }} onClick={openAuthModal}>
          {user ? (
            <>
              <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=333&color=fff`} className={styles.avatar} alt="Avatar" />
              <span className={styles.navText}>{user.name}</span>
            </>
          ) : (
            <UserCircle size={24} style={{ color: '#9ca3af' }} />
          )}
        </a>
      </div>
    </aside>
  );
};

export default Sidebar;
