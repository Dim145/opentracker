/**
 * What erasing an account does to the messages it leaves behind.
 *
 * This is the one part of the messaging design that cannot be checked by
 * reading the schema, because the schema is misleading here: every
 * messaging table has an `ON DELETE` clause pointing at `users`, and not
 * one of them ever fires. `eraseAccount` keeps the row and blanks it, so
 * the foreign keys stay valid and the cascades stay asleep. Every rule
 * below is therefore hand-written code, and hand-written code that
 * nothing exercises is code that quietly stops being true.
 *
 * The split under test: plaintext survives without an author, ciphertext
 * is destroyed, and the account stops being addressable.
 *
 * Registers its own throwaway account, so it costs one proof-of-work and
 * disturbs nothing else in the run. Runs after `messaging`, which leaves
 * the scopes where it wants them — this sets its own.
 */
import {
  API,
  caller,
  check,
  report,
  resetRateLimits,
  sessions,
  sleep,
} from './lib.mjs';
import { generateCredentials, solvePoW } from './crypto.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

const DM = '/api/messaging/conversations';
const d = (value, max = 160) =>
  String(JSON.stringify(value) ?? value).slice(0, max);

// A fresh name every run: the account is destroyed at the end, but a
// re-run against a kept stack must not collide with the blanked row.
const NAME = `erasable${Date.now().toString(36).slice(-6)}`;
const PASSWORD = 'E2e-Passw0rd!erasable';

