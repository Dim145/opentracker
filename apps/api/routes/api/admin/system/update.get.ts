/**
 * GET /api/admin/system/update
 *
 * Returns three update playbooks so the FE can pick the right one based on
 * how the user actually deployed Trackarr:
 *
 *   - `dockerPrebuilt`  Docker, using the pre-built images on GHCR.
 *                        `docker compose pull && up -d` — no source needed.
 *   - `dockerSource`     Docker, but the user is building from a local clone.
 *                        `git pull && up -d --build`.
 *   - `native`           Bare-metal / dev install. `git pull && pnpm install
 *                        && pnpm build && restart`. Last-resort manual flow.
 *
 * The runtime detection (and which playbook is the recommended default)
 * happens client-side based on `runtime` from /api/admin/system/version.
 */
import { requireAdminSession } from '~~/utils/adminAuth';

interface UpdateCommand {
  step: number;
  description: string;
  command: string;
}

interface Playbook {
  id: 'dockerPrebuilt' | 'dockerSource' | 'native';
  label: string;
  blurb: string;
  commands: UpdateCommand[];
}

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const playbooks: Playbook[] = [
    {
      id: 'dockerPrebuilt',
      label: 'Docker · Prebuilt images',
      blurb:
        'Pull the latest GHCR images and recreate the containers. Fastest path — no compile step, no source clone needed.',
      commands: [
        {
          step: 1,
          description: 'Navigate to your compose directory',
          command: 'cd /path/to/trackarr',
        },
        {
          step: 2,
          description: 'Pull the latest images from GHCR',
          command: 'docker compose -f docker-compose.prod.yml pull',
        },
        {
          step: 3,
          description: 'Recreate the containers with the new images',
          command: 'docker compose -f docker-compose.prod.yml up -d',
        },
        {
          step: 4,
          description: 'Reclaim space from the previous image versions',
          command: 'docker image prune -f',
        },
      ],
    },
    {
      id: 'dockerSource',
      label: 'Docker · Build from source',
      blurb:
        'Pull the latest commits and rebuild the images in place. Use this when you have local patches or are tracking a branch.',
      commands: [
        {
          step: 1,
          description: 'Navigate to your project directory',
          command: 'cd /path/to/trackarr',
        },
        {
          step: 2,
          description: 'Pull the latest changes',
          command: 'git pull',
        },
        {
          step: 3,
          description: 'Rebuild and restart the containers',
          command: 'docker compose -f docker-compose.prod.yml up -d --build',
        },
        {
          step: 4,
          description: 'Reclaim space from the previous image layers',
          command: 'docker image prune -f',
        },
      ],
    },
    {
      id: 'native',
      label: 'Native install',
      blurb:
        'Bare-metal deploys without Docker. Pull the source, install dependencies, rebuild and restart your service manager.',
      commands: [
        {
          step: 1,
          description: 'Navigate to your project directory',
          command: 'cd /path/to/trackarr',
        },
        {
          step: 2,
          description: 'Pull the latest changes',
          command: 'git pull',
        },
        {
          step: 3,
          description: 'Install dependencies (frozen lockfile)',
          command: 'pnpm install --frozen-lockfile',
        },
        {
          step: 4,
          description: 'Rebuild every package in the workspace',
          command: 'pnpm -r build',
        },
        {
          step: 5,
          description: 'Restart your services (example: systemd)',
          command:
            'sudo systemctl restart trackarr-api trackarr-web trackarr-tracker',
        },
      ],
    },
  ];

  return {
    success: true,
    notes: [
      'Backup your database before updating',
      'Check the changelog for breaking changes',
      'The update will cause a brief downtime during container restart',
    ],
    playbooks,
  };
});
