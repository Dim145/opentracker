/**
 * The public room — palier P5.
 *
 * What this pins is the part that only shows under pressure: the room has
 * no participants, so the only per-member state is a mute; slow mode is a
 * self-expiring key rather than a column; and retention is a DROP of whole
 * partitions, which is why the table was partitioned on day one even
 * though nothing wrote to it until now.
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

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

const ROOM = '/api/messaging/room';
const d = (value, max = 140) =>
  String(JSON.stringify(value) ?? value).slice(0, max);

async function setRoom(scope, extra = {}) {
  return (
    await req('founder', '/api/admin/settings', {
      method: 'PUT',
      body: { messagingRoomScope: scope, ...extra },
    })
  ).status;
}

async function main() {
  await resetRateLimits();

  console.log('\n1. off is invisible');

  await setRoom('off');
  await resetRateLimits();
  for (const who of ['founder', 'donator']) {
    check(
      `${who} gets 404 while the room is off`,
      (await req(who, ROOM)).status === 404
    );
  }
  const anon = await fetch(`${API}${ROOM}`);
  check('and an anonymous caller gets 401', anon.status === 401, String(anon.status));

  console.log('\n2. staff, then everyone');

  check('the scope moves to staff', (await setRoom('staff')) === 200);
  await resetRateLimits();
  check('an admin is let in', (await req('founder', ROOM)).status === 200);
  check(
    'a member is not',
    (await req('donator', ROOM)).status === 404,
    String((await req('donator', ROOM)).status)
  );

  check('the scope opens to all', (await setRoom('all')) === 200);
  await resetRateLimits();
  check('now the member is', (await req('donator', ROOM)).status === 200);

  console.log('\n3. saying something');

  const said = await req('donator', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'bonjour le salon' },
  });
  check('a member posts', said.status === 200 && !!said.body?.id, `${said.status} ${d(said.body)}`);

  const page = await req('plainuser', ROOM);
  check(
    'and everybody sees it — the room has no membership to join',
    page.body?.messages?.some((m) => m.body === 'bonjour le salon'),
    d(page.body?.messages?.slice(0, 2), 180)
  );
  check(
    'attributed',
    page.body?.messages?.find((m) => m.body === 'bonjour le salon')?.author?.username ===
      'donator',
    d(page.body?.messages?.[0]?.author)
  );

  console.log('\n4. slow mode');

  await resetRateLimits();
  check('slow mode is set to 3s', (await setRoom('all', { messagingRoomSlowModeSeconds: 3 })) === 200);
  await resetRateLimits();

  const first = await req('plainuser', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'premier' },
  });
  const second = await req('plainuser', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'deuxième, trop vite' },
  });
  check('the first goes through', first.status === 200, String(first.status));
  check(
    'the second is held back',
    second.status === 429,
    `${second.status} ${d(second.body, 120)}`
  );
  check(
    'and says how long to wait, rather than just refusing',
    typeof second.body?.data?.retryAfter === 'number',
    d(second.body?.data)
  );

  // Slow mode damps a flood; the people expected to talk it down should
  // not be damped by it.
  const staffBurst = await Promise.all([
    req('founder', `${ROOM}/messages`, { method: 'POST', body: { body: 'staff 1' } }),
    req('founder', `${ROOM}/messages`, { method: 'POST', body: { body: 'staff 2' } }),
  ]);
  check(
    'staff are exempt',
    staffBurst.every((r) => r.status === 200),
    staffBurst.map((r) => r.status).join(',')
  );

  await sleep(3200);
  check(
    'and the wait actually expires',
    (await req('plainuser', `${ROOM}/messages`, {
      method: 'POST',
      body: { body: 'après le délai' },
    })).status === 200
  );

  check('slow mode goes back off', (await setRoom('all', { messagingRoomSlowModeSeconds: 0 })) === 200);

  console.log('\n5. muting');

  await resetRateLimits();
  const muted = await req('founder', '/api/mod/room/mutes', {
    method: 'POST',
    body: { username: 'donator', hours: 1, reason: 'flood' },
  });
  check('staff can mute a member', muted.status === 200, `${muted.status} ${d(muted.body, 120)}`);

  const refused = await req('donator', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'toujours là' },
  });
  check('the muted member is refused', refused.status === 403, String(refused.status));
  check(
    'and told until when — silence with no end reads as a ban',
    !!refused.body?.data?.mutedUntil,
    d(refused.body?.data)
  );

  const view = await req('donator', ROOM);
  check('the page carries it too', !!view.body?.mutedUntil, d(view.body?.mutedUntil));

  check(
    'staff cannot mute staff here',
    (await req('founder', '/api/mod/room/mutes', {
      method: 'POST',
      body: { username: 'founder', hours: 1 },
    })).status === 403
  );
  check(
    'and a member cannot mute at all',
    (await req('plainuser', '/api/mod/room/mutes', {
      method: 'POST',
      body: { username: 'donator', hours: 1 },
    })).status === 403
  );

  await resetRateLimits();
  check(
    'the mute lifts',
    (await req('founder', '/api/mod/room/mutes/donator', { method: 'DELETE' })).status === 200
  );
  check(
    'and they can talk again',
    (await req('donator', `${ROOM}/messages`, {
      method: 'POST',
      body: { body: 'de retour' },
    })).status === 200
  );

  console.log('\n6. removing a message');

  await resetRateLimits();
  const target = await req('donator', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'à retirer du salon' },
  });
  check(
    'the author cannot remove their own — the room is a shared log',
    (await req('donator', `${ROOM}/messages/${target.body.id}`, { method: 'DELETE' }))
      .status === 403
  );
  check(
    'staff can',
    (await req('founder', `${ROOM}/messages/${target.body.id}`, { method: 'DELETE' }))
      .status === 200
  );

  const after = await req('plainuser', ROOM);
  const removed = after.body?.messages?.find((m) => m.id === target.body.id);
  check(
    'the row stays, blanked, so the log still reads',
    removed?.deleted === true && removed?.body === null,
    d(removed, 140)
  );

  console.log('\n7. back to off');

  check('the room closes', (await setRoom('off')) === 200);
  await resetRateLimits();
  check(
    'and everything with it',
    (await req('founder', ROOM)).status === 404 &&
      (await req('founder', `${ROOM}/messages`, {
        method: 'POST',
        body: { body: 'hello' },
      })).status === 404
  );

  report();
}

main();
