/**
 * ptyHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages pseudo-terminal (PTY) instances for in-app terminal emulation.
 * Uses node-pty so spawned processes get a real TTY — ANSI colors, QR codes,
 * interactive prompts all work correctly.
 *
 * IPC channels exposed:
 *   pty-start   (invoke) { id, command, args, cols, rows, env? } → { success, pid? }
 *   pty-input   (invoke) { id, data }  — keyboard input to PTY stdin
 *   pty-resize  (invoke) { id, cols, rows }
 *   pty-kill    (invoke) { id }
 *
 * Events sent to renderer:
 *   pty-data    { id, data }      — raw terminal output (UTF-8 string)
 *   pty-exit    { id, exitCode }  — process exited
 */

const { ipcMain } = require('electron');
const os = require('os');

/** Map of id → pty.IPty */
const activePtys = new Map();

function registerPtyHandlers() {
  // ── Start a PTY ────────────────────────────────────────────────────────────
  ipcMain.handle('pty-start', (event, { id, command, args = [], cols = 80, rows = 24, env = {} }) => {
    // Kill any existing PTY with this id.
    if (activePtys.has(id)) {
      try { activePtys.get(id).kill(); } catch (_) {}
      activePtys.delete(id);
    }

    let ptyLib;
    try {
      ptyLib = require('node-pty');
    } catch (e) {
      return { success: false, error: 'node-pty unavailable: ' + e.message };
    }

    const mergedEnv = {
      ...process.env,
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
    };
    // Remove vars that suppress interactive output.
    delete mergedEnv.CI;
    delete mergedEnv.NO_COLOR;

    let ptyProcess;
    try {
      ptyProcess = ptyLib.spawn(command, args, {
        name:  'xterm-256color',
        cols,
        rows,
        cwd:   os.homedir(),
        env:   mergedEnv,
        // On Windows, use ConPTY (requires Windows 10 1903+).
        useConpty: process.platform === 'win32',
      });
    } catch (e) {
      return { success: false, error: e.message };
    }

    // Stream PTY output to renderer.
    ptyProcess.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('pty-data', { id, data });
      }
    });

    // Notify renderer on exit.
    ptyProcess.onExit(({ exitCode }) => {
      activePtys.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send('pty-exit', { id, exitCode });
      }
    });

    activePtys.set(id, ptyProcess);
    return { success: true, pid: ptyProcess.pid };
  });

  // ── Send keyboard input to PTY ─────────────────────────────────────────────
  ipcMain.handle('pty-input', (_event, { id, data }) => {
    const p = activePtys.get(id);
    if (p) try { p.write(data); } catch (_) {}
    return null;
  });

  // ── Resize PTY ────────────────────────────────────────────────────────────
  ipcMain.handle('pty-resize', (_event, { id, cols, rows }) => {
    const p = activePtys.get(id);
    if (p) try { p.resize(Math.max(2, cols), Math.max(2, rows)); } catch (_) {}
    return null;
  });

  // ── Kill PTY ──────────────────────────────────────────────────────────────
  ipcMain.handle('pty-kill', (_event, { id }) => {
    const p = activePtys.get(id);
    if (p) {
      try { p.kill(); } catch (_) {}
      activePtys.delete(id);
    }
    return null;
  });
}

/** Kill all active PTYs — call on app quit. */
function killAllPtys() {
  for (const [, p] of activePtys) {
    try { p.kill(); } catch (_) {}
  }
  activePtys.clear();
}

module.exports = { registerPtyHandlers, killAllPtys };
