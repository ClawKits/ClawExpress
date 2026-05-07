const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../logger');
const { createGenericAdapter } = require('./generic.adapter');

// Read manifest
const openfangManifest = require('../../manifests/openfang.json');
const genericAdapter = createGenericAdapter(openfangManifest);

const OpenFangAdapter = {
  ...genericAdapter,

  readRawConfig: () => {
    const configPath = path.join(os.homedir(), '.openfang', 'config.toml');
    try {
      if (fs.existsSync(configPath)) {
        return { success: true, text: fs.readFileSync(configPath, 'utf8') };
      }
      return { success: false, reason: 'Config file not found' };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },

  writeRawConfig: ({ text }) => {
    const openfangDir = path.join(os.homedir(), '.openfang');
    const historyDir = path.join(openfangDir, 'history');
    const configPath = path.join(openfangDir, 'config.toml');
    try {
      if (fs.existsSync(configPath)) {
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(historyDir, `config.toml.rev-${ts}`);
        fs.copyFileSync(configPath, backupPath);
        
        const backups = fs.readdirSync(historyDir)
          .filter(f => f.startsWith('config.toml.rev-'))
          .sort()
          .reverse();
        if (backups.length > 15) {
          backups.slice(15).forEach(f => {
            try { fs.unlinkSync(path.join(historyDir, f)); } catch (_) {}
          });
        }
      }
      
      fs.writeFileSync(configPath, text || '', 'utf8');
      log.info('[Config] Raw TOML config written & backed up successfully');
      return { success: true };
    } catch (err) {
      log.error('[Config] write-raw-openfang-config failed:', err.message);
      return { success: false, reason: err.message };
    }
  },

  getRawConfigHistory: () => {
    const historyDir = path.join(os.homedir(), '.openfang', 'history');
    try {
      if (!fs.existsSync(historyDir)) return { success: true, history: [] };
      const files = fs.readdirSync(historyDir)
        .filter(f => f.startsWith('config.toml.rev-'))
        .sort()
        .reverse()
        .map(f => {
          const m = f.match(/rev-(.*)$/);
          const dateStr = m ? m[1].replace(/-/g, ':') : f;
          return { filename: f, dateStr: dateStr };
        });
      return { success: true, history: files };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },

  restoreRawConfig: ({ filename }) => {
    const historyDir = path.join(os.homedir(), '.openfang', 'history');
    const target = path.join(historyDir, filename);
    try {
      if (!fs.existsSync(target)) throw new Error('Backup file not found');
      const text = fs.readFileSync(target, 'utf8');
      return { success: true, text };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }
};

function register(fn) { fn(OpenFangAdapter); }
module.exports = { register, OpenFangAdapter };
