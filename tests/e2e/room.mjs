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

  // Reactions and edits fan out to every connected reader exactly like a
  // message does, so slow mode has to cover them. It did not: while
  // messages waited, the same member could toggle reactions at the
  // mutation-limiter rate and each toggle went out to the whole room.
  const slowTarget = second.status === 429
    ? ((await req('plainuser', ROOM)).body?.messages ?? []).find((m) => !m.deleted)
    : null;
  if (slowTarget) {
    check(
      'reactions wait for slow mode too',
      (await req('plainuser', `${ROOM}/messages/${slowTarget.id}/reactions`, {
        method: 'POST',
        body: { key: 'up' },
      })).status === 429
    );
  }

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

  // `/unmute` takes a name, so there has to be somewhere to read one.
  // Without the list a moderator coming on after somebody else has a
  // command they cannot use, and the only way out is to wait.
  await resetRateLimits();
  const muteList = await req('founder', '/api/mod/room/mutes');
  check(
    'staff can see who is muted, and until when',
    muteList.status === 200 &&
      (muteList.body?.mutes ?? []).some(
        (m) => m.username === 'donator' && !!m.until
      ),
    `${muteList.status} ${d(muteList.body, 160)}`
  );
  check(
    'and a member cannot read that list either',
    (await req('plainuser', '/api/mod/room/mutes')).status === 403
  );

  await resetRateLimits();
  check(
    'the mute lifts',
    (await req('founder', '/api/mod/room/mutes/donator', { method: 'DELETE' })).status === 200
  );
  check(
    'and leaves the list with it',
    !((await req('founder', '/api/mod/room/mutes')).body?.mutes ?? []).some(
      (m) => m.username === 'donator'
    )
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

  console.log('\n7. live delivery through the relay');

  // The relay had no end-to-end coverage at all: the suite proved the
  // token endpoint minted a grant and stopped there. SSE is a streaming
  // GET, so `fetch` plus a reader is enough — no EventSource needed, and
  // Node has none.
  //
  // Note what this does NOT cover: whether a page ever opens the stream.
  // `chat.vue` destructured `connected` and never called `start()`, so
  // the room said "offline" in every browser while everything below
  // passed. That gap is closed by the composable starting itself.
  //
  // The token endpoint is behind `requireDmAccess`, and this scenario only
  // ever touches the ROOM scope — the DM one is left wherever the previous
  // scenario put it, and `messaging.mjs` ends with both off. Turned on for
  // this phase and put back at the end, like every other fixture here.
  await resetRateLimits();
  check(
    'direct messages are on, so a relay token can be minted',
    (await req('founder', '/api/admin/settings', {
      method: 'PUT',
      body: { messagingDmScope: 'all' },
    })).status === 200
  );

  const grant = await req('plainuser', '/api/messaging/token');
  check(
    'a member is granted a relay token that carries the room',
    grant.status === 200 && !!grant.body?.token && grant.body?.room === true,
    d(grant.body, 120)
  );

  if (grant.body?.token) {
    const url = `${grant.body.url.replace(/\/$/, '')}/events?token=${encodeURIComponent(grant.body.token)}`;
    const ac = new AbortController();
    // Bounded on both ends: the abort below and the reader loop's own cap.
    const timer = setTimeout(() => ac.abort(), 12000);
    let opened = false;
    let seen = '';
    try {
      const res = await fetch(url, {
        headers: { accept: 'text/event-stream' },
        signal: ac.signal,
      });
      opened = res.status === 200 &&
        (res.headers.get('content-type') ?? '').includes('text/event-stream');
      check('the relay opens the stream', opened, `${res.status} ${res.headers.get('content-type')}`);

      if (opened) {
        // Say something in the room once the stream is up.
        const posted = await req('founder', `${ROOM}/messages`, {
          method: 'POST',
          body: { body: 'en direct depuis le relais' },
        });
        check('and a message can be posted while it is open', posted.status === 200);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        // At most 40 chunks, so a silent relay ends the test rather than
        // hanging it.
        for (let i = 0; i < 40 && !seen.includes('en direct depuis le relais'); i += 1) {
          const { value, done } = await reader.read();
          if (done) break;
          seen += dec.decode(value, { stream: true });
        }
        check(
          'and the room frame arrives on it',
          seen.includes('en direct depuis le relais'),
          seen.slice(0, 160)
        );
      }
    } catch (err) {
      check('the relay stream works', false, String(err).slice(0, 120));
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
  }

  // Put the DM scope back where this scenario found it.
  await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { messagingDmScope: 'off' },
  });

  console.log('\n8. back to off');

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
