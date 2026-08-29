/**
 * Fill a kept e2e stack with something worth looking at.
 *
 * The suite's own seed makes three accounts and the scenarios leave the
 * settings wherever the last phase put them — fine for assertions, useless
 * for trying the product. This script builds a small but real instance:
 * five roles, both messaging surfaces open, conversations in every state
 * the interface can render, and a room with a history.
 *
 * Everything goes through HTTP, like the seed. No SQL shortcuts, so what
 * you end up looking at is what the application actually produces.
 *
 *   node tests/e2e/demo.mjs
 *
 * Idempotent-ish: re-running registers nothing new (the names are taken)
 * and logs in instead, then adds another round of messages.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateCredentials, generateLoginProof, solvePoW } from './crypto.mjs';
// Registering five accounts and promoting two is far more admin writes in
// a minute than the flood detector allows, and once it trips it answers
// 403 to everything — which reads as a permission bug and is not one. The
// harness clears its OWN throwaway stack's counters between phases rather
// than running against a relaxed build; there is no such switch in
// production. Same reasoning as the note in lib.mjs.
import { resetRateLimits } from './lib.mjs';

const API = process.env.E2E_API ?? 'http://localhost:54000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = JSON.parse(readFileSync(new URL('./session.json', import.meta.url), 'utf8'));

// ── HTTP ─────────────────────────────────────────────────────────────
const jars = new Map();
function jarFor(name) {
  if (!jars.has(name)) jars.set(name, new Map());
  return jars.get(name);
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function absorb(jar, res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function call(path, { method = 'GET', body, jar, cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  const c = cookie ?? (jar ? cookieHeader(jar) : '');
  if (c) headers.cookie = c;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (jar) absorb(jar, res);
  let parsed = null;
  const text = await res.text();
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

/** Call as one of the demo accounts. */
const as = (who, path, opts = {}) =>
  call(path, { ...opts, cookie: S[who]?.cookie });

// ── Accounts ─────────────────────────────────────────────────────────
//
// Five, because the point is to see the boundaries: what a moderator can
// reach that a member cannot, and what an admin can reach that a
// moderator cannot. Three accounts cannot show that.
const NEW_ACCOUNTS = [
  { username: 'modmaria',  email: 'maria@e2e.test',  password: 'E2e-Passw0rd!maria',  role: 'moderator' },
  { username: 'adminalex', email: 'alex@e2e.test',   password: 'E2e-Passw0rd!alex',   role: 'admin' },
  { username: 'seedersam', email: 'sam@e2e.test',    password: 'E2e-Passw0rd!sam',    role: 'member' },
  { username: 'lurkerlou', email: 'lou@e2e.test',    password: 'E2e-Passw0rd!lou',    role: 'member' },
  // Registered so it can be erased at the end, which is the only way to
  // look at what an erased correspondent does to a conversation.
  { username: 'ghostgil',  email: 'gil@e2e.test',    password: 'E2e-Passw0rd!gil',    role: 'member' },
];

/**
 * Registration and login, matching `seed.mjs` exactly — same endpoints,
 * same field names, same four-minute proof-of-work budget. Anything that
 * drifts from it fails as an unhelpful base64 error three calls later.
 */
async function pow() {
  const { body } = await call('/api/auth/pow');
  return solvePoW(body.challenge, body.difficulty, undefined, 240_000);
}

async function register(acc) {
  const jar = jarFor(acc.username);
  const creds = await generateCredentials(acc.password);
  const solved = await pow();
  const { status, body } = await call('/api/auth/register', {
    method: 'POST',
    jar,
    body: {
      username: acc.username,
      email: acc.email,
      password: acc.password,
      confirmPassword: acc.password,
      authSalt: creds.salt,
      authVerifier: creds.verifier,
      powChallenge: solved.challenge,
      powNonce: solved.nonce,
      powHash: solved.hash,
    },
  });
  return { status, body, jar };
}

async function login(acc) {
  const jar = jarFor(acc.username);
  jar.clear();
  const chal = await call(
    `/api/auth/challenge?username=${encodeURIComponent(acc.username)}`,
    { jar },
  );
  if (!chal.body?.salt) {
    return { status: chal.status, body: chal.body, jar };
  }
  const proof = await generateLoginProof(
    acc.password, chal.body.salt, chal.body.challenge,
  );
  const { status, body } = await call('/api/auth/login', {
    method: 'POST',
    jar,
    body: { username: acc.username, challenge: chal.body.challenge, proof },
  });
  return { status, body, jar };
}

async function ensureRegistrationOpen() {
  const r = await as('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { registrationOpen: true },
  });
  console.log(`  registration open -> ${r.status}`);
}

/**
 * Re-login the founder before anything else.
 *
 * `freshauth.mjs` runs last in the suite and deliberately clears every
 * fresh-auth stamp, so the session in session.json is authenticated but
 * stale. Role changes are behind `requireFreshAuth`, and a stale session
 * gets a 401 that reads like a broken cookie. Logging in again is the
 * whole fix, and it costs one round trip.
 */
