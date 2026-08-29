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
    body: { cipher: 'q80=', iv: 'q80=' },
  });
  check('while ciphertext goes through', encSent.status === 200, String(encSent.status));

  const encThread = await req('founder', `${DM}/${encId}/messages`);
  check(
    'the server hands back the ciphertext it cannot read',
    encThread.body?.messages?.[0]?.cipher === 'q80=' &&
      encThread.body?.messages?.[0]?.body === null,
    d(encThread.body?.messages?.[0])
  );

  console.log('\n9. back to off');

  check('the scope closes again', (await setScopes({ dm: 'off' })) === 200);
  await resetRateLimits();
  check(
    'and the conversation that existed is invisible too',
    (await req('donator', `${DM}/${convId}/messages`)).status === 404,
    String((await req('donator', `${DM}/${convId}/messages`)).status)
  );

  report();
}

main();
