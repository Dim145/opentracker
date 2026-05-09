/**
 * GET /api/admin/system/version
 *
 * Reports the running build's version, the runtime mode (so the FE can
 * choose between Docker-style and source-style update instructions), and
 * — when the configured repository is on GitHub — the latest release
 * tag plus a publish date and a changelog URL.
 *
 * Environment variables:
 *   - TRACKARR_REPO     "owner/repo"       (e.g. "Dim145/opentracker")
 *                       OR a full URL      (e.g. "https://github.com/Dim145/opentracker")
 *                       OR a non-GitHub URL (e.g. "https://gitlab.com/x/y") —
 *                       in that case the update check is skipped (we only
 *                       know how to talk to GitHub) but the URL is still
 *                       returned so the FE can link out.
 *                       Defaults to "Dim145/opentracker".
 *   - TRACKARR_RUNTIME  "docker" if the API is running inside one of the
 *                       project's Docker images. Set in apps/api/Dockerfile.
 *                       Anything else (or unset) is treated as a native
 *                       install.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import pkg from '../../../../package.json';

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string;
}

const FALLBACK_REPO = 'Dim145/opentracker';

interface ResolvedRepo {
  /** Provider id we know how to talk to. Only "github" supports update checks. */
  provider: 'github' | 'unknown';
  /** Canonical web URL, even when we can't query the API. */
  url: string;
  /** GitHub-only — the `owner/name` slug used to talk to the API. */
  ownerRepo: string | null;
}

/**
 * Parse the configured repo into a structured object.
 *
 * We accept three input shapes:
 *   - "owner/repo"             — assumed to be GitHub.
 *   - "https://github.com/o/r" — extracted to "o/r" + provider github.
 *   - any other URL            — opaque, returned as a link only.
 *
 * Garbage / empty input falls back to the project's default repo so the
 * version banner never breaks even with a typo'd env var.
 */
function resolveRepo(raw: string | undefined | null): ResolvedRepo {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return {
      provider: 'github',
      url: `https://github.com/${FALLBACK_REPO}`,
      ownerRepo: FALLBACK_REPO,
    };
  }

  // Bare slug — must be exactly "owner/repo", no extra slashes / scheme.
  // We accept dashes, dots and underscores in either segment to match
  // GitHub's allowed character set.
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
    return {
      provider: 'github',
      url: `https://github.com/${trimmed}`,
      ownerRepo: trimmed,
    };
  }

  // Anything else: try to parse as a URL. If that fails the input is
  // unusable and we fall back to the default.
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    const isGithub = u.hostname === 'github.com' || u.hostname.endsWith('.github.com');
    if (isGithub && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(path)) {
      return {
        provider: 'github',
        url: `https://github.com/${path}`,
        ownerRepo: path,
      };
    }
    // Non-GitHub URL — preserve it for the FE link, but we can't check
    // for releases (no protocol-agnostic releases API exists).
    return {
      provider: 'unknown',
      url: u.toString().replace(/\/$/, ''),
      ownerRepo: null,
    };
  } catch {
    return {
      provider: 'github',
      url: `https://github.com/${FALLBACK_REPO}`,
      ownerRepo: FALLBACK_REPO,
    };
  }
}

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const currentVersion = pkg.version;
  const repo = resolveRepo(process.env.TRACKARR_REPO);
  const runtime: 'docker' | 'native' =
    process.env.TRACKARR_RUNTIME === 'docker' ? 'docker' : 'native';

  let latestRelease: GitHubRelease | null = null;
  let updateAvailable = false;
  let checkError: string | null = null;

  // We only know how to query GitHub. For other providers, the FE simply
  // shows "update check unavailable" with a link to the repo so the admin
  // can verify by hand.
  if (repo.provider === 'github' && repo.ownerRepo) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo.ownerRepo}/releases/latest`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Trackarr-Admin',
          },
        }
      );

      if (response.ok) {
        latestRelease = await response.json();
        if (latestRelease) {
          const latestVersion = latestRelease.tag_name.replace(/^v/, '');
          updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
        }
      } else if (response.status === 404) {
        // Most common cause: repo has no published release yet, or the
        // configured slug is wrong. Either way, surface it so the admin
        // can fix it instead of silently showing "up to date".
        checkError = `No releases found at ${repo.ownerRepo}`;
      } else {
        checkError = `GitHub returned ${response.status}`;
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      checkError = 'Network error while checking for updates';
    }
  } else if (repo.provider === 'unknown') {
    checkError = 'Update check is only supported for GitHub repositories';
  }

  return {
    currentVersion,
    runtime,
    repository: {
      url: repo.url,
      provider: repo.provider,
      ownerRepo: repo.ownerRepo,
      // Surface the configured value so admins can sanity-check the env
      // var from the UI without shelling into the container.
      configured: process.env.TRACKARR_REPO || null,
    },
    latestRelease: latestRelease
      ? {
          version: latestRelease.tag_name,
          name: latestRelease.name,
          publishedAt: latestRelease.published_at,
          url: latestRelease.html_url,
          notes: latestRelease.body,
        }
      : null,
    updateAvailable,
    checkError,
  };
});

/**
 * Compare two semver versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}
