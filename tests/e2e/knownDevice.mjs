/**
 * The per-account sign-in lockout, and the member's own browsers.
 *
 * Ten failed sign-ins in fifteen minutes hold a username out of password
 * sign-in from every address — the right password included, so anyone who
 * knows a username could keep its owner out. A browser that has completed a
 * sign-in carries a known-device cookie and answers to its own counter instead:
 * failing on purpose from elsewhere now shuts the account to new devices only.
 * See `apps/api/utils/knownDevices.ts`.
 *
 * Runs just before `freshauth`, because it signs `donator` and `plainuser` out
 * everywhere and only `freshauth` (founder alone) comes after it.
 */
import { API, check, report, resetAddressLimits, resetRateLimits } from './lib.mjs';
import { generateLoginProof } from './crypto.mjs';

const PASSWORDS = { donator: 'E2e-Passw0rd!donator', plainuser: 'E2e-Passw0rd!plain' };
const KD = 'trackarr_kd';

// A browser: a cookie jar of its own. The scenario's whole point is which
// cookies each one holds, so it does not reuse the session file.
const browser = () => new Map();

async function call(jar, path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, setCookies };
}

/** The real protocol: challenge, then a proof — the right one, or 64 hex of noise. */
async function signIn(jar, username, { wrong = false } = {}) {
  const chal = await call(jar, `/api/auth/challenge?username=${encodeURIComponent(username)}`);
  if (chal.status !== 200) return chal;
  const proof = wrong
    ? 'f'.repeat(64)
    : await generateLoginProof(PASSWORDS[username], chal.body.salt, chal.body.challenge);
  return call(jar, '/api/auth/login', {
    method: 'POST',
    body: { username, challenge: chal.body.challenge, proof },
  });
}

/** Ten wrong proofs from `jar`, between two clears of the per-address buckets. */
async function failTenTimes(jar, username) {
  await resetAddressLimits();
  const statuses = [];
  for (let i = 0; i < 10; i++) statuses.push((await signIn(jar, username, { wrong: true })).status);
  await resetAddressLimits();
  return statuses;
}

const d = (r) => `status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
const kdLine = (r) => r.setCookies.find((l) => l.startsWith(`${KD}=`));

await resetRateLimits();

console.log('\n1. a completed sign-in makes the browser known');
const mine = browser();
{
  const r = await signIn(mine, 'donator');
  check('donator signs in', r.status === 200, d(r));
  const line = kdLine(r);
  check('and gets a known-device cookie', !!line, r.setCookies.join(' | ').slice(0, 200));
  check(
    'httpOnly, SameSite=Lax, kept six months',
    /HttpOnly/i.test(line ?? '') && /SameSite=Lax/i.test(line ?? '') && /Max-Age=15552000/.test(line ?? ''),
    line,
  );
}

console.log('\n2. ten failures from elsewhere shut the account to new browsers');
const stranger = browser();
{
  const st = await failTenTimes(stranger, 'donator');
  check('ten refusals', st.every((s) => s === 401), st.join(','));
  const r = await signIn(stranger, 'donator');
  check('then the right password is refused there', r.status === 429, d(r));
  check('saying the account is locked, not the address',
    r.body?.data?.reason === 'account-locked', d(r));
  const fresh = await signIn(browser(), 'donator');
  check('and in any other new browser', fresh.status === 429, d(fresh));
}

console.log("\n3. the member's own browser is not shut out");
{
  await resetAddressLimits();
  const r = await signIn(mine, 'donator');
  check('the known browser signs in', r.status === 200, d(r));
  check('and its cookie is renewed', !!kdLine(r), r.setCookies.join(' | ').slice(0, 200));
  const again = await signIn(stranger, 'donator');
  check('which does not lift the lockout for the stranger', again.status === 429, d(again));
}

console.log('\n4. a known browser that fails ten times is known no more');
{
  const st = await failTenTimes(mine, 'donator');
  check('ten refusals from the known browser', st.every((s) => s === 401), st.join(','));
  const r = await signIn(mine, 'donator');
  check("then it answers to the account's lockout like any other", r.status === 429, d(r));
}

console.log('\n5. signing out everywhere forgets every known browser');
{
  await resetAddressLimits();
  const pc = browser();
  const first = await signIn(pc, 'plainuser');
  check('plainuser signs in', first.status === 200, d(first));
  const out = await call(pc, '/api/me/sessions/revoke-all', { method: 'POST' });
  check('and signs out everywhere', out.status === 200, d(out));
  await failTenTimes(browser(), 'plainuser');
  const r = await signIn(pc, 'plainuser');
  check('after which its old cookie exempts nothing', r.status === 429, d(r));
}

// The counters this scenario filled must not leak into the next one.
await resetRateLimits();
report();