async function refreshFounder() {
  const r = await login({ username: 'founder', password: 'E2e-Passw0rd!founder' });
  if (r.status === 200 || r.status === 201) {
    S.founder.cookie = cookieHeader(r.jar);
    console.log('  founder session refreshed');
  } else {
    console.log(`  founder re-login -> ${r.status} (role changes will be refused)`);
  }
}

// ── Go ───────────────────────────────────────────────────────────────
console.log('\n▸ opening registration');
await resetRateLimits();
await refreshFounder();
await resetRateLimits();
await ensureRegistrationOpen();

console.log('\n▸ accounts');
for (const acc of NEW_ACCOUNTS) {
  // The proof-of-work gate is per-IP and paced. Nothing here is in a
  // hurry, and rushing it just trips the limiter.
  await resetRateLimits();
  await sleep(1500);
  let r = await register(acc);
  let via = 'register';
  if (r.status !== 200 && r.status !== 201) {
    r = await login(acc);
    via = 'login';
  }
  if (r.status !== 200 && r.status !== 201) {
    console.log(`  ${acc.username.padEnd(10)} FAILED ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    continue;
  }
  const who = await call('/api/auth/status', { jar: r.jar });
  S[acc.username] = {
    cookie: cookieHeader(r.jar),
    via,
    id: who.body?.user?.id ?? null,
    password: acc.password,
    role: acc.role,
  };
  console.log(`  ${acc.username.padEnd(10)} via=${via} id=${S[acc.username].id?.slice(0, 8)}`);
}

console.log('\n▸ roles');
await resetRateLimits();
for (const acc of NEW_ACCOUNTS) {
  if (acc.role === 'member' || !S[acc.username]?.id) continue;
  const r = await as('founder', `/api/admin/users/${S[acc.username].id}/role`, {
    method: 'PUT',
    body: {
      isAdmin: acc.role === 'admin',
      isModerator: acc.role === 'moderator' || acc.role === 'admin',
    },
  });
  console.log(`  ${acc.username.padEnd(10)} -> ${acc.role} (${r.status})`);
}

console.log('\n▸ messaging on');
await resetRateLimits();
{
  const r = await as('founder', '/api/admin/settings', {
    method: 'PUT',
    body: {
      messagingDmScope: 'all',
      messagingRoomScope: 'all',
      messagingRoomRetentionDays: 14,
      messagingRoomSlowModeSeconds: 0,
    },
  });
  const now = await as('founder', '/api/admin/settings');
  console.log(
    `  PUT ${r.status} — dm=${now.body?.messagingDmScope} room=${now.body?.messagingRoomScope} ` +
    `retention=${now.body?.messagingRoomRetentionDays}d slow=${now.body?.messagingRoomSlowModeSeconds}s`,
  );
}

// ── Conversations ────────────────────────────────────────────────────
const DM = '/api/messaging/conversations';

async function openWith(who, username, opts = {}) {
  await resetRateLimits();
  const r = await as(who, DM, { method: 'POST', body: { username, ...opts } });
  if (r.status !== 200 && r.status !== 201) {
    console.log(`  open ${who}->${username} FAILED ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    return null;
  }
  return r.body?.id ?? r.body?.conversation?.id ?? null;
}

async function say(who, id, text) {
  const r = await as(who, `${DM}/${id}/messages`, {
    method: 'POST',
    body: { body: text },
  });
  if (r.status !== 200 && r.status !== 201) {
    console.log(`  say(${who}) FAILED ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  return r;
}

async function accept(who, id) {
  return as(who, `${DM}/${id}/accept`, { method: 'POST' });
}

console.log('\n▸ conversations');
await resetRateLimits();

// 1. A settled thread, accepted, with a back-and-forth. The ordinary case.
const c1 = await openWith('seedersam', 'plainuser');
if (c1) {
  await accept('plainuser', c1);
  await say('seedersam', c1, 'Hey — is the 1080p remux of the Tarkovsky set still seeded?');
  await say('plainuser', c1, 'It is, two of us on it. Grab it before the freeleech ends Sunday.');
  await say('seedersam', c1, 'Perfect, thanks. Anything else worth pulling this week?');
  await say('plainuser', c1, 'The Criterion batch that landed Tuesday. Ratio-friendly, lots of seeders.');
  console.log(`  settled thread          seedersam <-> plainuser (${c1.slice(0, 8)})`);
}

// 2. Unaccepted: a first contact sitting in the request queue. This is the
//    state the whole anti-spam design exists for, and it is invisible
//    unless something is actually waiting in it.
const c2 = await openWith('lurkerlou', 'plainuser');
if (c2) {
  await say('lurkerlou', c2, 'Hello! New here. Could you reseed the 2019 documentary pack?');
  console.log(`  pending request         lurkerlou -> plainuser (${c2.slice(0, 8)})`);
}

// 3. Unread on purpose: written to, never opened, so the badge has a
//    reason to exist.
const c3 = await openWith('modmaria', 'plainuser');
if (c3) {
  await accept('plainuser', c3);
  await say('modmaria', c3, 'Heads up: your upload was approved. Nice metadata, thank you.');
  await say('modmaria', c3, 'One thing — the sample file is missing. Not a problem, just noting it.');
  console.log(`  unread                  modmaria -> plainuser (${c3.slice(0, 8)})`);
}

// 4. Staff to staff.
const c4 = await openWith('adminalex', 'modmaria');
if (c4) {
  await accept('modmaria', c4);
  await say('adminalex', c4, 'Two reports on the same uploader this week. Worth a look?');
  await say('modmaria', c4, 'Seen them. Both from the same reporter — I am reading it as a grudge, not a pattern.');
  await say('adminalex', c4, 'Agreed. Leaving it open for now.');
  console.log(`  staff thread            adminalex <-> modmaria (${c4.slice(0, 8)})`);
}

// 5. Encrypted, deliberately EMPTY.
//
//    Seeding ciphertext here would be a disservice: the private half lives
//    in the browser's IndexedDB, per device, so anything written from Node
//    is unreadable in the browser and the conversation opens on the
//    "another device holds the key" panel. Left empty, both sides can
//    generate a key in the browser and watch it work.
const c5 = await openWith('seedersam', 'donator', { encrypted: true });
if (c5) {
  await accept('donator', c5);
  console.log(`  encrypted, empty        seedersam <-> donator (${c5.slice(0, 8)})  <- generate keys in the browser`);
}

// 6. The erased correspondent. Two conversations, then the account goes.
const g1 = await openWith('ghostgil', 'plainuser');
if (g1) {
  await accept('plainuser', g1);
  await say('ghostgil', g1, 'Thanks for the invite, all set up now.');
  await say('plainuser', g1, 'Welcome aboard. Shout if anything looks broken.');
}
const g2 = await openWith('ghostgil', 'donator', { encrypted: true });
if (g2) await accept('donator', g2);

// ── The room ─────────────────────────────────────────────────────────
console.log('\n▸ room');
await resetRateLimits();
const ROOM = '/api/messaging/room/messages';
const CHATTER = [
  ['plainuser', 'Morning. Anyone else seeing slow announces on the UDP port?'],
  ['seedersam', 'Not here — HTTP and UDP both fine for me in the last hour.'],
  ['modmaria', 'Nothing on our side either. Say the word if it persists and I will look at the logs.'],
  ['plainuser', 'Sorted itself out. Probably my router.'],
  ['donator', 'The freeleech pool refreshed, by the way. Fourteen new entries.'],
  ['seedersam', 'Saw that, already three deep. The documentary batch is excellent.'],
  ['adminalex', 'Reminder: retention here is fourteen days. Anything you want to keep, keep it somewhere else.'],
  ['lurkerlou', 'Noted. Is there a way to search back through it?'],
  ['modmaria', 'Not the room, no — it is deliberately ephemeral. Private messages are searchable.'],
  ['plainuser', 'Which is the right way round, honestly.'],
];
let posted = 0;
for (const [who, text] of CHATTER) {
  await resetRateLimits();
  const r = await as(who, ROOM, { method: 'POST', body: { body: text } });
  if (r.status === 200 || r.status === 201) posted++;
  else console.log(`  room(${who}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  await sleep(120);
}
console.log(`  ${posted}/${CHATTER.length} messages posted`);

// ── Erase, last ──────────────────────────────────────────────────────
//
// Done at the end because it is destructive and because the interesting
// part is what it leaves behind: a plaintext thread that survives with an
// unnamed author, and an encrypted one that is emptied and explained.
console.log('\n▸ erasing ghostgil');
await resetRateLimits();
if (S.ghostgil?.cookie) {
  const r = await call('/api/me', {
    method: 'DELETE',
    cookie: S.ghostgil.cookie,
    body: { confirm: 'ghostgil' },
  });
  console.log(`  DELETE /api/me -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  delete S.ghostgil;
}

writeFileSync(
  new URL('./session.json', import.meta.url),
  JSON.stringify(S, null, 2),
);

console.log('\n▸ accounts you can sign in with');
console.log('  founder    E2e-Passw0rd!founder    owner');
console.log('  adminalex  E2e-Passw0rd!alex       admin');
console.log('  modmaria   E2e-Passw0rd!maria      moderator');
console.log('  donator    E2e-Passw0rd!donator    member');
console.log('  plainuser  E2e-Passw0rd!plain      member  <- most of the messaging state is here');
console.log('  seedersam  E2e-Passw0rd!sam        member');
console.log('  lurkerlou  E2e-Passw0rd!lou        member');
console.log('');
