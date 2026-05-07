import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal }  from '@xterm/xterm';
import { FitAddon }  from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * EmbeddedTerminal
 *
 * Renders an xterm.js terminal connected to a node-pty PTY via IPC.
 *
 * Props:
 *   id       – unique PTY identifier (used for IPC routing)
 *   command  – executable to run (e.g. 'openclaw')
 *   args     – args array (e.g. ['channels', 'login', '--channel', 'whatsapp'])
 *   env      – extra env vars for the PTY
 *   onExit   – callback(exitCode: number) when PTY process exits
 *   style    – optional CSS style for the container div
 *   initialMessages - array of strings to print immediately
 */
const EmbeddedTerminal = forwardRef(({ id, command, args = [], env = {}, onExit, style, termOptions = {}, initialMessages = [] }, ref) => {
  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const fitRef       = useRef(null);
  const cleanupFns   = useRef([]);

  const startPty = useCallback(async (term, fitAddon) => {
    // Ask main process to spawn the PTY.
    const { cols, rows } = fitAddon.proposeDimensions() || { cols: 80, rows: 24 };
    const result = await window.electron?.ipcRenderer.invoke('pty-start', {
      id, command, args,
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      env,
    });
    if (result && !result.success) {
      term.writeln(`\x1B[31m[Error] Could not start terminal: ${result.error}\x1B[0m`);
    }
  }, [id, command, args, env]);

  useEffect(() => {
    if (!containerRef.current) return;

    // ── Create xterm.js terminal ───────────────────────────────────────────
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", "Courier New", monospace',
      fontSize:   13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback:  2000,
      theme: {
        background:  '#0f0f0f',
        foreground:  '#d4d4d4',
        cursor:      '#aeafad',
        black:       '#000000', brightBlack:   '#666666',
        red:         '#cd3131', brightRed:     '#f14c4c',
        green:       '#0dbc79', brightGreen:   '#23d18b',
        yellow:      '#e5e510', brightYellow:  '#f5f543',
        blue:        '#2472c8', brightBlue:    '#3b8eea',
        magenta:     '#bc3fbc', brightMagenta: '#d670d6',
        cyan:        '#11a8cd', brightCyan:    '#29b8db',
        white:       '#e5e5e5', brightWhite:   '#ffffff',
      },
      ...termOptions,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // Disable IME composition (Unikey, etc.) on the xterm textarea.
    // Unikey sends composed Vietnamese via compositionend → input event.
    // We intercept in the capture phase before xterm's own handler sees it.
    if (term.textarea) {
      term.textarea.setAttribute('inputmode', 'none');
      let composing = false;
      const onCompStart = () => { composing = true; };
      const onCompEnd   = () => { composing = false; term.textarea.value = ''; };
      const onInput     = (e) => {
        if (composing || e.isComposing) {
          e.stopImmediatePropagation();
          term.textarea.value = '';
        }
      };
      term.textarea.addEventListener('compositionstart', onCompStart);
      term.textarea.addEventListener('compositionend',   onCompEnd);
      term.textarea.addEventListener('input', onInput, { capture: true });
      cleanupFns.current.push(() => {
        term.textarea?.removeEventListener('compositionstart', onCompStart);
        term.textarea?.removeEventListener('compositionend',   onCompEnd);
        term.textarea?.removeEventListener('input', onInput, { capture: true });
      });
    }

    if (initialMessages && initialMessages.length > 0) {
      initialMessages.forEach(msg => term.writeln(msg));
    }

    termRef.current  = term;
    fitRef.current   = fitAddon;

    // ── Keyboard input → PTY stdin ─────────────────────────────────────────
    const onData = term.onData((data) => {
      window.electron?.ipcRenderer.invoke('pty-input', { id, data });
    });

    let rollingBuffer = '';

    // ── PTY stdout → xterm.js ─────────────────────────────────────────────
    const cleanData = window.electron?.ipcRenderer.on('pty-data', (payload) => {
      if (payload.id === id) {
        term.write(payload.data);
        rollingBuffer += payload.data;
        if (rollingBuffer.length > 500) rollingBuffer = rollingBuffer.slice(-500);
        
        // Auto-bypass the "Install plugin?" prompt by selecting "Download from npm"
        if (/Install (WhatsApp|zalouser) plugin\?/i.test(rollingBuffer) && rollingBuffer.includes('Download from npm')) {
             term.writeln('\r\n\x1B[33m[Bot] Auto-installing NPM plugin to sync with your Windows drive...\x1B[0m');
             // '\r' corresponds to hitting Enter on the first option (NPM)
             window.electron?.ipcRenderer.invoke('pty-input', { id, data: '\r' });
             rollingBuffer = ''; // prevent duplicate triggers
        }

        if (/web session ready|Linked after restart/i.test(rollingBuffer)) {
             term.writeln('\r\n\x1B[32m[Success] Session ready detected. Stabilizing connection for 8 seconds...\x1B[0m');
             setTimeout(() => {
                 if (onExit) onExit(0);
             }, 8500);
             rollingBuffer = ''; // prevent duplicate triggers
        }
      }
    });

    // ── PTY exit ──────────────────────────────────────────────────────────
    const cleanExit = window.electron?.ipcRenderer.on('pty-exit', (payload) => {
      if (payload.id !== id) return;
      const code = payload.exitCode;
      const color = code === 0 ? '\x1B[32m' : '\x1B[31m';
      term.writeln(`\r\n${color}[Process exited with code ${code}]\x1B[0m`);
      if (onExit) onExit(code);
    });

    // ── Auto-fit on container resize ──────────────────────────────────────
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const { cols, rows } = fitAddon.proposeDimensions() || {};
        if (cols && rows) {
          window.electron?.ipcRenderer.invoke('pty-resize', { id, cols, rows });
        }
      } catch (_) {}
    });
    ro.observe(containerRef.current);

    // ── Start PTY ─────────────────────────────────────────────────────────
    startPty(term, fitAddon);

    cleanupFns.current = [
      () => { try { onData.dispose(); } catch (_) {} },
      cleanData,
      cleanExit,
      () => ro.disconnect(),
      () => {
        window.electron?.ipcRenderer.invoke('pty-kill', { id });
        term.dispose();
      },
    ];

    return () => {
      cleanupFns.current.forEach(fn => { try { fn?.(); } catch (_) {} });
      cleanupFns.current = [];
    };
  }, []); // run once on mount

  useImperativeHandle(ref, () => ({
    write: (text) => {
      if (termRef.current) {
        termRef.current.writeln(text);
      }
    }
  }));

  return (
    <div
      ref={containerRef}
      style={{
        width:        '100%',
        height:       '100%',
        minHeight:    240,
        background:   '#0f0f0f',
        borderRadius: 6,
        overflow:     'hidden',
        padding:      4,
        boxSizing:    'border-box',
        ...style,
      }}
    />
  );
});

export default EmbeddedTerminal;
