const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const log = require('./logger');
const { execSync } = require('child_process');

function parseYamlValue(str) {
  if (!str) return '';
  str = str.trim();
  if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
  if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1);
  return str;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yamlString = match[1];
  
  const skill = {};
  
  // Extract name
  const nameMatch = yamlString.match(/^name:\s*(.+)$/m);
  if (nameMatch) skill.name = parseYamlValue(nameMatch[1]);
  
  // Extract description
  const descMatch = yamlString.match(/^description:\s*(.+)$/m);
  if (descMatch) skill.description = parseYamlValue(descMatch[1]);
  
  // Extract homepage
  const homeMatch = yamlString.match(/^homepage:\s*(.+)$/m);
  if (homeMatch) skill.homepage = parseYamlValue(homeMatch[1]);
  
  // Extract metadata (basic JSON parsing within YAML)
  const metaMatch = yamlString.match(/metadata:\s*([\s\S]+?)(?=\n[a-z]+:|\n---|$)/);
  if (metaMatch) {
     try {
         let metaStr = metaMatch[1].trim().replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
         skill.metadata = JSON.parse(metaStr);
     } catch (e) {
         skill.metadata = {};
     }
  } else {
     skill.metadata = {};
  }
  
  return skill;
}

async function getGlobalNpmPath() {
    try {
        if (process.platform === 'win32') {
            return path.join(process.env.APPDATA, 'npm', 'node_modules', 'openclaw', 'skills');
        } else {
            const root = execSync('npm root -g').toString().trim();
            return path.join(root, 'openclaw', 'skills');
        }
    } catch(e) {
        return null;
    }
}

function registerSkillHandlers() {
    ipcMain.handle('skills-fetch-local', async () => {
        try {
            const workspaceBuiltins = path.join(os.homedir(), '.openclaw', 'workspace', 'skills');
            const bundledBuiltins = await getGlobalNpmPath();
            
            const dirsToScan = [
                { path: bundledBuiltins, type: 'bundled' },
                { path: workspaceBuiltins, type: 'workspace' }
            ];
            
            const results = [];
            
            // Fetch configuration to check enabled states
            const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
            let configData = {};
            try {
                if (await fs.stat(configPath).catch(() => false)) {
                    configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
                }
            } catch(e) { }

            const entriesObj = configData.plugins?.entries || {};
            const entriesKeys = Object.keys(entriesObj).filter(k => entriesObj[k]?.enabled !== false);

            for (const root of dirsToScan) {
                if (!root.path) continue;
                try {
                    const dirEntries = await fs.readdir(root.path, { withFileTypes: true });
                    for (const entry of dirEntries) {
                        if (entry.isDirectory()) {
                            const skillMdPath = path.join(root.path, entry.name, 'SKILL.md');
                            try {
                                const content = await fs.readFile(skillMdPath, 'utf8');
                                const parsed = parseFrontmatter(content);
                                if (parsed) {
                                    parsed.id = entry.name;
                                    parsed.origin = root.type;
                                    parsed.fullPath = skillMdPath;
                                    parsed.enabled = entriesKeys.includes(entry.name);
                                    results.push(parsed);
                                }
                            } catch (e) {
                                // Ignore unreadable SKILL.md
                            }
                        }
                    }
                } catch(e) {
                    // Ignore missing roots
                }
            }
            
            return { success: true, data: results };
        } catch (e) {
            console.error('[skillHandler] Error fetching skills:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('skills-toggle', async (event, { skillId, enable }) => {
        try {
            const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
            let configData = {};
            if (await fs.stat(configPath).catch(() => false)) {
                configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
            }

            if (!configData.plugins) configData.plugins = {};
            if (!configData.plugins.entries || Array.isArray(configData.plugins.entries)) {
                configData.plugins.entries = {}; // Reset to object if it was corrupted to array
            }

            if (enable) {
                configData.plugins.entries[skillId] = { enabled: true };
            } else {
                if (configData.plugins.entries[skillId]) {
                    configData.plugins.entries[skillId].enabled = false;
                }
            }

            await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8');
            return { success: true };
        } catch (e) {
            console.error('[skillHandler] Error toggling skill:', e);
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('skills-fetch-hub', async (event, args = {}) => {
        try {
            const sortParam = args.sort || 'downloads';
            // Fetch directly from the official ClawHub API
            const req = await fetch(`https://clawhub.ai/api/plugins`, {
                headers: { 'User-Agent': 'ClawExpress-App' }
            });
            const data = await req.json();

            if (!data) {
                return { success: false, error: 'Hub API returned invalid format' };
            }

            const rawItems = Array.isArray(data) ? data : (data.items || data.results || data.plugins || []);
            
            // Map the ClawHub data to the format expected by the UI
            const results = rawItems
                .filter(item => item.family === 'skill' || item.family === 'code-plugin' || !item.family)
                .map(item => {
                    const id = item.slug || item.name;
                    return {
                        id: id,
                        name: item.displayName || id,
                        author: item.ownerHandle || 'Unknown',
                        description: item.summary || 'No description provided.',
                        metadata: { openclaw: { emoji: '🌐' } },
                        // For now we set sourceMd to the ClawHub url, pending full extraction support
                        sourceMd: `https://clawhub.ai/packages/${id}` 
                    };
                });

            return { success: true, data: results };
        } catch (e) {
            console.error('[skillHandler] Error fetching ClawHub:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('skills-fetch-stats', async (event, slugs) => {
        if (!Array.isArray(slugs)) return { success: false, data: {} };
        const results = {};
        try {
            for (const slug of slugs) {
                try {
                    const res = await fetch(`https://clawhub.ai/api/skill?slug=${slug}`, {
                        headers: { 'User-Agent': 'ClawExpress-App' }
                    });
                    if (res.ok) {
                        const json = await res.json();
                        if (json && json.skill && json.skill.stats) {
                            results[slug] = json.skill.stats;
                        } else {
                            log.error(`[skillHandler] Json missing stats for ${slug}:`, Object.keys(json || {}));
                        }
                    } else {
                        log.error(`[skillHandler] Fetch failed for ${slug} - status ${res.status}`);
                    }
                } catch (e) {
                    log.error(`[skillHandler] Error fetching stats for ${slug}:`, e.message);
                }
            }
            return { success: true, data: results };
        } catch (e) {
            log.error('[skillHandler] Error fetching stats:', e.message);
            return { success: false, data: results };
        }
    });

    ipcMain.handle('skills-install', async (event, { id, sourceMd }) => {
        try {
            let markdownContent = sourceMd || '';
            
            // If sourceMd is a URL, fetch its text natively first
            if (markdownContent.startsWith('http')) {
                const req = await fetch(markdownContent, { headers: { 'User-Agent': 'ClawExpress-App' } });
                markdownContent = await req.text();
            }

            const workspaceBuiltins = path.join(os.homedir(), '.openclaw', 'workspace', 'skills', id);
            await fs.mkdir(workspaceBuiltins, { recursive: true });
            await fs.writeFile(path.join(workspaceBuiltins, 'SKILL.md'), markdownContent, 'utf8');
            return { success: true };
        } catch (e) {
            console.error('[skillHandler] Error installing skill:', e);
            return { success: false, error: e.message };
        }
    });
}

module.exports = { registerSkillHandlers };
