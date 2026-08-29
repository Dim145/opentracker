/**
 * Reactions, replies and edits — on both surfaces.
 *
 * What this pins is mostly the refusals. The happy paths are easy and
 * would pass against a much weaker implementation; the rules that matter
 * are the ones that stop a reaction becoming a write amplifier, an edit
 * becoming a way to rewrite history after being answered, and a reply
 * becoming a way to probe which message ids exist.
 */
import {
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
const ROOM = '/api/messaging/room';
const d = (v, max = 160) => String(JSON.stringify(v) ?? v).slice(0, max);

async function main() {
  await resetRateLimits();

  console.log('\n1. a conversation to work in');

  await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { messagingDmScope: 'all', messagingRoomScope: 'all' },
  });
  await resetRateLimits();

  const conv = await req('donator', DM, {
    method: 'POST',
    body: { username: 'plainuser' },
  });
  const convId = conv.body?.id;
  check('a conversation opens', conv.status === 200 && !!convId, d(conv.body));
  await req('plainuser', `${DM}/${convId}/accept`, { method: 'POST' });

  const first = await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'Is the Criterion batch still seeded?' },
  });
  const firstId = first.body?.id;
  check('a message goes through', first.status === 200 && !!firstId, d(first.body));

  await resetRateLimits();
  console.log('\n2. reactions are a toggle, not an append');

  const add = await req('plainuser', `${DM}/${convId}/messages/${firstId}/reactions`, {
    method: 'POST',
    body: { key: 'up' },
  });
  check('reacting says it added', add.body?.action === 'added', d(add.body));

  let thread = await req('plainuser', `${DM}/${convId}/messages`);
  let msg = thread.body?.messages?.find((m) => m.id === firstId);
  check('the count is 1', msg?.reactions?.up === 1, d(msg?.reactions));
  check('and it knows it is mine', msg?.myReactions?.includes('up'), d(msg?.myReactions));

  await resetRateLimits();
  const again = await req('plainuser', `${DM}/${convId}/messages/${firstId}/reactions`, {
    method: 'POST',
    body: { key: 'up' },
  });
  check('the same key again removes it', again.body?.action === 'removed', d(again.body));

  thread = await req('plainuser', `${DM}/${convId}/messages`);
  msg = thread.body?.messages?.find((m) => m.id === firstId);
  check(
    'and the key disappears rather than sitting at zero',
    msg?.reactions?.up === undefined,
    d(msg?.reactions)
  );

  await resetRateLimits();
  check(
    'an unknown key is refused — the set is fixed on purpose',
    (await req('plainuser', `${DM}/${convId}/messages/${firstId}/reactions`, {
      method: 'POST',
      body: { key: '🍕' },
    })).status === 400
  );

  await resetRateLimits();
  check(
    'somebody outside the conversation cannot react to it',
    (await req('founder', `${DM}/${convId}/messages/${firstId}/reactions`, {
      method: 'POST',
      body: { key: 'up' },
    })).status === 404
  );

  await resetRateLimits();
  console.log('\n3. replies stay inside their conversation');

  // An id that exists nowhere. No fixture dependency, so this one always
  // tests the rule rather than the state the earlier scenarios left.
  check(
    'a reply target that does not exist is refused',
    (await req('donator', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: {
        body: 'quoting nothing',
        replyToId: '00000000-0000-4000-8000-000000000000',
      },
    })).status === 400
  );

  await resetRateLimits();

  // And the one that matters: an id that DOES exist, in a conversation the
  // sender is also in. Without the conversation clause on the lookup this
  // succeeds, and quoting becomes a way to confirm which ids are real.
  //
  // The pair is picked here rather than reused from `messaging`, which
  // leaves an ENCRYPTED conversation between founder and donator — posting
  // plaintext into it fails, the stray id comes back undefined, and the
  // assertion below passes for the wrong reason.
  const other = await req('founder', DM, {
    method: 'POST',
    body: { username: 'plainuser' },
  });
  const otherId = other.body?.id;
  const encrypted = other.body?.encrypted === true;
  const strayMsg = await req('founder', `${DM}/${otherId}/messages`, {
    method: 'POST',
    body: encrypted ? { cipher: 'q80', iv: 'q80' } : { body: 'Another thread.' },
  });
  check(
    'a witness message exists in another conversation',
    strayMsg.status === 200 && !!strayMsg.body?.id,
    `${strayMsg.status} ${d(strayMsg.body, 120)} encrypted=${encrypted}`
  );

  await resetRateLimits();
  const cross = await req('donator', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'quoting across threads', replyToId: strayMsg.body?.id },
  });
  check(
    'a reply target from another conversation is refused',
    cross.status === 400,
    `${cross.status} ${d(cross.body, 120)}`
  );

  await resetRateLimits();
  const reply = await req('plainuser', `${DM}/${convId}/messages`, {
    method: 'POST',
    body: { body: 'Still seeded, two of us on it.', replyToId: firstId },
  });
  check('a reply inside the thread goes through', reply.status === 200, d(reply.body));

  thread = await req('plainuser', `${DM}/${convId}/messages`);
  const answered = thread.body?.messages?.find((m) => m.id === reply.body?.id);
  check(
    'and it carries a preview of what it answers, not the message itself',
    answered?.replyTo?.id === firstId &&
      typeof answered?.replyTo?.preview === 'string' &&
      answered.replyTo.preview.length <= 140,
    d(answered?.replyTo)
  );

  await resetRateLimits();
  console.log('\n4. editing leaves a mark, and only the author can do it');

  check(
    'somebody else cannot edit my message',
    (await req('plainuser', `${DM}/${convId}/messages/${firstId}`, {
      method: 'PATCH',
      body: { body: 'words I never wrote' },
    })).status === 403
  );

  await resetRateLimits();
  const edit = await req('donator', `${DM}/${convId}/messages/${firstId}`, {
    method: 'PATCH',
    body: { body: 'Is the Criterion batch still seeded? (fixed a typo)' },
  });
  check('the author can', edit.status === 200, d(edit.body));

  thread = await req('plainuser', `${DM}/${convId}/messages`);
  msg = thread.body?.messages?.find((m) => m.id === firstId);
  check('the text changed', msg?.body?.includes('fixed a typo'), d(msg?.body));
  check(
    'and it says so — an edit that leaves no mark rewrites history',
    !!msg?.editedAt,
    d(msg?.editedAt)
  );

  await resetRateLimits();
  console.log('\n5. the room');

  const said = await req('plainuser', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'Freeleech pool refreshed — fourteen new entries.' },
  });
  const roomId = said.body?.id;
  check('a room message goes through', said.status === 200 && !!roomId, d(said.body));

  await resetRateLimits();
  const roomReact = await req('donator', `${ROOM}/messages/${roomId}/reactions`, {
    method: 'POST',
    body: { key: 'thanks' },
  });
  check('it can be reacted to', roomReact.body?.action === 'added', d(roomReact.body));

  let page = await req('donator', ROOM);
  let line = page.body?.messages?.find((m) => m.id === roomId);
  check('the room page carries the count', line?.reactions?.thanks === 1, d(line?.reactions));

  await resetRateLimits();
  const roomReply = await req('donator', `${ROOM}/messages`, {
    method: 'POST',
    body: { body: 'Already three deep.', replyToId: roomId },
  });
  check('and a reply', roomReply.status === 200, d(roomReply.body));

  page = await req('donator', ROOM);
  const answeredLine = page.body?.messages?.find((m) => m.id === roomReply.body?.id);
  check('which quotes what it answers', answeredLine?.replyTo?.id === roomId, d(answeredLine?.replyTo));

  await resetRateLimits();
  const roomEdit = await req('plainuser', `${ROOM}/messages/${roomId}`, {
    method: 'PATCH',
    body: { body: 'Freeleech pool refreshed — fifteen new entries.' },
  });
  check('the author can fix a room message', roomEdit.status === 200, d(roomEdit.body));

  page = await req('donator', ROOM);
  line = page.body?.messages?.find((m) => m.id === roomId);
  check('the room shows it as edited too', !!line?.editedAt, d(line?.editedAt));

  await resetRateLimits();
  check(
    'and somebody else still cannot rewrite it',
    (await req('donator', `${ROOM}/messages/${roomId}`, {
      method: 'PATCH',
      body: { body: 'not mine to change' },
    })).status === 403
  );

  await resetRateLimits();
  console.log('\n6. a muted member can neither speak nor stamp');

  await req('founder', '/api/mod/room/mutes', {
    method: 'POST',
    body: { username: 'donator', hours: 1, reason: 'e2e' },
  });
  await resetRateLimits();

  check(
    'muted: cannot post',
    (await req('donator', `${ROOM}/messages`, {
      method: 'POST',
      body: { body: 'still here' },
    })).status === 403
  );
  await resetRateLimits();
  check(
    'muted: cannot react either — otherwise a mute silences words only',
    (await req('donator', `${ROOM}/messages/${roomId}/reactions`, {
      method: 'POST',
      body: { key: 'up' },
    })).status === 403
  );

  await resetRateLimits();
  await req('founder', '/api/mod/room/mutes/donator', { method: 'DELETE' });
  check(
    'unmuted: reacting works again',
    (await req('donator', `${ROOM}/messages/${roomId}/reactions`, {
      method: 'POST',
      body: { key: 'up' },
    })).status === 200
  );

  await resetRateLimits();
  console.log('\n7. publishing a key needs no invitation');

  // The deadlock this closes: your key was only published as a side
  // effect of STARTING an encrypted conversation, and you could only
  // start one with somebody who already had a key. On a fresh instance
  // nobody could be first.
  //
  // Only the three accounts the seed guarantees are used here. An
  // earlier draft reached for `seedersam`, which exists on a
  // demo-populated stack and not in a clean run — the scenario then died
  // on an undefined cookie instead of reporting anything at all.
  const REAL_KEY =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVbdpcnLyqAqB6R5SdbsUHXZPltQpew7eeaCh_-TlKaagfLgBzZ3TxAv8JQGlya-mKuxEDCiw8HdPIyTa5fouSw';
  check(
    'a member in no encrypted conversation can still publish a key',
    (await req('plainuser', '/api/messaging/keys', {
      method: 'PUT',
      body: { publicKey: REAL_KEY, deviceLabel: 'e2e' },
    })).status === 200
  );
  check(
    'and it is then offered to whoever wants to write to them',
    (await req('founder', '/api/messaging/keys/plainuser')).body?.available === true
  );

  // Encryption is chosen once, at creation, and never changes — a
  // conversation that could be encrypted later never promised anything.
  // `donator` and `plainuser` already talk in the clear (section 1), so
  // asking for an encrypted one hands the existing thread back untouched.
  await resetRateLimits();
  const existing = await req('donator', DM, {
    method: 'POST',
    body: { username: 'plainuser', encrypted: true },
  });
  check(
    'an existing plaintext thread is handed back as it is, never upgraded',
    existing.status === 200 &&
      existing.body?.created === false &&
      existing.body?.encrypted === false,
    d(existing.body)
  );

  await resetRateLimits();
  console.log('\n8. the browser can tell whether it is the one that published');

  // Without this the client cannot distinguish "this device takes part"
  // from "this device holds a key nobody encrypts to" — which is what
  // made a rotation appear to do nothing: the state was decided by
  // whether the thread's history opened, and after a rotation it never
  // opens again.
  const own = await req('plainuser', '/api/messaging/keys');
  check(
    'the own-key endpoint returns the key itself',
    own.status === 200 && own.body?.published === true && !!own.body?.publicKey,
    d(own.body, 90)
  );
  check(
    'and it is the same value anybody else is given',
    (await req('founder', '/api/messaging/keys/plainuser')).body?.publicKey ===
      own.body?.publicKey
  );

  report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
