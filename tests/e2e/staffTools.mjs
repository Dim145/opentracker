/**
 * The staff half of messaging: the queue exemption, the room pin, and
 * broadcasts.
 *
 * The exemption is the one worth pinning hardest. The design always said
 * staff write directly, and for a long time nothing implemented it — so a
 * moderator writing "your upload was rejected, here is why" landed in the
 * member's request queue, next to the spam it exists to hold, where it
 * can be refused unread. Refusing silently blocks the sender, so the
 * member then never hears from staff again and nobody finds out.
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

const DM = '/api/messaging/conversations';
const d = (v, max = 160) => String(JSON.stringify(v) ?? v).slice(0, max);

/**
 * Broadcasting sits behind `requireFreshAuth`, and the session in
 * session.json was minted when the suite started — which by the time this
 * scenario runs may be well past the ten-minute window. Logging in again
 * is what makes this independent of where it sits in the run.
 */
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
  const proof = await generateLoginProof(
    'E2e-Passw0rd!founder', chal.salt, chal.challenge,
  );
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: JSON.stringify({ username: 'founder', challenge: chal.challenge, proof }),
  });
  absorb(loginRes);
  if (loginRes.status === 200) {
    S.founder.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  return loginRes.status;
}

async function main() {
  await resetRateLimits();
  check('the founder can re-authenticate', (await refreshFounder()) === 200);

  await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { messagingDmScope: 'all', messagingRoomScope: 'all' },
  });
  await resetRateLimits();

  console.log('\n1. staff skip the first-contact queue');

  // A fresh pair, so the conversation is genuinely a first contact
  // rather than one an earlier scenario already opened.
  const list0 = await req('plainuser', DM);
  const before = new Set(
    [...(list0.body?.inbox ?? []), ...(list0.body?.requests ?? [])].map((c) => c.id),
  );

  const staffConv = await req('founder', DM, {
    method: 'POST',
    body: { username: 'plainuser' },
  });
  check('a staff member can open a conversation', staffConv.status === 200, d(staffConv.body));
  await req('founder', `${DM}/${staffConv.body?.id}/messages`, {
    method: 'POST',
    body: { body: 'Your upload was rejected — the sample file is missing.' },
  });

  const list1 = await req('plainuser', DM);
  const inInbox = (list1.body?.inbox ?? []).some((c) => c.id === staffConv.body?.id);
  const inRequests = (list1.body?.requests ?? []).some((c) => c.id === staffConv.body?.id);
  check(
    'and it lands in the inbox, not the request queue',
    inInbox && !inRequests,
    `inbox=${inInbox} requests=${inRequests} new=${!before.has(staffConv.body?.id)}`
  );

  await resetRateLimits();
  console.log('\n2. and an ordinary member still does not');

  const memberConv = await req('donator', DM, {
    method: 'POST',
    body: { username: 'plainuser' },
  });
  const list2 = await req('plainuser', DM);
  const memberInRequests =
    (list2.body?.requests ?? []).some((c) => c.id === memberConv.body?.id) ||
    (list2.body?.inbox ?? []).some((c) => c.id === memberConv.body?.id);
  check(
    'the queue still exists for everybody else',
    memberConv.status === 200 && memberInRequests,
    d({ status: memberConv.status, id: memberConv.body?.id })
  );

  await resetRateLimits();
  console.log('\n3. the room pin');

  const said = await req('plainuser', '/api/messaging/room/messages', {
    method: 'POST',
    body: { body: 'Reminder: retention here is fourteen days.' },
  });
  const roomId = said.body?.id;
  check('a message to pin', said.status === 200 && !!roomId, d(said.body));

  await resetRateLimits();
  check(
    'a member cannot pin',
    (await req('plainuser', '/api/mod/room/pin', {
      method: 'POST',
      body: { messageId: roomId },
    })).status === 403
  );

  await resetRateLimits();
  const pinned = await req('founder', '/api/mod/room/pin', {
    method: 'POST',
    body: { messageId: roomId },
  });
  check('staff can', pinned.status === 200, d(pinned.body));

  let room = await req('donator', '/api/messaging/room');
  check(
    'and everybody sees it above the log',
    room.body?.pinned?.id === roomId,
    d(room.body?.pinned)
  );

  await resetRateLimits();
  const second = await req('plainuser', '/api/messaging/room/messages', {
    method: 'POST',
    body: { body: 'Another announcement.' },
  });
  await req('founder', '/api/mod/room/pin', {
    method: 'POST',
    body: { messageId: second.body?.id },
  });
  room = await req('donator', '/api/messaging/room');
  check(
    'pinning a second one replaces the first — there is only ever one',
    room.body?.pinned?.id === second.body?.id,
    d(room.body?.pinned)
  );

  await resetRateLimits();
  await req('founder', '/api/mod/room/pin', { method: 'DELETE' });
  room = await req('donator', '/api/messaging/room');
  check('unpinning clears it', room.body?.pinned === null, d(room.body?.pinned));

  check(
    'and unpinning nothing is not an error',
    (await req('founder', '/api/mod/room/pin', { method: 'DELETE' })).status === 200
  );

  await resetRateLimits();
  // Removing the pinned message must take the pin with it. The read path
  // already refused to show a pin on a removed message, so the banner
  // disappeared — and the row stayed, leaving the room carrying a pin
  // pointing at nothing that no unpin had been asked for.
  const doomed = await req('plainuser', '/api/messaging/room/messages', {
    method: 'POST',
    body: { body: 'Pinned, then removed.' },
  });
  await resetRateLimits();
  await req('founder', '/api/mod/room/pin', {
    method: 'POST',
    body: { messageId: doomed.body?.id },
  });
  await resetRateLimits();
  await req('founder', `/api/messaging/room/messages/${doomed.body?.id}`, {
    method: 'DELETE',
  });
  room = await req('donator', '/api/messaging/room');
  check(
    'removing the pinned message clears the pin',
    room.body?.pinned === null,
    d(room.body?.pinned)
  );

  await resetRateLimits();
  check(
    'and a removed message cannot be pinned in the first place',
    (await req('founder', '/api/mod/room/pin', {
      method: 'POST',
      body: { messageId: doomed.body?.id },
    })).status === 409
  );

  await resetRateLimits();
  console.log('\n4. broadcasts');

  check(
    'a member cannot broadcast',
    (await req('plainuser', '/api/admin/messaging/broadcast', {
      method: 'POST',
      body: { audience: 'staff', body: 'hello' },
    })).status === 403
  );

  await resetRateLimits();
  check(
    'an unknown audience is refused',
    (await req('founder', '/api/admin/messaging/broadcast?audience=everybody')).status === 400
  );

  // There is deliberately no "all members" audience: a private message to
  // the whole membership is an announcement, and the site has a banner.
  check(
    'and so is the unbounded one',
    (await req('founder', '/api/admin/messaging/broadcast?audience=all')).status === 400
  );

  // Measured relatively, not against a fixed number.
  //
  // How many staff exist depends on what ran before — the suite starts
  // from an empty database where the founder is the only one, a
  // demo-seeded stack has several. Asserting "zero" pinned the fixture
  // rather than the rule, and broke the moment the stack had staff.
  const staffBefore = await req('founder', '/api/admin/messaging/broadcast?audience=staff');
  check(
    'the audience resolves to a count',
    staffBefore.status === 200 && typeof staffBefore.body?.count === 'number',
    d(before.body)
  );
  const baseline = staffBefore.body?.count ?? 0;

  // An empty audience must be refused rather than silently succeeding —
  // a broadcast that reached nobody looks identical to one that worked.
  // `inactive:3650` is empty by construction: nothing on a stack this
  // young has been away for ten years.
  await resetRateLimits();
  await refreshFounder();
  check(
    'and an empty one is refused rather than silently doing nothing',
    (await req('founder', '/api/admin/messaging/broadcast', {
      method: 'POST',
      body: { audience: 'inactive:3650', body: 'to nobody' },
    })).status === 409
  );

  // One more staff member, so the delta is exactly one whatever the
  // starting point was — and so the delivery path is exercised.
  await resetRateLimits();
  await refreshFounder();
  const promoted = await req('founder', `/api/admin/users/${S.donator.id}/role`, {
    method: 'PUT',
    body: { isAdmin: false, isModerator: true },
  });
  check('a member can be appointed to staff', promoted.status === 200, d(promoted.body));

  await resetRateLimits();
  const preview = await req('founder', '/api/admin/messaging/broadcast?audience=staff');
  check(
    'and the audience grows by exactly one',
    preview.status === 200 && preview.body?.count === baseline + 1,
    `${d(preview.body?.count)} vs baseline ${baseline}`
  );
  const expected = preview.body?.count ?? 0;

  await resetRateLimits();
  await refreshFounder();
  const sent = await req('founder', '/api/admin/messaging/broadcast', {
    method: 'POST',
    body: { audience: 'staff', body: 'Staff sync at the usual time.' },
  });
  check(
    'the broadcast starts and reports its total',
    sent.status === 200 && sent.body?.total === expected,
    `${sent.status} ${d(sent.body)} expected=${expected}`
  );

  // Delivery runs behind the response, so give it a moment before asking.
  for (let i = 0; i < 20; i += 1) {
    const now = await req('founder', '/api/admin/messaging/broadcast');
    const row = (now.body?.history ?? []).find((h) => h.id === sent.body?.id);
    if (row?.finishedAt) {
      check(
        'and finishes, with the count it promised',
        row.sent === row.total,
        d(row)
      );
      break;
    }
    if (i === 19) check('the broadcast finishes', false, 'still running after 20 polls');
    await new Promise((r) => setTimeout(r, 250));
  }

  // It arrives as a real conversation in the inbox — not a notification,
  // and not sitting in the request queue.
  const inbox = await req('donator', DM);
  const fromStaff = (inbox.body?.inbox ?? []).some((c) => c.with?.username === 'founder');
  check(
    'and lands in the recipient inbox as an answerable conversation',
    fromStaff,
    d((inbox.body?.inbox ?? []).map((c) => c.with?.username))
  );

  // A broadcast cannot be sealed for each recipient — the sender never
  // holds thousands of public keys, and delivery runs on the server with
  // no key at all — so it is written in clear, including into a
  // conversation the pair opened encrypted. There is one conversation
  // per pair, so there is nowhere else to put it.
  //
  // Pinned here rather than left to be rediscovered. The thread wears a
  // padlock; the client marks any line that does not keep that promise,
  // and it recognises them by exactly this shape: a body, no cipher.
  const thread = (inbox.body?.inbox ?? []).find(
    (c) => c.with?.username === 'founder'
  );
  if (thread?.encrypted) {
    const msgs = await req('donator', `${DM}/${thread.id}/messages`);
    const line = (msgs.body?.messages ?? []).find(
      (m) => m.body === 'Staff sync at the usual time.'
    );
    check(
      'a broadcast into an encrypted thread arrives in clear, and is shaped so the reader can tell',
      !!line && line.cipher === null,
      d(line)
    );
  }

  // Put the fixture back: later scenarios assume donator is an ordinary
  // member, and a scenario that changes the world it runs in is a
  // scenario that breaks the next one.
  await resetRateLimits();
  await refreshFounder();
  await req('founder', `/api/admin/users/${S.donator.id}/role`, {
    method: 'PUT',
    body: { isAdmin: false, isModerator: false },
  });

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
