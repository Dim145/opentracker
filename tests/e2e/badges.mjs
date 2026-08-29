/**
 * The one badge beside a name, and the order that picks it.
 *
 * A message line has room for a name and a marker. Showing every role a
 * member holds turns that into five chips that push the message off the
 * screen and stop meaning anything individually — so exactly one is
 * chosen, and this pins the order that chooses it:
 *
 *   owner → admin → moderator → highest-priority PUBLIC role → nothing
 *
 * Staff always wins. A moderator who also holds "Uploader" reads as a
 * moderator, because that is the fact that changes how you read what
 * they wrote. And a role the operator did not mark public never shows:
 * `showAsBadge` is them saying this one is a label, not a permission.
 */
import {
  API,
  caller,
  check,
  report,
  resetRateLimits,
  sessions,
} from './lib.mjs';
import { generateLoginProof } from './crypto.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

const ROOM = '/api/messaging/room';
const d = (v, max = 200) => String(JSON.stringify(v) ?? v).slice(0, max);

/** Role changes sit behind fresh auth; see staffTools for the reasoning. */
async function refreshFounder() {
  const jar = new Map();
  const absorb = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const chalRes = await fetch(`${API}/api/auth/challenge?username=founder`);
  absorb(chalRes);
  const chal = await chalRes.json();
  const proof = await generateLoginProof('E2e-Passw0rd!founder', chal.salt, chal.challenge);
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: JSON.stringify({ username: 'founder', challenge: chal.challenge, proof }),
  });
  absorb(res);
  if (res.status === 200) {
    S.founder.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  return res.status;
}

/** The badge the room shows for a member's most recent message. */
async function badgeOf(username) {
  const page = await req('founder', ROOM);
  const line = (page.body?.messages ?? []).find(
    (m) => m.author?.username === username
  );
  return line?.author?.badge ?? null;
}

/** Say something, so there is a line carrying the badge. */
const say = (who, text) =>
  req(who, `${ROOM}/messages`, { method: 'POST', body: { body: text } });

async function main() {
  await resetRateLimits();
  check('the founder can re-authenticate', (await refreshFounder()) === 200);

  await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { messagingDmScope: 'all', messagingRoomScope: 'all' },
  });
  await resetRateLimits();

  console.log('\n1. staff, in order');

  await say('founder', 'Owner speaking.');
  check(
    'the owner reads as owner',
    (await badgeOf('founder'))?.kind === 'owner',
    d(await badgeOf('founder'))
  );

  await resetRateLimits();
  await refreshFounder();
  await req('founder', `/api/admin/users/${S.donator.id}/role`, {
    method: 'PUT',
    body: { isAdmin: true, isModerator: true },
  });
  await resetRateLimits();
  await say('donator', 'Admin speaking.');
  check(
    'an admin who is also a moderator reads as admin',
    (await badgeOf('donator'))?.kind === 'admin',
    d(await badgeOf('donator'))
  );

  await resetRateLimits();
  await refreshFounder();
  await req('founder', `/api/admin/users/${S.donator.id}/role`, {
    method: 'PUT',
    body: { isAdmin: false, isModerator: true },
  });
  check(
    'dropping admin leaves moderator',
    (await badgeOf('donator'))?.kind === 'moderator',
    d(await badgeOf('donator'))
  );

  await resetRateLimits();
  console.log('\n2. operator roles');

  const stamp = Date.now().toString(36).slice(-5);
  const mk = (name, showAsBadge, priority) =>
    req('founder', '/api/admin/roles', {
      method: 'POST',
      body: {
        name: `${name}-${stamp}`,
        color: '#8b5cf6',
        showAsBadge,
        priority,
        assignmentMode: 'manual',
      },
    });

  const low = await mk('seeder', true, 10);
  await resetRateLimits();
  const high = await mk('uploader', true, 90);
  await resetRateLimits();
  const hidden = await mk('betatester', false, 500);
  await resetRateLimits();
  check(
    'three roles exist',
    [low, high, hidden].every((r) => r.status === 200 || r.status === 201),
    d([low.status, high.status, hidden.status])
  );
  const roleId = (r) => r.body?.id ?? r.body?.role?.id;

  const attach = (userId, r) =>
    req('founder', `/api/admin/users/${userId}/roles`, {
      method: 'POST',
      body: { roleId: roleId(r) },
    });

  await attach(S.plainuser.id, low);
  await resetRateLimits();
  await say('plainuser', 'Member with one public role.');
  check(
    'a member wears their public role',
    (await badgeOf('plainuser'))?.kind === 'role' &&
      (await badgeOf('plainuser'))?.name?.startsWith('seeder'),
    d(await badgeOf('plainuser'))
  );

  await resetRateLimits();
  await attach(S.plainuser.id, high);
  await resetRateLimits();
  check(
    'and the higher priority one wins',
    (await badgeOf('plainuser'))?.name?.startsWith('uploader'),
    d(await badgeOf('plainuser'))
  );

  await resetRateLimits();
  await attach(S.plainuser.id, hidden);
  await resetRateLimits();
  check(
    'a role that is not a public badge never shows, whatever its priority',
    (await badgeOf('plainuser'))?.name?.startsWith('uploader'),
    d(await badgeOf('plainuser'))
  );

  await resetRateLimits();
  console.log('\n3. staff beats any role');

  await attach(S.donator.id, high);
  await resetRateLimits();
  check(
    'a moderator holding a public role still reads as moderator',
    (await badgeOf('donator'))?.kind === 'moderator',
    d(await badgeOf('donator'))
  );

  await resetRateLimits();
  console.log('\n4. and nothing when there is nothing');

  await refreshFounder();
  await req('founder', `/api/admin/users/${S.donator.id}/role`, {
    method: 'PUT',
    body: { isAdmin: false, isModerator: false },
  });
  await resetRateLimits();
  await req(
    'founder',
    `/api/admin/users/${S.plainuser.id}/roles/${roleId(low)}`,
    { method: 'DELETE' }
  );
  await resetRateLimits();
  await req(
    'founder',
    `/api/admin/users/${S.plainuser.id}/roles/${roleId(high)}`,
    { method: 'DELETE' }
  );
  await resetRateLimits();
  await req(
    'founder',
    `/api/admin/users/${S.plainuser.id}/roles/${roleId(hidden)}`,
    { method: 'DELETE' }
  );
  check(
    'a member with no staff flag and no public role wears nothing',
    (await badgeOf('plainuser')) === null,
    d(await badgeOf('plainuser'))
  );

  // Put the fixture back for whatever runs next.
  await resetRateLimits();
  await req('founder', `/api/admin/users/${S.donator.id}/roles/${roleId(high)}`, {
    method: 'DELETE',
  });

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
