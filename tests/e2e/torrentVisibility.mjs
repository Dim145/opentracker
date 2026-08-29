/**
 * What each role may see in the catalogue, against a real stack.
 *
 * The ⌘K palette searches torrents through `/api/torrents` — the very endpoint
 * the search page uses, with a strict subset of its parameters. The claim that
 * follows from that ("the palette can never show more than the search page")
 * is structural, but the rule it leans on had no coverage with actual data: the
 * seed ships no torrents, so every role saw an empty list and every assertion
 * about visibility was vacuously true.
 *
 * This creates the fixtures that make the rule observable, and pins both halves
 * of it:
 *
 *   Moderation — `moderationStatus` must be `accepted`, OR you must be the
 *   uploader. Staff see everything. The uploader clause is the one that is easy
 *   to get wrong in the retelling: a plain member does NOT only see accepted
 *   torrents, they also see their own submissions awaiting a decision.
 *
 *   Adult — categories flagged `isAdult` are hidden unless the viewer opted in
 *   on their own account. This one is NOT a staff privilege: an admin who has
 *   not opted in does not see them either, which is worth pinning precisely
 *   because it reads like an oversight until you check.
 *
 * Neither rule can be steered from the request. Both are derived from the
 * session inside the handler, which is why the palette passing `{search, limit}`
 * cannot widen them.
 */
import { createHash } from 'node:crypto';
import {
  API,
  caller,
  check,
  report,
  resetRateLimits,
  sessions,
  sleep,
} from './lib.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

/** Marks every row this scenario creates, so it can ignore anything else. */
const MARK = 'E2EVIS';

// ── bencode ──────────────────────────────────────────────────────────
//
// Enough of it to build a .torrent, and no more. Written here rather than
// pulled from a package because the harness is deliberately dependency-free.

function bencode(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (typeof value === 'string') return bencode(Buffer.from(value, 'utf8'));
  if (typeof value === 'number') return Buffer.from(`i${Math.trunc(value)}e`);
  if (Array.isArray(value)) {
    return Buffer.concat([
      Buffer.from('l'),
      ...value.map(bencode),
      Buffer.from('e'),
    ]);
  }
  if (value && typeof value === 'object') {
    // Bencode requires dictionary keys in lexicographic order. Get this wrong
    // and the info hash the tracker computes is not the one a client would.
    const keys = Object.keys(value).sort();
    return Buffer.concat([
      Buffer.from('d'),
      ...keys.flatMap((k) => [bencode(k), bencode(value[k])]),
      Buffer.from('e'),
    ]);
  }
  throw new Error(`cannot bencode ${typeof value}`);
}

/**
 * A minimal single-file torrent. The piece hashes are derived from the name
 * rather than from any real data — nothing on the upload path verifies them
 * against content, it only needs twenty bytes per piece — and a distinct name
 * is what gives each fixture a distinct info hash.
 */
function torrentFile(name) {
  const size = 1024 * 1024;
  const pieceLength = 262144;
  const pieces = Buffer.concat(
    Array.from({ length: Math.ceil(size / pieceLength) }, (_, i) =>
      createHash('sha1').update(`${name}:${i}`).digest()
    )
  );
  return bencode({
    announce: 'http://tracker.invalid/announce',
    info: {
      length: size,
      name,
      'piece length': pieceLength,
      pieces,
      private: 1,
    },
  });
}

