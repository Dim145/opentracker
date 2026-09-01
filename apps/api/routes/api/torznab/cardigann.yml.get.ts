/**
 * GET /api/torznab/cardigann.yml
 *
 * A Prowlarr indexer definition for THIS instance, generated from it.
 *
 * ## Why generated and not a file in the repo
 *
 * The categories are the reason. They are operator-configured — names, slugs
 * and Newznab mappings all live in the database — so a static YAML shipped in
 * the repo could describe every instance's categories except the one the member
 * is actually joining. Generating it means a member downloads a definition that
 * already knows their tracker's own categories, its name and its URL, and has
 * nothing left to fill in but a key.
 *
 * It also follows what this codebase already does twice: the web app manifest
 * and the theme stylesheet are routes for exactly the same reason.
 *
 * ## Format
 *
 * Cardigann v11, which is what Prowlarr currently loads (`DEFINITION_VERSION`
 * is a constant in its source). There is no version marker inside the file —
 * the version is the folder the shipped definitions live in — so nothing here
 * declares one.
 *
 * The `search` block reads our own Torznab XML through `response.type: xml`,
 * which Cardigann parses with AngleSharp and then addresses with ordinary CSS
 * selectors. Note that `torznab:attr` elements are NOT selected by name: a
 * namespace-prefixed element cannot be cleanly addressed in CSS, so every
 * definition that consumes a Torznab feed uses the attribute form,
 * `[name=seeders]` + `attribute: value`. We do the same.
 *
 * ## The filename is the identity, not `id`
 *
 * Prowlarr keys a custom definition on its FILENAME, and refuses to load one
 * whose filename OR `name` collides with a built-in — the built-in wins and
 * ours is dropped with nothing but a log line. `id` itself is only used in log
 * messages. So the download is named after the site and the guide says to
 * change file and `name` together if the instance is ever renamed.
 */
import { getCategoriesWithNewznabIds } from './utils/categories';
import { getSiteName } from '~~/utils/server';
import { getTorznabEnabled } from '~~/utils/torznabSettings';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAuthSession } from '~~/utils/adminAuth';

/** YAML double-quoted scalar. Cardigann definitions are plain YAML 1.1. */
function q(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * A slug Prowlarr will accept as a filename and an id.
 *
 * Lowercase alphanumerics and hyphens, which is the convention across all 548
 * shipped definitions. Nothing enforces it, but a definition that looks like
 * the others is one an operator can reason about.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'trackarr';
}

