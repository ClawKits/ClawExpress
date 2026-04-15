import React, { useState } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import Dashboard from './components/Dashboard/Dashboard';
import Marketplace from './components/Marketplace/Marketplace';
import LogDrawer from './components/LogDrawer/LogDrawer';
import ConfigPanel from './components/ConfigPanel/ConfigPanel';
import SettingsPage from './components/Settings/SettingsPage';
import ApiKeysPage from './components/ApiKeys/ApiKeysPage';
import InstalledPage from './components/Installed/InstalledPage';
import SkillsPage from './components/Skills/SkillsPage';
import { ToastContainer } from './components/Toast/Toast';
import DebugConsole from './components/DebugConsole/DebugConsole';
import AuthModal from './components/common/AuthModal';
import NpmDependencyModal from './components/InstallModal/NpmDependencyModal';
import { usePlatformStore } from './store/usePlatformStore';
import useAuthStore from './store/useAuthStore';
import UpdateNotification from './components/UpdateNotification/UpdateNotification';
import './index.css';

function App() {
  const [activePage, setActivePage] = useState('dashboard');
  const [logTarget, setLogTarget] = useState(null);
  const [configTarget, setConfigTarget] = useState(null);
  const { initAuth, isAuthModalOpen, closeAuthModal } = useAuthStore();
  const { setDashboardUrl } = usePlatformStore();

  React.useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Global listener: platform-ready must stay alive on ALL pages, not just InstalledPage.
  // If user navigates away during gateway startup, the event must still be captured.
  React.useEffect(() => {
    const cleanup = window.electron?.ipcRenderer.on('platform-ready', ({ platformId, dashboardUrl }) => {
      setDashboardUrl(platformId, dashboardUrl);
    });
    return cleanup;
  }, []);

  return (
    <>
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', backgroundColor: 'var(--app-bg)' }}>

        {/* Router */}
        {activePage === 'dashboard' ? (
          <Dashboard onNavigate={setActivePage} />
        ) : activePage === 'marketplace' ? (
          <Marketplace />
        ) : activePage === 'skills' ? (
          <SkillsPage />
        ) : activePage === 'settings' ? (
          <SettingsPage />
        ) : activePage === 'apikeys' ? (
          <ApiKeysPage />
        ) : (
          <InstalledPage
            onNavigate={setActivePage}
            setLogTarget={setLogTarget}
            setConfigTarget={setConfigTarget}
          />
        )}
      </main>

      {logTarget && <LogDrawer platform={logTarget} onClose={() => setLogTarget(null)} />}
      {configTarget && <ConfigPanel platform={configTarget} onClose={() => setConfigTarget(null)} />}
      <ToastContainer />
      <DebugConsole />
      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} />
      <NpmDependencyModal />
      <UpdateNotification />
    </>
  );
}

export default App;
