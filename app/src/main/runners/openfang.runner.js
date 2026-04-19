/**
 * runners/openfang.runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenFang-specific lifecycle logic.
 *
 * Background:
 *   OpenFang hardcodes its API server to bind on 127.0.0.1 (loopback) inside
 *   the container, even when config.toml has host="0.0.0.0". This means Docker
 *   port mapping (-p host:50051) cannot reach it from outside.
 *
 *   Workaround: we mount a start.sh entrypoint that:
 *     1. Starts `openfang start` in the background (binds on 127.0.0.1:50051)
 *     2. Waits for port 50051 to become active
 *     3. Runs `socat TCP-LISTEN:50052,fork TCP:127.0.0.1:50051`
 *   Docker maps host:4200 → container:50052 (the socat bridge port).
 *
 * Responsibilities:
 *   • Auto-create ~/.openfang/start.sh before every launch.
 *   • Sync Docker -p host port with config.port (default 4200).
 *   • Map to the socat bridge port (50052) internally.
 *   • Detect readiness from stdout.
 *   • Fallback HTTP poller when stdout is silent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { startReadyPoller } = require('./shared');

const DEFAULT_PORT    = 4200;
const INTERNAL_PORT   = 50051; // openfang binds here (loopback only)
const BRIDGE_PORT     = 50052; // socat re-exposes this to 0.0.0.0

// ── start.sh content ─────────────────────────────────────────────────────────
const START_SH = `#!/bin/sh
# Mock sudo since container runs as root but UI scripts expect it
if ! command -v sudo > /dev/null 2>&1; then
  cat << 'EOF' > /usr/bin/sudo
#!/bin/sh
# ── Package Alias Registry ──
ALIASES="chromium-browser:chromium other-bad-pkg:good-pkg"

is_apt=0
if [ "$1" = "apt" ] || [ "$1" = "apt-get" ]; then
  if [ "$2" = "install" ]; then
    is_apt=1
    export DEBIAN_FRONTEND=noninteractive
  fi
fi

num=$#
while [ $num -gt 0 ]; do
  mapped="$1"
  for alias_pair in $ALIASES; do
    raw="\${alias_pair%%:*}"
    fixed="\${alias_pair##*:}"
    if [ "$1" = "$raw" ]; then
      mapped="$fixed"
      break
    fi
  done
  set -- "$@" "$mapped"
  shift
  num=$((num - 1))
done

if [ $is_apt -eq 1 ]; then
  set -- "$@" "-y"
fi

exec "$@"
EXIT_CODE=$?
# Flag that container state changed — triggers docker commit on next stop
if [ $is_apt -eq 1 ] && [ $EXIT_CODE -eq 0 ]; then
  touch /tmp/.needs-commit
fi
exit $EXIT_CODE
EOF
  chmod +x /usr/bin/sudo
fi

# Install socat if not already available
if ! command -v socat > /dev/null 2>&1; then
  apt-get update -qq && apt-get install -y socat -qq
fi

# Start openfang daemon in the background (binds 127.0.0.1:50051)
openfang start &
OPENFANG_PID=$!

# Wait until port 50051 is listening (hex C383 = 50051)
echo "[bridge] Waiting for openfang on 127.0.0.1:50051..."
for i in $(seq 1 30); do
  if grep -q "0100007F:C383" /proc/net/tcp 2>/dev/null; then
    echo "[bridge] openfang is up — starting socat bridge"
    break
  fi
  sleep 1
done

# Forward 0.0.0.0:50052 -> 127.0.0.1:50051 so Docker port mapping works
socat TCP-LISTEN:50052,fork,reuseaddr TCP:127.0.0.1:50051 &

# Keep container alive
wait $OPENFANG_PID
`;

/**
 * Ensure ~/.openfang/start.sh exists and is up-to-date before launching.
 */
function ensureStartScript(openfangDir) {
  try {
    if (!fs.existsSync(openfangDir)) {
      fs.mkdirSync(openfangDir, { recursive: true });
    }
    const scriptPath = path.join(openfangDir, 'start.sh');
    fs.writeFileSync(scriptPath, START_SH, { encoding: 'utf8' });
  } catch (err) {
    // Non-fatal — log and continue; the mount will simply fail if missing
    console.warn('[openfang.runner] Could not write start.sh:', err.message);
  }
}

/**
 * Readiness signals emitted by OpenFang to stdout.
 */