export default defineEventHandler(async (event) => {
  // Members only. The file names the instance, its address and the operator's
  // whole category taxonomy, and an invite-only tracker publishes none of those
  // — the sibling that generates the autobrr definition gates the same way.
  await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  if (!(await getTorznabEnabled())) {
    throw createError({
      statusCode: 404,
      message: 'Torznab is not enabled on this instance.',
    });
  }

  const siteName = await getSiteName();
  /**
   * The identity is derived from the HOST, not from the site name.
   *
   * `getSiteName()` falls back to `TRACKARR`, so every instance nobody renamed
   * produced `id: trackarr` and the same filename — two of them in one Prowlarr
   * overwrite each other, which is exactly what this was supposed to avoid. A
   * name can also collide with a shipped definition (`nyaa`, `1337x`), in which
   * case Prowlarr keeps its own and drops ours with one log line.
   */
  const host = getRequestURL(event).host;
  const id = `trackarr-${slugify(host)}`;
  const categories = await getCategoriesWithNewznabIds();

  // Same derivation the Torznab feed itself uses, so the definition points at
  // the host the member reached rather than at whatever an env var was set to
  // on the day the container was built.
  const baseUrl = getRequestURL(event).origin;

  /**
   * One mapping per category, using the id our own feed emits so a `cat=`
   * round-trips. `cat:` must come from Cardigann's closed 71-value enum, so it
   * is derived from the Newznab parent rather than from the operator's name —
   * a value outside the enum fails validation and the definition is refused.
   */
  const NEWZNAB_TO_CARDIGANN: Record<number, string> = {
    1000: 'Console', 2000: 'Movies', 3000: 'Audio', 4000: 'PC',
    5000: 'TV', 6000: 'XXX', 7000: 'Books', 8000: 'Other',
  };
  const mappings = categories
    .map((cat) => {
      const parent = Math.floor(cat.newznabParent / 1000) * 1000;
      const label = NEWZNAB_TO_CARDIGANN[parent] ?? 'Other';
      return `    - {id: ${cat.newznabId}, cat: ${label}, desc: ${q(cat.name)}}`;
    })
    .join('\n');

  const yaml = `---
id: ${id}
name: ${q(siteName)}
description: ${q(`${siteName}, a private Trackarr tracker`)}
language: en-US
type: private
encoding: UTF-8
links:
  - ${q(`${baseUrl}/`)}

caps:
  categorymappings:
${mappings || '    - {id: 8000, cat: Other, desc: "Other"}'}

  modes:
    search: [q]
    tv-search: [q, season, ep, imdbid, tvdbid, tmdbid]
    movie-search: [q, imdbid, tmdbid]
  allowrawsearch: true

settings:
  - name: apikey
    type: password
    label: RSS key
  - name: info_key
    type: info
    label: About your key
    default: ${q(
      'Your RSS / Torznab key is on your profile page under Credentials. Use that one rather than your announce passkey: the key cannot announce, and you can revoke it on its own. Note that a .torrent this indexer grabs still carries your announce URL, so treat any client you paste this into as trusted.'
    )}

login:
  # A cheap query that answers 401 when the key is wrong, so Prowlarr's
  # "Test" button means something.
  path: api/torznab/api
  method: get
  inputs:
    apikey: "{{ .Config.apikey }}"
    t: search
    limit: 1

search:
  paths:
    - path: api/torznab/api
      response:
        type: xml

  inputs:
    apikey: "{{ .Config.apikey }}"
    t: "{{ .Query.Type }}"
    q: "{{ .Keywords }}"
    cat: "{{ join .Categories \\",\\" }}"
    season: "{{ .Query.Season }}"
    ep: "{{ .Query.Ep }}"
    imdbid: "{{ .Query.IMDBID }}"
    tmdbid: "{{ .Query.TMDBID }}"
    tvdbid: "{{ .Query.TVDBID }}"
    limit: 100

  rows:
    selector: rss > channel > item

  fields:
    title:
      selector: title
    details:
      selector: comments
    download:
      selector: enclosure
      attribute: url
    infohash:
      selector: "[name=infohash]"
      attribute: value
    date:
      selector: pubDate
      filters:
        - name: dateparse
          args: "ddd, dd MMM yyyy HH:mm:ss zzz"
    size:
      selector: size
    category:
      selector: "[name=category]"
      attribute: value
    seeders:
      selector: "[name=seeders]"
      attribute: value
    leechers:
      selector: "[name=peers]"
      attribute: value
    grabs:
      selector: "[name=grabs]"
      attribute: value
    downloadvolumefactor:
      selector: "[name=downloadvolumefactor]"
      attribute: value
    uploadvolumefactor:
      selector: "[name=uploadvolumefactor]"
      attribute: value
    minimumratio:
      selector: "[name=minimumratio]"
      attribute: value
      optional: true
    minimumseedtime:
      selector: "[name=minimumseedtime]"
      attribute: value
      optional: true
`;

  setHeader(event, 'Content-Type', 'application/yaml; charset=utf-8');
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${id}.yml"`
  );
  // Categories change when an operator edits them, and a stale definition maps
  // a `cat=` to the wrong thing. Short cache, revalidated.
  setHeader(event, 'Cache-Control', 'public, max-age=300, must-revalidate');
  return yaml;
});