/** `caller` speaks JSON; the upload route is multipart, so this one is by hand. */
async function upload(who, name, categoryId) {
  const boundary = `----trackarr${createHash('sha1').update(name).digest('hex').slice(0, 16)}`;
  const parts = [];
  const field = (headers, body) => {
    parts.push(Buffer.from(`--${boundary}\r\n${headers}\r\n\r\n`), body, Buffer.from('\r\n'));
  };
  field(
    `Content-Disposition: form-data; name="torrent"; filename="${name}.torrent"\r\n` +
      'Content-Type: application/x-bittorrent',
    torrentFile(name)
  );
  field('Content-Disposition: form-data; name="name"', Buffer.from(name));
  if (categoryId) {
    field('Content-Disposition: form-data; name="categoryId"', Buffer.from(categoryId));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const res = await fetch(`${API}/api/torrents`, {
    method: 'POST',
    headers: {
      cookie: S[who].cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(parts),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

/**
 * The fixture names this viewer gets back from the catalogue.
 *
 * No `search` term: the point is the visibility filter, and leaning on the
 * full-text tokeniser here would let an FTS change look like a permission
 * change. `paletteShape` below covers the query the palette really sends.
 */
async function visible(who) {
  const { status, body } = await req(who, '/api/torrents?limit=100');
  if (status !== 200) return { status, names: [] };
  return {
    status,
    names: (body.data ?? [])
      .map((t) => t.name)
      .filter((n) => n.startsWith(MARK))
      .sort(),
  };
}

/**
 * Create the category, or find it if a previous run already did.
 *
 * `run.sh` starts from an empty database, so this is not needed there — but a
 * `--no-build --only` re-run against a kept stack is the fast way to work on
 * this file, and a scenario that only passes once is a scenario you stop
 * trusting.
 */
async function category(name, isAdult) {
  const made = await req('founder', '/api/admin/categories', {
    method: 'POST',
    body: { name, isAdult },
  });
  const id = made.body?.id ?? made.body?.category?.id ?? made.body?.data?.id;
  if (id) return id;

  // `?includeAdult=true` is the staff escape hatch on the category tree: an
  // operator curating the XXX subtree without switching it on for their own
  // browsing. Without it the adult category is invisible even to its creator.
  const { body } = await req('founder', '/api/categories?includeAdult=true');
  const list = Array.isArray(body) ? body : (body?.data ?? body?.categories ?? []);
  const flat = list.flatMap((c) => [c, ...(c.subcategories ?? [])]);
  return flat.find((c) => c.name === name)?.id ?? null;
}

const NAMES = {
  public: `${MARK}-public-accepted`,
  plainPending: `${MARK}-pending-by-plainuser`,
  donatorPending: `${MARK}-pending-by-donator`,
  adult: `${MARK}-adult-accepted`,
};

async function main() {
  console.log('\n1. fixtures');

  const normalId = await category(`${MARK} General`, false);
  const adultId = await category(`${MARK} Adult`, true);
  check('a normal category', !!normalId, String(normalId));
  check('an adult category', !!adultId, String(adultId));
  if (!normalId || !adultId) return report();

  const uploads = {
    public: await upload('plainuser', NAMES.public, normalId),
    plainPending: await upload('plainuser', NAMES.plainPending, normalId),
    donatorPending: await upload('donator', NAMES.donatorPending, normalId),
    adult: await upload('founder', NAMES.adult, adultId),
  };
  for (const [key, res] of Object.entries(uploads)) {
    check(
      `uploaded ${key}`,
      res.status === 200 || res.status === 201,
      `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`
    );
  }
  const rows = Object.fromEntries(
    Object.entries(uploads).map(([k, r]) => [k, r.body?.data])
  );
  if (!rows.public?.infoHash || !rows.adult?.infoHash) {
    check('upload responses carry the row', false, JSON.stringify(rows).slice(0, 200));
    return report();
  }

  // Staff uploads bypass moderation outright (`user.isAdmin || user.isModerator
  // || userHasUploadBypass`), so the admin's row is born accepted and a
  // member's is born pending. Pinning it here is what makes the fixtures below
  // mean what they claim.
  check(
    "a member's upload lands pending",
    rows.public.moderationStatus === 'pending' &&
      rows.plainPending.moderationStatus === 'pending',
    `${rows.public.moderationStatus} / ${rows.plainPending.moderationStatus}`
  );
  check(
    "an admin's upload bypasses moderation",
    rows.adult.moderationStatus === 'accepted',
    String(rows.adult.moderationStatus)
  );

  await resetRateLimits();

  // Exactly one needs a decision: the member upload that stands in for the
  // public catalogue. The other two members' rows stay pending on purpose,
  // and the admin's is already accepted.
  const approve = await req('founder', `/api/mod/torrents/${rows.public.infoHash}/approve`, {
    method: 'POST',
    body: {},
  });
  check('approved the public one', approve.status === 200, `${approve.status} ${JSON.stringify(approve.body).slice(0, 160)}`);

  await resetRateLimits();
  await sleep(500);

  console.log('\n2. the moderation rule');

  const staff = await visible('founder');
  check(
    'an admin sees every non-adult fixture, pending included',
    staff.names.join() === [NAMES.donatorPending, NAMES.plainPending, NAMES.public].sort().join(),
    staff.names.join(' | ')
  );
  check('and not the adult one, having not opted in', !staff.names.includes(NAMES.adult), staff.names.join(' | '));

  const plain = await visible('plainuser');
  check(
    "a member sees what is accepted plus their OWN pending upload",
    plain.names.join() === [NAMES.plainPending, NAMES.public].sort().join(),
    plain.names.join(' | ')
  );
  check(
    "and never another member's pending upload",
    !plain.names.includes(NAMES.donatorPending),
    plain.names.join(' | ')
  );

  const other = await visible('donator');
  check(
    'the mirror image for the other member',
    other.names.join() === [NAMES.donatorPending, NAMES.public].sort().join(),
    other.names.join(' | ')
  );
  check(
    'each member sees exactly one pending row — their own',
    plain.names.filter((n) => n.includes('pending')).length === 1 &&
      other.names.filter((n) => n.includes('pending')).length === 1,
    `${plain.names.join(' | ')} / ${other.names.join(' | ')}`
  );

  console.log('\n3. the adult rule is a preference, not a privilege');

  const optIn = await req('founder', '/api/me', {
    method: 'PATCH',
    body: { showAdultContent: true },
  });
  check('the admin opts in', optIn.status === 200, `${optIn.status}`);

  const staffAfter = await visible('founder');
  check('now the adult row appears for them', staffAfter.names.includes(NAMES.adult), staffAfter.names.join(' | '));

  const plainAfter = await visible('plainuser');
  check(
    "and not for a member who did not opt in",
    !plainAfter.names.includes(NAMES.adult),
    plainAfter.names.join(' | ')
  );

  const memberOptIn = await req('plainuser', '/api/me', {
    method: 'PATCH',
    body: { showAdultContent: true },
  });
  check('a member may opt in too', memberOptIn.status === 200, `${memberOptIn.status}`);
  const plainOpted = await visible('plainuser');
  check(
    'the row is theirs to see once they do — it was never staff-only',
    plainOpted.names.includes(NAMES.adult),
    plainOpted.names.join(' | ')
  );

  console.log('\n4. the shape the palette actually sends');

  // `{ search, limit }` and nothing else — CommandPalette.vue sends no
  // visibility parameter, because there is none to send.
  async function paletteShape(who) {
    const { status, body } = await req(who, `/api/torrents?search=${MARK}&limit=5`);
    return { status, names: (body.data ?? []).map((t) => t.name).sort() };
  }

  const palettePlain = await paletteShape('donator');
  check(
    'the palette query obeys the same filter for a member',
    palettePlain.status === 200 && !palettePlain.names.includes(NAMES.plainPending),
    `${palettePlain.status} ${palettePlain.names.join(' | ')}`
  );
  check(
    'and still returns what they may see',
    palettePlain.names.includes(NAMES.public) || palettePlain.names.length === 0,
    palettePlain.names.join(' | ')
  );

  // Forging the parameter changes nothing: the handler never reads one.
  const forged = await req(
    'donator',
    `/api/torrents?search=${MARK}&limit=5&moderationStatus=pending&showAdultContent=true&canSeeUnapproved=true`
  );
  const forgedNames = (forged.body?.data ?? []).map((t) => t.name);
  check(
    'a forged visibility parameter widens nothing',
    forged.status === 400 || !forgedNames.includes(NAMES.plainPending),
    `${forged.status} ${forgedNames.join(' | ')}`
  );

  const anon = await fetch(`${API}/api/torrents?search=${MARK}&limit=5`);
  check('and the catalogue refuses an anonymous caller', anon.status === 401, String(anon.status));

  report();
}

main();
