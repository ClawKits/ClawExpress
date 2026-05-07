import manifest from '../../manifests/zeroclaw.json';

export const zeroclaw = {
  ...manifest,
  method: 'docker',
  installScript: {
    docker: []
  },
  startScript: {
    docker: ['docker', 'compose', 'up', '-d'],
    npm: []
  },
  stopScript: {
    docker: ['docker', 'compose', 'down']
  }
};
