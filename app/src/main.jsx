import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import './i18n/i18n';
import { usePlatformStore } from './store/usePlatformStore.js';

// Initialize store from disk on startup
usePlatformStore.getState().init();

// Listen for real process exit events from Electron main
if (window.electron?.ipcRenderer?.on) {
  window.electron.ipcRenderer.on('platform-status-change', (payload) => {
    usePlatformStore.getState().handleStatusChange(payload);
  });
}

createRoot(document.getElementById('root')).render(<App />);
