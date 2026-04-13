import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Base translation maps (English by default as requested)
const resources = {
  en: {
    translation: {
      "install.modal.title": "Install: {{name}}",
      "install.modal.new": "New Platform",
      "install.method.select": "Select Installation Method",
      "install.method.desc": "Choose how ClawExpress should manage {{name}}.",
      "install.docker.title": "Docker / Podman",
      "install.docker.desc": "Isolated container. Best for stability and uninstalls. Requires Docker Desktop.",
      "install.npm.title": "NPM (Node)",
      "install.npm.desc": "Runs natively on your host OS. Faster, but requires Node.js globals.",
      "install.btn.continue": "Continue",
      "install.btn.back": "Back",
      "install.btn.start": "Start Installation",
      "install.btn.finish": "Finish & Return"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // Default hardcoded to English for now as requested
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // React already escapes values
    }
  });

export default i18n;
