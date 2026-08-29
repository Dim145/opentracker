/**
 * Private messages, palier P1 — the plumbing, before any real-time.
 *
 * What this pins is the part that is hard to change later: the visibility
 * rule, the first-contact queue, the payload rules that the database also
 * enforces, and the denormalised counters that make the inbox cheap. The
 * live delivery arrives in P2/P3 and has its own scenario; nothing here
 * depends on it, which is the point — the feature has to work by
 * reloading the page before it works by pushing.
 *
 * Runs against real sessions from `seed.mjs`, like every other scenario.
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

const DM = '/api/messaging/conversations';

/**
 * Safe detail rendering. `JSON.stringify(undefined)` is `undefined`, and
 * `.slice` on that throws — a test that crashes while describing its own
 * failure hides the failure it was reporting.
 */
const d = (value, max = 140) => String(JSON.stringify(value) ?? value).slice(0, max);

/** Put both messaging scopes where a phase needs them. */
async function setScopes({ dm, room = 'off' }) {
  const res = await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { messagingDmScope: dm, messagingRoomScope: room },
  });
  return res.status;
}

async function main() {
  // run.sh clears these before each scenario; a manual `--only` re-run does
  // not, and three passes in a row is enough to trip the flood detector —
  // which then answers 403 to everything and looks like a permission bug.
  await resetRateLimits();

  console.log('\n1. off is invisible, not forbidden');

  // A previous pass may have left the scope open. Put it back rather than
  // assert a starting state the harness does not guarantee on a re-run.
  await setScopes({ dm: 'off' });
  await resetRateLimits();
  check(
    'the scope reads back as off',
    (await req('founder', '/api/admin/settings')).body?.messagingDmScope ===
      'off',
    d((await req('founder', '/api/admin/settings')).body?.messagingDmScope)
  );

  // 404 rather than 403 throughout: a 403 confirms the feature is there,
  // which an instance running with it off would rather not say.
  for (const who of ['founder', 'donator']) {
    check(
      `${who} gets 404 while it is off`,
      (await req(who, DM)).status === 404,
      String((await req(who, DM)).status)
    );
  }
  const anon = await fetch(`${API}${DM}`);
  check('and an anonymous caller gets 401', anon.status === 401, String(anon.status));

  console.log('\n2. staff only');

  check('the scope moves to staff', (await setScopes({ dm: 'staff' })) === 200);
  await resetRateLimits();

  check(
    'an admin is let in',
    (await req('founder', DM)).status === 200,
    String((await req('founder', DM)).status)
  );
  check(
    'a plain member is still not',
    (await req('donator', DM)).status === 404,
    String((await req('donator', DM)).status)
  );

  console.log('\n3. opening a conversation');

  check('the scope opens to all', (await setScopes({ dm: 'all' })) === 200);
  await resetRateLimits();

  const opened = await req('donator', DM, {
    method: 'POST',
    body: { username: 'plainuser' },
  });
  check(
    'a member opens one',
    opened.status === 200 && !!opened.body?.id,
    `${opened.status} ${d(opened.body)}`
  );
  const convId = opened.body?.id;
  // True only on a clean database, which is what run.sh gives. On a manual
  // re-run the pair already has its DM, and the transition assertions below
  // announce that they are standing down rather than failing on state they
  // do not own.
  const fresh = opened.body?.created === true;
  if (fresh) {
    check('it is created', true);
  } else {
    console.log('  --   the pair already had a conversation; transition checks skipped');
  }

  const again = await req('donator', DM, {
    method: 'POST',
    body: { username: 'plainuser' },
  });
  // A pair has at most one DM. Pressing "message" twice is not an error,
  // and it must not quietly produce a second thread that then diverges.
  check(
    'opening it again returns the same one',
    again.body?.id === convId && again.body?.created === false,
    `${again.body?.id} created=${again.body?.created}`
  );

  check(
    'you cannot open one with yourself',
    (await req('donator', DM, { method: 'POST', body: { username: 'donator' } }))
      .status === 400
  );
  check(
    'nor with somebody who does not exist',
    (await req('donator', DM, { method: 'POST', body: { username: 'nobody-here' } }))
      .status === 404
  );

  await resetRateLimits();
  console.log('\n4. the first-contact queue');

  const senderList = await req('donator', DM);
  check(
    "it sits in the sender's inbox",
    senderList.body?.inbox?.some((c) => c.id === convId),
    d(senderList.body, 160)
  );

  const recipientList = await req('plainuser', DM);
  if (fresh) {
    check(
      "but in the recipient's requests, not their inbox",
      recipientList.body?.requests?.some((c) => c.id === convId) &&
        !recipientList.body?.inbox?.some((c) => c.id === convId),
      d(recipientList.body, 160)
    );
    check(
      'and it names who is writing',
      recipientList.body?.requests?.find((c) => c.id === convId)?.with
        ?.username === 'donator',
      d(recipientList.body?.requests?.find((c) => c.id === convId)?.with)
    );
  }
  // True either way: the recipient can see it somewhere, with a name on it.
  const anywhere = [
    ...(recipientList.body?.inbox ?? []),
    ...(recipientList.body?.requests ?? []),
  ].find((c) => c.id === convId);
  check(
    'the recipient sees it, attributed',
    anywhere?.with?.username === 'donator',
    d(anywhere)
  );

  await resetRateLimits();
  console.log('\n5. sending, and the counters');

  for (const who of ['donator', 'plainuser']) {
    await req(who, `${DM}/${convId}/read`, { method: 'POST' });
  }

  const sent = await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'premier message' },
  });
  check('the message is accepted', sent.status === 200, `${sent.status} ${d(sent.body)}`);

  const forRecipient = (await req('plainuser', DM)).body;
  const recipientRow = [
    ...(forRecipient?.inbox ?? []),
    ...(forRecipient?.requests ?? []),
  ].find((c) => c.id === convId);
  check(
    'the recipient has one unread',
    recipientRow?.unreadCount === 1,
    String(recipientRow?.unreadCount)
  );

  const forSender = (await req('donator', DM)).body;
  const senderRow = forSender?.inbox?.find((c) => c.id === convId);
  check(
    'the sender has none — you do not owe yourself a read',
    senderRow?.unreadCount === 0,
    String(senderRow?.unreadCount)
  );

  const thread = await req('plainuser', `${DM}/${convId}/messages`);
  check(
    'the thread reads back',
    thread.body?.messages?.[0]?.body === 'premier message',
    d(thread.body?.messages?.[0])
  );
  check(
    'with its author',
    thread.body?.messages?.[0]?.author?.username === 'donator',
    d(thread.body?.messages?.[0]?.author)
  );

  await req('plainuser', `${DM}/${convId}/read`, { method: 'POST' });
  const afterRead = (await req('plainuser', DM)).body;
  const readRow = [
    ...(afterRead?.inbox ?? []),
    ...(afterRead?.requests ?? []),
  ].find((c) => c.id === convId);
  check('reading zeroes the counter', readRow?.unreadCount === 0, String(readRow?.unreadCount));

  await resetRateLimits();
  console.log('\n6. answering accepts');

  await req('plainuser', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'réponse' },
  });
  const afterReply = (await req('plainuser', DM)).body;
  check(
    'after replying it is in the inbox and not in requests',
    afterReply?.inbox?.some((c) => c.id === convId) &&
      !afterReply?.requests?.some((c) => c.id === convId),
    d(afterReply, 160)
  );

  await resetRateLimits();
  console.log('\n7. what a stranger may see');

  check(
    'somebody not in the conversation gets 404 on the thread',
    (await req('founder', `${DM}/${convId}/messages`)).status === 404
  );
  check(
    'and cannot post into it',
    (await req('founder', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: { body: 'coucou' },
    })).status === 404
  );

  await resetRateLimits();
  console.log('\n8. payload rules');

  const plain = await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { cipher: 'AAAA', iv: 'AAAA' },
  });
  check(
    'a plain conversation refuses ciphertext',
    plain.status === 400,
    `${plain.status} ${d(plain.body, 120)}`
  );

  const enc = await req('donator', DM, {
    method: 'POST',
    body: { username: 'founder', encrypted: true },
  });
  check('an encrypted conversation can be opened', enc.status === 200 && enc.body?.encrypted === true,
    `${enc.status} ${d(enc.body)}`);
  const encId = enc.body?.id;

  check(
    'and refuses plaintext',
    (await req('donator', `${DM}/${encId}/messages`, {
      method: 'POST',
      body: { body: 'en clair' },
    })).status === 400
  );
  await resetRateLimits();
  const encSent = await req('donator', `${DM}/${encId}/messages`, {
    method: 'POST',
    body: { cipher: 'q80', iv: 'q80' },
  });
  check('while ciphertext goes through', encSent.status === 200, String(encSent.status));

  const encThread = await req('founder', `${DM}/${encId}/messages`);
  check(
    'the server hands back the ciphertext it cannot read',
    encThread.body?.messages?.[0]?.cipher === 'q80' &&
      encThread.body?.messages?.[0]?.body === null,
    d(encThread.body?.messages?.[0])
  );

  console.log('\n9. live delivery through the relay');

  // The relay is the half of messaging that only exists as a separate
  // process. A suite that never boots it proves nothing about the split —
  // and the token format is a contract between two languages, so the
  // useful test is the one that crosses the boundary for real.
  await resetRateLimits();
  const minted = await req('donator', '/api/messaging/token');
  check(
    'the API mints a relay token',
    minted.status === 200 && !!minted.body?.token && !!minted.body?.url,
    `${minted.status} ${d(minted.body, 120)}`
  );

  if (minted.status === 200) {
    const relay = process.env.E2E_RELAY ?? 'http://localhost:54100';

    // A forged bearer must not open a stream. The relay verifies a
    // signature and nothing else, so this is its entire trust boundary.
    const forged = await fetch(
      `${relay}/events?token=${minted.body.token.split('.')[0]}.AAAA`
    );
    check('the relay refuses a forged token', forged.status === 401, String(forged.status));
    await forged.body?.cancel();

    const none = await fetch(`${relay}/events`);
    check('and a missing one', none.status === 401, String(none.status));
    await none.body?.cancel();

    // Now the real thing: open a stream, send from the other side, and
    // read the frame off the wire.
    const controller = new AbortController();
    const stream = await fetch(
      `${relay}/events?token=${encodeURIComponent(minted.body.token)}`,
      { signal: controller.signal }
    );
    check('a valid token opens the stream', stream.status === 200, String(stream.status));
    check(
      'as an event stream',
      (stream.headers.get('content-type') ?? '').includes('text/event-stream'),
      String(stream.headers.get('content-type'))
    );

    const frames = [];
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (raw.startsWith('data: ')) frames.push(raw.slice(6));
        }
      }
    })();

    // Give the relay a moment to register the subscription before the
    // publish — Valkey pub/sub keeps nothing, so a frame published before
    // the SUBSCRIBE lands is a frame nobody receives.
    await sleep(400);
    await req('plainuser', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: { body: 'livré en direct' },
    });

    for (let i = 0; i < 40 && frames.length === 0; i++) await sleep(100);
    controller.abort();
    await pump.catch(() => undefined);

    check('the frame arrives on the stream', frames.length > 0, `frames=${frames.length}`);
    if (frames.length) {
      let parsed;
      try {
        parsed = JSON.parse(frames[0]);
      } catch {
        parsed = null;
      }
      // Always an array, even for one message: the client has one shape to
      // parse rather than two.
      check('it is an array of messages', Array.isArray(parsed), d(frames[0], 120));
      check(
        'carrying the conversation and the body',
        parsed?.[0]?.conversationId === convId &&
          parsed?.[0]?.message?.body === 'livré en direct',
        d(parsed?.[0], 160)
      );
    }
  }

  console.log('\n10. the catch-up, and its bound');

  // Valkey pub/sub keeps nothing, so a reconnection needs somewhere to ask
  // what it missed. This is also what makes it safe for the relay to close
  // a slow reader: the cut is repairable.
  await resetRateLimits();
  const mark = new Date();
  await sleep(1100);
  await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'arrivé pendant la coupure' },
  });

  const gap = await req(
    'plainuser',
    `/api/messaging/catch-up?since=${encodeURIComponent(mark.toISOString())}`
  );
  check(
    'the catch-up returns what arrived during the gap',
    gap.status === 200 &&
      gap.body?.messages?.some((m) => m.body === 'arrivé pendant la coupure'),
    `${gap.status} ${d(gap.body, 160)}`
  );
  check('and says it was not truncated', gap.body?.truncated === false, d(gap.body?.truncated));

  // Too far back is answered with "reload", not with a bigger page: a node
  // dying means every client it held asks at the same moment, and an
  // unbounded query is the one just multiplied by a node's worth of
  // readers.
  const ancient = await req(
    'plainuser',
    `/api/messaging/catch-up?since=${encodeURIComponent(new Date(Date.now() - 26 * 3600 * 1000).toISOString())}`
  );
  check(
    'a gap too wide to patch is refused rather than served',
    ancient.body?.truncated === true && ancient.body?.messages?.length === 0,
    d(ancient.body, 120)
  );

  check(
    'and a stranger sees nothing of it',
    ((await req('founder', `/api/messaging/catch-up?since=${encodeURIComponent(mark.toISOString())}`))
      .body?.messages ?? []).every((m) => m.conversationId !== convId),
    'founder is not in that conversation'
  );

  console.log('\n11. moderation');

  await resetRateLimits();

  // Reporting a private message is only open to somebody in it. Without
  // that, a report is a way to ask the staff to read a conversation you
  // are not part of — and to confirm which message ids exist.
  const thread2 = await req('plainuser', `${DM}/${convId}/messages`);
  const someMessage = thread2.body?.messages?.[0]?.id;
  check('there is a message to report', !!someMessage, d(someMessage));

  const outsider = await req('founder', '/api/reports', {
    method: 'POST',
    body: { targetType: 'message', targetId: someMessage, reason: 'spam répété et insistant' },
  });
  check(
    'somebody outside the conversation cannot report it',
    outsider.status === 404,
    `${outsider.status} ${d(outsider.body, 120)}`
  );

  const reported = await req('plainuser', '/api/reports', {
    method: 'POST',
    body: { targetType: 'message', targetId: someMessage, reason: 'spam répété et insistant' },
  });
  check('a participant can', reported.status === 200 || reported.status === 201,
    `${reported.status} ${d(reported.body, 140)}`);

  // Staff read exactly one message, and only because it was reported.
  const staffView = await req('founder', `/api/mod/messages/${someMessage}`);
  check(
    'staff can read the reported message',
    staffView.status === 200 && typeof staffView.body?.body === 'string',
    `${staffView.status} ${d(staffView.body, 140)}`
  );

  const unreported = await req('plainuser', `${DM}/${convId}/messages`);
  const other = unreported.body?.messages?.find((m) => m.id !== someMessage)?.id;
  if (other) {
    check(
      'but not one that was never reported — this is not an inbox they browse',
      (await req('founder', `/api/mod/messages/${other}`)).status === 404
    );
  }
  check(
    'and a member cannot use that endpoint at all',
    (await req('donator', `/api/mod/messages/${someMessage}`)).status === 403
  );

  await resetRateLimits();

  console.log('\n12. blocking');

  const blocked = await req('plainuser', '/api/messaging/blocks', {
    method: 'POST',
    body: { username: 'donator' },
  });
  check('a member can block another', blocked.status === 200, `${blocked.status} ${d(blocked.body, 120)}`);

  check(
    'the blocked side can no longer write into the shared conversation',
    (await req('donator', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: { body: 'toujours là ?' },
    })).status === 403
  );
  check(
    'nor open a new one',
    (await req('donator', DM, { method: 'POST', body: { username: 'plainuser' } }))
      .status === 403
  );
  // The two sides are refused differently, and on purpose.
  //
  // For the blocked party the conversation stays visible and the send is
  // refused with a neutral "closed" — it must not read as "you have been
  // blocked", or the refusal becomes the notification we are avoiding.
  //
  // For the one who blocked, the conversation is gone: out of their list,
  // 404 on the thread. They chose that, so hiding it from them is the
  // point rather than a leak.
  check(
    'and for the one who blocked it is gone entirely, not merely closed',
    (await req('plainuser', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: { body: 'ni moi' },
    })).status === 404
  );

  const list = await req('plainuser', '/api/messaging/blocks');
  check(
    'the block is listed',
    list.body?.blocks?.some((b) => b.username === 'donator'),
    d(list.body, 140)
  );

  await resetRateLimits();
  check(
    'unblocking works',
    (await req('plainuser', '/api/messaging/blocks/donator', { method: 'DELETE' }))
      .status === 200
  );
  const afterUnblock = (await req('plainuser', DM)).body;
  check(
    'the conversation comes back as a request, not straight to the inbox',
    afterUnblock?.requests?.some((c) => c.id === convId) &&
      !afterUnblock?.inbox?.some((c) => c.id === convId),
    d(afterUnblock, 180)
  );
  check(
    'and writing is possible again',
    (await req('donator', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: { body: 'de retour' },
    })).status === 200
  );

  console.log('\n13. withdrawing a message');

  await resetRateLimits();
  const mine = await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'à retirer' },
  });
  check(
    "a member cannot delete somebody else's",
    (await req('plainuser', `${DM}/${convId}/messages/${mine.body.id}`, {
      method: 'DELETE',
    })).status === 403
  );
  check(
    'but can delete their own',
    (await req('donator', `${DM}/${convId}/messages/${mine.body.id}`, {
      method: 'DELETE',
    })).status === 200
  );

  const afterDelete = await req('plainuser', `${DM}/${convId}/messages`);
  const gone = afterDelete.body?.messages?.find((m) => m.id === mine.body.id);
  check(
    'the row stays, blanked, so the thread and any report still hold',
    gone?.deleted === true && gone?.body === null,
    d(gone, 140)
  );

  check(
    'staff can withdraw anything',
    (await req('founder', `${DM}/${convId}/messages/${someMessage}`, {
      method: 'DELETE',
    })).status === 200
  );

  console.log('\n14. keys, and what encryption costs the staff');

  await resetRateLimits();

  // The key is opaque to the server: it stores what the browser published
  // and hands it to whoever wants to seal a conversation to that member.
  // A REAL uncompressed P-256 SPKI, not filler.
  //
  // This used to be 122 'A's, and the server took it: the check was on
  // length alone. The cost showed up in the browser, where a correspondent
  // opening the conversation hit an unhandled DOMException from
  // `importKey` and got a page that did nothing at all. One member with a
  // bad key broke the feature for everyone who talked to them.
  const realKey =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVbdpcnLyqAqB6R5SdbsUHXZPltQpew7eeaCh_-TlKaagfLgBzZ3TxAv8JQGlya-mKuxEDCiw8HdPIyTa5fouSw';
  check(
    'a member publishes a public key',
    (await req('donator', '/api/messaging/keys', {
      method: 'PUT',
      body: { publicKey: realKey, deviceLabel: 'poste e2e' },
    })).status === 200
  );

  await resetRateLimits();
  check(
    'and filler of the right length is refused — the bytes are checked, not the size',
    (await req('donator', '/api/messaging/keys', {
      method: 'PUT',
      body: { publicKey: 'A'.repeat(122) },
    })).status === 400
  );
  await resetRateLimits();
  check(
    'as is a key for some other curve',
    (await req('donator', '/api/messaging/keys', {
      method: 'PUT',
      // Valid base64url, right ballpark of length, wrong prefix.
      body: { publicKey: 'B'.repeat(122) },
    })).status === 400
  );

  const ownKey = await req('donator', '/api/messaging/keys');
  check(
    'and sees it in their own panel',
    ownKey.body?.published === true && ownKey.body?.alg === 'ECDH-P256',
    d(ownKey.body)
  );

  const lookup = await req('plainuser', '/api/messaging/keys/donator');
  check(
    'somebody who wants to write to them gets it',
    lookup.body?.available === true && lookup.body?.publicKey === realKey,
    d(lookup.body, 80)
  );

  // The absence is an answer, not a 404: an encrypted conversation can
  // only be started with somebody who has published, and the composer
  // has to be able to say so and offer a plain one instead.
  const noKey = await req('donator', '/api/messaging/keys/founder');
  check(
    'and its absence is a first-class answer',
    noKey.status === 200 && noKey.body?.available === false,
    `${noKey.status} ${d(noKey.body)}`
  );

  // What a report on an encrypted message can show. This is the cost of
  // the feature, and it has to be visible rather than discovered by a
  // moderator staring at an empty field.
  const encMsg = (await req('donator', `${DM}/${encId}/messages`)).body?.messages?.[0];
  check('there is an encrypted message to report', !!encMsg?.id, d(encMsg?.id));

  await resetRateLimits();
  const encReport = await req('donator', '/api/reports', {
    method: 'POST',
    body: {
      targetType: 'message',
      targetId: encMsg.id,
      reason: 'contenu à examiner par le staff',
    },
  });
  check('it can be reported', encReport.status === 200 || encReport.status === 201,
    `${encReport.status} ${d(encReport.body, 120)}`);

  const staffSees = await req('founder', `/api/mod/messages/${encMsg.id}`);
  check(
    'staff reach the report',
    staffSees.status === 200,
    `${staffSees.status} ${d(staffSees.body, 120)}`
  );
  check(
    'and are told plainly that there is nothing to read',
    staffSees.body?.encrypted === true && staffSees.body?.body === null,
    d(staffSees.body, 140)
  );

  console.log('\n15. archiving, muting, searching');

  await resetRateLimits();

  // Archiving is per-member. Filing your own inbox must not remove the
  // thread from somebody else's — that would be a deletion, not filing.
  check(
    'a conversation archives',
    (await req('plainuser', `${DM}/${convId}/archive`, { method: 'POST' })).status === 200
  );
  const afterArchive = (await req('plainuser', DM)).body;
  check(
    'and leaves the default list',
    !afterArchive?.inbox?.some((c) => c.id === convId) &&
      !afterArchive?.requests?.some((c) => c.id === convId),
    d(afterArchive, 160)
  );
  const archivedList = await req('plainuser', `${DM}?archived=true`);
  check(
    'showing up in the archived view instead',
    // The archived view keeps the same inbox/requests split as the
    // default one: archiving changes where a conversation is listed, not
    // whether it was ever accepted.
    [
      ...(archivedList.body?.inbox ?? []),
      ...(archivedList.body?.requests ?? []),
    ].some((c) => c.id === convId),
    d(archivedList.body, 160)
  );
  const otherSide = (await req('donator', DM)).body;
  check(
    "while the other member still has it — filing is not deleting",
    otherSide?.inbox?.some((c) => c.id === convId),
    d(otherSide, 160)
  );
  check(
    'and it comes back',
    (await req('plainuser', `${DM}/${convId}/archive`, { method: 'DELETE' })).status === 200
  );

  await resetRateLimits();
  const muted = await req('plainuser', `${DM}/${convId}/mute`, {
    method: 'POST',
    body: { hours: 4 },
  });
  check('a conversation mutes', muted.status === 200 && !!muted.body?.mutedUntil, d(muted.body));
  check(
    'and lifts',
    (await req('plainuser', `${DM}/${convId}/mute`, { method: 'POST', body: { hours: 0 } }))
      .body?.mutedUntil === null
  );

  // Search covers what the server can read, and says what it skipped.
  await resetRateLimits();
  await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'une aiguille dans la botte de foin' },
  });
  const found = await req('plainuser', '/api/messaging/search?q=aiguille');
  check(
    'search finds a plaintext message',
    found.body?.results?.some((r) => r.body?.includes('aiguille')),
    d(found.body, 160)
  );
  // The encrypted conversation from phase 8 is donator's, not
  // plainuser's — so it is donator who has something the search cannot
  // look at, and who must be told so rather than shown a quietly shorter
  // list.
  const donatorSearch = await req('donator', '/api/messaging/search?q=aiguille');
  check(
    'and the member who has an encrypted thread is told it was skipped',
    typeof donatorSearch.body?.skippedEncrypted === 'number' &&
      donatorSearch.body.skippedEncrypted > 0,
    d(donatorSearch.body?.skippedEncrypted)
  );
  check(
    'while somebody with none is told zero, not nothing',
    found.body?.skippedEncrypted === 0,
    d(found.body?.skippedEncrypted)
  );
  const stranger = await req('founder', '/api/messaging/search?q=aiguille');
  check(
    'somebody else finds nothing of it',
    !stranger.body?.results?.some((r) => r.conversationId === convId),
    d(stranger.body?.results?.length)
  );

  // Read receipts are reciprocal: turning them off stops sending AND
  // stops seeing.
  await resetRateLimits();
  check(
    'read receipts can be turned off',
    (await req('plainuser', '/api/me', {
      method: 'PATCH',
      body: { messagingReadReceipts: false },
    })).status === 200
  );
  check(
    'and back on',
    (await req('plainuser', '/api/me', {
      method: 'PATCH',
      body: { messagingReadReceipts: true },
    })).status === 200
  );
  const readAck = await req('plainuser', `${DM}/${convId}/read`, { method: 'POST' });
  check('marking read answers with the timestamp', !!readAck.body?.readAt, d(readAck.body));

  console.log('\n16. back to off');

  check('the scope closes again', (await setScopes({ dm: 'off' })) === 200);
  await resetRateLimits();
  check(
    'the catch-up goes with it',
    (await req('donator', `/api/messaging/catch-up?since=${encodeURIComponent(new Date().toISOString())}`))
      .status === 404
  );
  check(
    'the token endpoint goes with it',
    (await req('donator', '/api/messaging/token')).status === 404
  );
  check(
    'and the conversation that existed is invisible too',
    (await req('donator', `${DM}/${convId}/messages`)).status === 404,
    String((await req('donator', `${DM}/${convId}/messages`)).status)
  );

  report();
}

main();
