
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('./logger');

let _dataPath = null;
function getDataPath() {
  if (!_dataPath) _dataPath = path.join(app.getPath('userData'), 'platforms.json');
  return _dataPath;
}

let _connectionsPath = null;
function getConnectionsPath() {
  if (!_connectionsPath) _connectionsPath = path.join(app.getPath('userData'), 'connections.json');
  return _connectionsPath;
}

function loadPlatforms() {
  try {
    const p = getDataPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    log.error('[Persistence] Failed to load platforms:', e.message);
  }
  return null;
}

function savePlatforms(data) {
  try {
    fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    log.error('[Persistence] Failed to save platforms:', e.message);
  }
}

function loadConnections() {
  try {
    const p = getConnectionsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    log.error('[Persistence] Failed to load connections:', e.message);
  }
  return [];
}

function saveConnections(data) {
  try {
    fs.writeFileSync(getConnectionsPath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    log.error('[Persistence] Failed to save connections:', e.message);
  }
}

module.exports = { getDataPath, getConnectionsPath, loadPlatforms, savePlatforms, loadConnections, saveConnections };

  