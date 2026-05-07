import hermesManifest  from '../manifests/hermes.json';
import zeroclaweManifest from '../manifests/zeroclaw.json';

const MANIFESTS = {
  hermes:   hermesManifest,
  zeroclaw: zeroclaweManifest,
};

/**
 * Resolves the Docker container name to use for `docker exec` in the shell terminal.
 *
 * Single-container platforms: {platformId}-clawexpress
 * Compose platforms: {registryId}-clawexpress-{shellService}-1
 */
export function getShellContainer(platform) {
  const registryId   = platform?.registryId || '';
  const manifest     = MANIFESTS[registryId];
  const shellService = manifest?.install?.docker?.shellService;

  // Compose platforms: platform.container is an install-time unique ID,
  // not the actual Docker container name. Use compose service naming instead.
  if (shellService) {
    return `${registryId}-clawexpress-${shellService}-1`;
  }

  // Single-container: platform.container IS the actual Docker container name.
  return platform?.container || `${platform?.id}-clawexpress`;
}