const READINESS_PATTERNS = [
  /WebChat UI available(?:\s+at)?\s+https?:\/\/[\d.:\[\]]+:(\d+)/i,
  /Listening on\s+https?:\/\/[\d.:\[\]]+:(\d+)/i,
  /Server started(?:\s+on(?:\s+port)?)?\s+(\d+)/i,
  /\[bridge\] starting socat bridge/i,
];

/**
 * Prepare Docker scriptArr:
 *  1. Ensure start.sh is present in ~/.openfang.
 *  2. Inject --name for container lifecycle management.
 *  3. Replace {{cwd}} placeholders with the actual ~/.openfang path.
 *  4. Sync the host-side port in the -p mapping with config.port.
 *     The container-side port is always BRIDGE_PORT (50052).
 */
function prepareDockerScript(scriptArr, config, containerName) {
  const openfangDir = path.join(os.homedir(), '.openfang');

  // 1. Ensure start.sh exists
  ensureStartScript(openfangDir);

  // 2. Inject --name
  const runIndex = scriptArr.indexOf('run');
  if (runIndex !== -1 && !scriptArr.includes('--name')) {
    scriptArr.splice(runIndex + 1, 0, '--name', containerName);
  }

  // 3. Replace {{cwd}} placeholders
  for (let i = 0; i < scriptArr.length; i++) {
    if (typeof scriptArr[i] === 'string' && scriptArr[i].includes('{{cwd}}')) {
      scriptArr[i] = scriptArr[i].replace(/\{\{cwd\}\}/g, openfangDir);
    }
  }

  // 4. Sync host port with config.port; always map to BRIDGE_PORT internally
  const hostPort = config.port || DEFAULT_PORT;
  for (let i = 0; i < scriptArr.length; i++) {
    if (scriptArr[i] === '-p' && scriptArr[i + 1]) {
      scriptArr[i + 1] = `${hostPort}:${BRIDGE_PORT}`;
      break;
    }
  }

  // 5. Swap image if customized state exists from a previous session
  try {
    const runnerCmd = global.CONTAINER_RUNTIME || 'docker';
    const hasCustom = require('child_process').spawnSync(runnerCmd, ['image', 'inspect', 'openfang-custom:latest']).status === 0;
    if (hasCustom) {
      const imgIdx = scriptArr.indexOf('ghcr.io/rightnow-ai/openfang:latest');
      if (imgIdx !== -1) scriptArr[imgIdx] = 'openfang-custom:latest';
    }
  } catch (_) {}

  return scriptArr;
}

/**
 * Adjust scriptArr for NPM fallback.
 */
function prepareNpmScript(scriptArr) {
  if (scriptArr.length === 0) return ['npm', 'start'];
  return scriptArr;
}

/**
 * Detect platform readiness from a stdout line.
 * Returns { dashboardUrl } when a readiness signal is found, null otherwise.
 */
function detectReadiness(text, config) {
  for (const pattern of READINESS_PATTERNS) {
    if (pattern.test(text)) {
      const port = config.port || DEFAULT_PORT;
      return { dashboardUrl: `http://127.0.0.1:${port}/` };
    }
  }
  return null;
}

/**
 * Fallback HTTP poller config when stdout readiness never arrives.
 */
function getFallbackPollerConfig(config) {
  return {
    port:         config.port || DEFAULT_PORT,
    requireToken: false,
    readToken:    null,
  };
}

/**
 * Post-start hook to extract and log OpenFang version.
 */
function scheduleVersionCheck(config, containerName, sendLog, webContents, platformId) {
  if (config.method !== 'docker') return;
  setTimeout(() => {
    try {
      const runnerCmd = global.CONTAINER_RUNTIME || 'docker';
      const result = require('child_process').spawnSync(
        runnerCmd, ['exec', containerName, 'openfang', '--version'],
        { encoding: 'utf8', timeout: 5000 }
      );
      if (result.status === 0 && result.stdout) {
        // Output looks like: "openfang 0.5.10"
        const versionStr = result.stdout.trim().replace(/^openfang\s+v?/, 'v');
        sendLog(`[SYSTEM] Core Engine Version -> ${versionStr}`);
        
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('platform-status-change', { 
            platformId, 
            status: 'RUNNING', 
            version: versionStr 
          });
        }
      }
    } catch (_) {}
  }, 4000);
}

module.exports = {
  prepareDockerScript,
  prepareNpmScript,
  startReadyPoller,
  detectReadiness,
  getFallbackPollerConfig,
  scheduleVersionCheck,
};
