/**
 * Seed the throwaway e2e stack through the real HTTP surface.
 *
 * Registration and login go through the zero-knowledge flow and the
 * proof-of-work gate exactly as a browser does — no SQL shortcuts — so the
 * session this produces is a real one and the accounts it creates have real
 * verifiers. `apps/web/app/utils/crypto.ts` is the browser's own module; Node 24
 * has WebCrypto globally, so it runs here unchanged.
 *
 * Usage:  node seed.mjs            (register founder + members, print cookies)
 *         node seed.mjs --whoami   (re-login and dump the session)
 */
import { generateCredentials, generateLoginProof, solvePoW } from './crypto.mjs';

const API = process.env.E2E_API ?? 'http://localhost:54000';

const ACCOUNTS = [
  // The first account registered becomes admin, and the API requires a panic
  // password for it — see doc/guide/panic-mode.md. Only the first one needs it.
  {
    username: 'founder',
    email: 'founder@e2e.test',
    password: 'E2e-Passw0rd!founder',
    panicPassword: 'E2e-Pan1c!founder',
  },
  { username: 'donator', email: 'donator@e2e.test', password: 'E2e-Passw0rd!donator' },
  { username: 'plainuser', email: 'plain@e2e.test', password: 'E2e-Passw0rd!plain' },
];

/** Cookie jar, per account. */
const jars = new Map();

function jarFor(name) {
  if (!jars.has(name)) jars.set(name, new Map());
  return jars.get(name);
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorb(jar, res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function call(path, { method = 'GET', body, jar, expect } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(jar && jar.size ? { cookie: cookieHeader(jar) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  if (jar) absorb(jar, res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (expect && res.status !== expect) {
    throw new Error(`${method} ${path} -> ${res.status} (wanted ${expect})\n${text.slice(0, 400)}`);
  }
  return { status: res.status, body: json };
}

/**
 * The stack's own DDoS layer blacklists this IP for 300 s after a handful of
 * auth calls in quick succession, which is correct behaviour and exactly what a
 * seeding script looks like. Pace the calls rather than defeat the protection.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pow() {
  const { body } = await call('/api/auth/pow', { expect: 200 });
  return solvePoW(body.challenge, body.difficulty);
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
      ...(acc.panicPassword ? { panicPassword: acc.panicPassword } : {}),
    },
  });
  return { status, body, jar };
}

async function login(acc) {
  const jar = jarFor(acc.username);
  jar.clear();
  const chal = await call(
    `/api/auth/challenge?username=${encodeURIComponent(acc.username)}`,
    { jar, expect: 200 },
  );
  const proof = await generateLoginProof(acc.password, chal.body.salt, chal.body.challenge);
  const { status, body } = await call('/api/auth/login', {
    method: 'POST',
    jar,
    body: { username: acc.username, challenge: chal.body.challenge, proof },
  });
  return { status, body, jar };
}

const out = {};

/**
 * Registering the founder closes registration behind them — `register.post.ts`
 * calls `setRegistrationOpen(false)` once the first account settles, which is
 * the right default for a private tracker and the reason this cannot be done
 * once up front. So the founder reopens it, through the admin route, which is
 * also the only path that invalidates the in-process settings cache properly.
 */
async function openRegistration() {
  const { status } = await call('/api/admin/settings', {
    method: 'PUT',
    jar: jarFor('founder'),
    body: { registrationOpen: true },
  });
  console.error(`  registration reopened by founder -> ${status}`);
  return status;
}

let opened = false;

for (const acc of ACCOUNTS) {
  if (!opened && Object.keys(out).length > 0) {
    await openRegistration();
    opened = true;
  }
  await sleep(6000);
  let r = await register(acc);
  if (r.status !== 200 && r.status !== 201) {
    console.error(`  register(${acc.username}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    // Already there from a previous run — log in instead.
    r = await login(acc);
  }
  if (r.status !== 200 && r.status !== 201) {
    console.error(`${acc.username}: ${r.status}`, JSON.stringify(r.body).slice(0, 300));
    continue;
  }
  const who = await call('/api/auth/status', { jar: r.jar });
  out[acc.username] = {
    cookie: cookieHeader(r.jar),
    isAdmin: who.body?.user?.isAdmin ?? null,
    isOwner: who.body?.user?.isOwner ?? null,
    theme: who.body?.user?.theme ?? null,
    id: who.body?.user?.id ?? null,
  };
  console.error(
    `${acc.username.padEnd(10)} admin=${out[acc.username].isAdmin} owner=${out[acc.username].isOwner} theme=${out[acc.username].theme}`,
  );
}

/**
 * Log the founder in again, so their session is FRESH.
 *
 * Registration proves knowledge of the credential at least as strongly as a
 * login does, but `markFreshAuth` is only called by `login.post.ts` — so a
 * just-registered account cannot use anything behind `requireFreshAuth`
 * (ownership transfer, raw CSS, role changes) until it logs in once. That is the
 * application's behaviour, not a harness quirk, and a scenario that wants to
 * exercise the success path has to do what a real owner would do.
 *
 * Only the founder, and only at the end: the auth limiter allows five calls per
 * five minutes and a challenge plus a login is two of them.
 */
if (out.founder) {
  await sleep(2000);
  const again = await login(ACCOUNTS[0]);
  if (again.status === 200 || again.status === 201) {
    out.founder.cookie = cookieHeader(again.jar);
    console.error('  founder re-logged in (session is now fresh)');
  } else {
    console.error(`  founder re-login FAILED -> ${again.status}`);
  }
}

console.log(JSON.stringify(out, null, 2));
