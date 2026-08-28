/**
 * Owner-uploaded font faces, over the real multipart surface.
 *
 * The integration suite covers the helpers. What only a running stack can show
 * is the round trip: a real `multipart/form-data` body, the file served back
 * with the headers a browser needs, and the emitted stylesheet carrying a
 * `@font-face` that points at it.
 */
import { API, caller, check, report, resetRateLimits, sessions, sleep } from './lib.mjs';

const S = sessions(['founder', 'donator']);
const req = caller(S);

/** A woff2 header plus filler. The route checks the first four bytes. */
function fakeWoff2(marker, extra = 64) {
  return Buffer.concat([
    Buffer.from('wOF2'),
    Buffer.from(marker),
    Buffer.alloc(extra, 0x41),
  ]);
}

async function upload(who, { bytes, family, role, filename = 'face.woff2' }) {
  const form = new FormData();
  form.append('font', new Blob([bytes], { type: 'font/woff2' }), filename);
  if (family !== undefined) form.append('family', family);
  if (role !== undefined) form.append('role', role);
  const res = await fetch(`${API}/api/admin/fonts`, {
    method: 'POST',
    headers: { cookie: S[who].cookie },
    body: form,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function sheet() {
  const res = await fetch(`${API}/api/theme.css`);
  return res.text();
}

await resetRateLimits();

// ── 1. Who may upload ────────────────────────────────────────────────
console.log('\n1. permissions');
{
  const asMember = await upload('donator', {
    bytes: fakeWoff2('member'),
    family: 'Member Font',
    role: 'sans',
  });
  check('a plain member cannot upload', asMember.status === 401 || asMember.status === 403,
    `status ${asMember.status}`);

  const listAsMember = await req('donator', '/api/admin/fonts');
  check('nor list', listAsMember.status === 401 || listAsMember.status === 403,
    `status ${listAsMember.status}`);
}

// ── 2. What the route accepts ────────────────────────────────────────
console.log('\n2. the upload itself');
let fontId = null;
{
  const ok = await upload('founder', {
    bytes: fakeWoff2('e2e-real'),
    family: 'E2E Face',
    role: 'display',
  });
  check('the owner can upload', ok.status === 201, `status ${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
  fontId = ok.body?.font?.id ?? null;
  check('it comes back with an id', !!fontId);
  check('and the role it was uploaded for', ok.body?.font?.role === 'display');

  // Content-addressed: the same bytes twice is one object.
  await sleep(200);
  const again = await upload('founder', {
    bytes: fakeWoff2('e2e-real'),
    family: 'A Different Name',
    role: 'sans',
  });
  check('the same file again is not created twice', again.status === 200,
    `status ${again.status}`);
  check('and returns the first row', again.body?.font?.id === fontId);
  check('keeping the first name', again.body?.font?.family === 'E2E Face');

  const list = await req('founder', '/api/admin/fonts');
  check('the list has exactly one', (list.body?.fonts ?? []).length === 1,
    `${(list.body?.fonts ?? []).length} fonts`);
}

// ── 3. What it refuses ───────────────────────────────────────────────
console.log('\n3. refusals');
{
  await sleep(200);
  // A `.ttf` renamed. The check is the bytes, not the extension.
  const wrongBytes = await upload('founder', {
    bytes: Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(64)]),
    family: 'Not A Woff2',
    role: 'sans',
    filename: 'looks-right.woff2',
  });
  check('a TrueType renamed .woff2 is refused', wrongBytes.status === 400,
    `status ${wrongBytes.status}`);
  check('and says why', /woff2|wOF2/.test(JSON.stringify(wrongBytes.body)),
    JSON.stringify(wrongBytes.body).slice(0, 160));

  await sleep(200);
  const tooBig = await upload('founder', {
    bytes: fakeWoff2('big', 3 * 1024 * 1024),
    family: 'Too Big',
    role: 'sans',
  });
  check('past the size cap is refused', tooBig.status === 413, `status ${tooBig.status}`);

  await sleep(200);
  const badRole = await upload('founder', {
    bytes: fakeWoff2('role'),
    family: 'Bad Role',
    role: 'headline',
  });
  check('an unknown role is refused', badRole.status >= 400, `status ${badRole.status}`);

  await sleep(200);
  const badName = await upload('founder', {
    bytes: fakeWoff2('name'),
    family: 'Bad"; }html{display:none',
    role: 'sans',
  });
  check('a family name with CSS syntax is refused', badName.status >= 400,
    `status ${badName.status}`);
}

// ── 4. Selecting it from a theme ─────────────────────────────────────
console.log('\n4. a theme that uses it');
let themeId = null;
{
  await resetRateLimits();
  const wrongRole = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Wrong Font Role',
      base: 'dark',
      duplicateOf: 'dark',
      // Uploaded for `display`, selected for `mono`.
      tokens: { 'font-mono': `upload:${fontId}` },
      visibility: 'site',
    },
  });
  check('a face cannot be used for another role', wrongRole.status === 400,
    `status ${wrongRole.status}`);
  check('and the message names the role',
    /mono/.test(JSON.stringify(wrongRole.body)),
    JSON.stringify(wrongRole.body).slice(0, 160));

  const ghost = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Ghost Upload',
      base: 'dark',
      duplicateOf: 'dark',
      tokens: { 'font-display': 'upload:00000000-0000-4000-8000-000000000000' },
      visibility: 'site',
    },
  });
  check('an id that does not exist is refused', ghost.status === 400, `status ${ghost.status}`);

  const made = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Uploaded Font',
      base: 'dark',
      duplicateOf: 'dark',
      tokens: { 'font-display': `upload:${fontId}` },
      enabled: true,
      visibility: 'site',
    },
  });
  themeId = made.body?.id ?? made.body?.theme?.id ?? null;
  check('the right role is accepted', made.status === 200 || made.status === 201,
    `status ${made.status} ${JSON.stringify(made.body).slice(0, 200)}`);

  const css = await sheet();
  check('the stylesheet declares the face', css.includes(`@font-face`) &&
    css.includes(`ot-font-${fontId}`), 'no @font-face for the uploaded id');
  check('pointing at the serving route', css.includes(`/api/fonts/${fontId}`));
  check('and the stack names it', css.includes(`--font-display: 'ot-font-${fontId}'`),
    css.match(/--font-display:[^;]*/g)?.join(' | ') ?? 'none');
  check('the stack still ends in a system fallback',
    /--font-display: 'ot-font-[0-9a-f-]+', Georgia, serif;/.test(css));
  // The name reaching CSS is generated, so nothing typed can appear in it.
  check('the name an owner typed is not in the stylesheet', !css.includes('E2E Face'));
}

// ── 5. Serving it ────────────────────────────────────────────────────
console.log('\n5. serving');
{
  const res = await fetch(`${API}/api/fonts/${fontId}`);
  check('served without a session', res.status === 200, `status ${res.status}`);
  check('as font/woff2', res.headers.get('content-type') === 'font/woff2',
    res.headers.get('content-type') ?? 'none');
  check('with nosniff', res.headers.get('x-content-type-options') === 'nosniff');
  check('cached immutably, because the bytes cannot change',
    /immutable/.test(res.headers.get('cache-control') ?? ''),
    res.headers.get('cache-control') ?? 'none');
  const body = Buffer.from(await res.arrayBuffer());
  check('the bytes come back', body.subarray(0, 4).toString() === 'wOF2',
    body.subarray(0, 8).toString('hex'));

  const missing = await fetch(`${API}/api/fonts/00000000-0000-4000-8000-000000000000`);
  check('an unknown id is a 404', missing.status === 404, `status ${missing.status}`);
  const notAnId = await fetch(`${API}/api/fonts/not-a-uuid`);
  check('so is a malformed one', notAnId.status === 404, `status ${notAnId.status}`);
}

// ── 6. Deleting ──────────────────────────────────────────────────────
console.log('\n6. deleting');
{
  await resetRateLimits();
  const inUse = await req('founder', `/api/admin/fonts/${fontId}`, { method: 'DELETE' });
  check('refused while a theme names it', inUse.status === 409, `status ${inUse.status}`);
  check('and names the theme',
    /E2E Uploaded Font/.test(JSON.stringify(inUse.body)),
    JSON.stringify(inUse.body).slice(0, 200));

  // Drop the reference, then delete.
  await req('founder', `/api/admin/themes/${themeId}`, {
    method: 'PUT',
    body: {
      name: 'E2E Uploaded Font',
      base: 'dark',
      tokens: {},
      visibility: 'site',
    },
  });
  const gone = await req('founder', `/api/admin/fonts/${fontId}`, { method: 'DELETE' });
  check('allowed once nothing names it', gone.status === 200, `status ${gone.status}`);

  const after = await sheet();
  check('the @font-face is gone with it', !after.includes(`ot-font-${fontId}`));
  const served = await fetch(`${API}/api/fonts/${fontId}`);
  check('and the file is no longer served', served.status === 404, `status ${served.status}`);

  // Clean up so the enabled-theme count is what the next scenario expects.
  await req('founder', `/api/admin/themes/${themeId}`, { method: 'DELETE' });
}

report();