// ── Registering one account, by hand ─────────────────────────────────
const jar = new Map();
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function raw(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  const c = cookie();
  if (c) headers.cookie = c;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function main() {
  await resetRateLimits();

  console.log('\n1. a member with something to leave behind');

  await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { messagingDmScope: 'all', registrationOpen: true },
  });
  await resetRateLimits();

  const creds = await generateCredentials(PASSWORD);
  const pow = await raw('/api/auth/pow');
  const solved = await solvePoW(
    pow.body?.challenge, pow.body?.difficulty, undefined, 240_000,
  );
  const reg = await raw('/api/auth/register', {
    method: 'POST',
    body: {
      username: NAME,
      email: `${NAME}@e2e.test`,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      authSalt: creds.salt,
      authVerifier: creds.verifier,
      powChallenge: solved.challenge,
      powNonce: solved.nonce,
      powHash: solved.hash,
    },
  });
  check('the throwaway account registers', reg.status === 200 || reg.status === 201,
    `${reg.status} ${d(reg.body)}`);
  if (reg.status !== 200 && reg.status !== 201) return report();

  // It publishes a messaging key, the way a browser would before opening
  // its first encrypted conversation.
  const keyPut = await raw('/api/messaging/keys', {
    method: 'PUT',
    // A real uncompressed P-256 SPKI. The route validates the bytes —
    // prefix and length — so a plausible-looking string is not enough.
    body: {
      publicKey:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVbdpcnLyqAqB6R5SdbsUHXZPltQpew7eeaCh_-TlKaagfLgBzZ3TxAv8JQGlya-mKuxEDCiw8HdPIyTa5fouSw',
      deviceLabel: 'harness',
    },
  });
  check('and publishes a messaging key', keyPut.status === 200,
    `${keyPut.status} ${d(keyPut.body)}`);

  check(
    'which another member can fetch',
    (await req('plainuser', `/api/messaging/keys/${NAME}`)).body?.available === true,
    d((await req('plainuser', `/api/messaging/keys/${NAME}`)).body)
  );

  await resetRateLimits();
  console.log('\n2. one plaintext thread, one encrypted');

  const plain = await raw(DM, { method: 'POST', body: { username: 'plainuser' } });
  const plainId = plain.body?.id;
  check('a plaintext conversation opens', plain.status === 200 && !!plainId,
    `${plain.status} ${d(plain.body)}`);
  await req('plainuser', `${DM}/${plainId}/accept`, { method: 'POST' });
  await raw(`${DM}/${plainId}/messages`, {
    method: 'POST',
    body: { body: 'Something worth keeping.' },
  });
  await req('plainuser', `${DM}/${plainId}/messages`, {
    method: 'POST',
    body: { body: 'Noted, thanks.' },
  });

  const enc = await raw(DM, {
    method: 'POST',
    body: { username: 'donator', encrypted: true },
  });
  const encId = enc.body?.id;
  check('an encrypted conversation opens', enc.status === 200 && !!encId,
    `${enc.status} ${d(enc.body)}`);
  await req('donator', `${DM}/${encId}/accept`, { method: 'POST' });
  await raw(`${DM}/${encId}/messages`, {
    method: 'POST',
    body: { cipher: 'q80', iv: 'q80' },
  });

  const beforeEnc = await req('donator', `${DM}/${encId}/messages`);
  check('the ciphertext is there before erasure',
    beforeEnc.body?.messages?.length === 1,
    d(beforeEnc.body?.messages));

  const beforePlain = await req('plainuser', `${DM}/${plainId}/messages`);
  check('and the plaintext thread names its author',
    beforePlain.body?.messages?.some((m) => m.author?.username === NAME),
    d(beforePlain.body?.messages?.map((m) => m.author?.username)));

  await resetRateLimits();
  console.log('\n3. erased');

  const gone = await raw('/api/me', {
    method: 'DELETE',
    body: { confirm: NAME },
  });
  check('the account erases', gone.status === 200, `${gone.status} ${d(gone.body)}`);

  await resetRateLimits();
  console.log('\n4. plaintext survives, without a name on it');

  const afterPlain = await req('plainuser', `${DM}/${plainId}/messages`);
  check(
    'the messages are still readable',
    afterPlain.body?.messages?.length === 2 &&
      afterPlain.body.messages.some((m) => m.body === 'Something worth keeping.'),
    d(afterPlain.body?.messages?.map((m) => m.body))
  );
  check(
    'but the erased author resolves to nobody',
    afterPlain.body?.messages?.every((m) => m.author === null || m.author?.username === 'plainuser'),
    d(afterPlain.body?.messages?.map((m) => m.author?.username ?? null))
  );
  // The row survives blanked, so the join is the only thing standing
  // between the interface and a `deleted-<random>` byline.
  check(
    'and no deleted-* placeholder leaks into the thread',
    !JSON.stringify(afterPlain.body ?? {}).includes('deleted-'),
    d(afterPlain.body?.messages?.map((m) => m.author))
  );

  const list = await req('plainuser', DM);
  const row = [...(list.body?.inbox ?? []), ...(list.body?.requests ?? [])]
    .find((c) => c.id === plainId);
  check('the conversation is still listed', !!row, d(list.body?.inbox?.map((c) => c.id)));
  check('with no correspondent to name', row?.with === null, d(row));

  await resetRateLimits();
  console.log('\n5. ciphertext is gone, and says so');

  const afterEnc = await req('donator', `${DM}/${encId}/messages`);
  check(
    'every encrypted message was destroyed',
    afterEnc.body?.messages?.length === 0,
    d(afterEnc.body?.messages)
  );

  const encList = await req('donator', DM);
  const encRow = [...(encList.body?.inbox ?? []), ...(encList.body?.requests ?? [])]
    .find((c) => c.id === encId);
  check('the conversation itself remains', !!encRow, d(encRow));
  check(
    'flagged encrypted, with nobody on the other side — which is what the page explains',
    encRow?.encrypted === true && encRow?.with === null,
    d(encRow)
  );
  check(
    'and its unread badge was cleared with the messages it counted',
    encRow?.unreadCount === 0,
    d(encRow?.unreadCount)
  );

  await resetRateLimits();
  console.log('\n6. the account is no longer addressable');

  check(
    'its published key is not served',
    (await req('plainuser', `/api/messaging/keys/${NAME}`)).status === 404,
    d((await req('plainuser', `/api/messaging/keys/${NAME}`)).status)
  );
  check(
    'and nobody can open a conversation with it',
    (await req('plainuser', DM, { method: 'POST', body: { username: NAME } })).status === 404,
    d((await req('plainuser', DM, { method: 'POST', body: { username: NAME } })).body)
  );

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
