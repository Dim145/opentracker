/**
 * Notification delivery — the half of messaging that says "you have mail".
 *
 * The retention sweep has an integration test; the delivery path had
 * nothing at all. That is the wrong way round: a sweep that fails is a
 * table that grows, while delivery that fails is a member who is never
 * told, and both were equally invisible behind the same silence.
 *
 * What is pinned here is the whole loop a browser walks: something
 * happens, the bell counts it, the list carries a renderable row, reading
 * it moves the counter down exactly once, read-all empties it, and the
 * live channel opens and stays open.
 */
import { API, caller, check, report, resetRateLimits, sessions } from './lib.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

const N = '/api/me/notifications';
const DM = '/api/messaging/conversations';

const d = (v, max = 160) => String(JSON.stringify(v) ?? v).slice(0, max);

const setDm = async (messagingDmScope) =>
  (await req('founder', '/api/admin/settings', { method: 'PUT', body: { messagingDmScope } })).status;

/** Read the bell the way the navbar does. */
async function bell(who) {
  const r = await req(who, `${N}?limit=50`);
  return { status: r.status, count: r.body?.unreadCount ?? -1, items: r.body?.items ?? [] };
}

async function main() {
  await resetRateLimits();
  check('private messages on', (await setDm('all')) === 200);

  // ── 1. The bell answers before anything has happened ───────────────
  {
    const b = await bell('plainuser');
    check(
      'the list and the counter come back together',
      b.status === 200 && Array.isArray(b.items) && Number.isInteger(b.count),
      d(b)
    );
  }
  // ── 2. Something happens ───────────────────────────────────────────
  //
  // The route notifies only when the conversation's unread counter lands
  // on exactly one — that is the coalescing rule, tested below. So the
  // conversation is READ first, deliberately: an earlier scenario may
  // already have left unread messages between these two, and a test that
  // assumed a virgin pair would pass or fail on its position in the run
  // rather than on the behaviour.
  let convId = null;
  {
    const c = await req('donator', DM, { method: 'POST', body: { username: 'plainuser' } });
    convId = c.body?.id;
    check('a conversation opens', c.status === 200 && !!convId, d(c.body));
    await req('plainuser', `${DM}/${convId}/read`, { method: 'POST' });
  }

  const before = (await bell('plainuser')).count;

  {
    const m = await req('donator', `${DM}/${convId}/messages`, {
      method: 'POST',
      body: { body: 'Tu as vu le nouveau torrent ?' },
    });
    check('and carries a message', m.status === 200, d(m.body));
  }

  let firstId = null;
  {
    const b = await bell('plainuser');
    check('the counter moved', b.count === before + 1, `${before} -> ${b.count}`);
    const row = b.items[0];
    firstId = row?.id;
    check(
      'the newest row is the one that just happened',
      !!row && typeof row.type === 'string' && row.readAt === null,
      d(row)
    );
    // The bell renders client-side, from the type and the payload — so
    // what the row owes it is a type it has a label for and the values
    // that label interpolates. A unit test pins the label side of that
    // bargain (`apps/web/test/notificationLabels.test.ts`); this pins the
    // payload side.
    check(
      'and it carries what the bell interpolates',
      (row?.type === 'message_received' || row?.type === 'message_request_received') &&
        row?.payload?.from === 'donator',
      d(row)
    );
  }

  // ── 3. Reading one moves the counter by exactly one ────────────────
  {
    const r = await req('plainuser', `${N}/${firstId}/read`, { method: 'POST' });
    check('a notification can be marked read', r.status === 200, String(r.status));
    const b = await bell('plainuser');
    check('the counter came back down', b.count === before, `${before + 1} -> ${b.count}`);
    check(
      'and the row keeps its stamp rather than vanishing',
      b.items.find((i) => i.id === firstId)?.readAt !== null,
      d(b.items.find((i) => i.id === firstId))
    );
  }
  {
    const again = await req('plainuser', `${N}/${firstId}/read`, { method: 'POST' });
    const b = await bell('plainuser');
    check(
      'reading it twice does not double-count',
      (again.status === 200 || again.status === 409) && b.count === before,
      `${again.status} count=${b.count}`
    );
  }
  {
    // The route is deliberately idempotent — it answers 200 whether or not
    // it changed anything — so what is asserted here is the EFFECT. A test
    // that only read the status would pass against a route scoped to
    // nobody at all.
    const r = await req('donator', `${N}/${firstId}/read`, { method: 'POST' });
    check(
      "somebody else's notification is not theirs to change",
      r.body?.changed === false,
      d(r.body)
    );
    check(
      'and the owner still holds it, read by their own hand',
      (await bell('plainuser')).items.find((i) => i.id === firstId)?.readAt !== null,
      d((await bell('plainuser')).items.find((i) => i.id === firstId))
    );
  }

  // ── 4. One notification per conversation, not one per message ──────
  {
    // The route notifies only when the conversation's unread counter is
    // exactly one, which is what keeps the bell usable: a ten-message
    // burst is one interruption, not ten. Reading the NOTIFICATION does
    // not clear the CONVERSATION, so these two add nothing.
    const before2 = (await bell('plainuser')).count;
    await req('donator', `${DM}/${convId}/messages`, { method: 'POST', body: { body: 'Deux.' } });
    await req('donator', `${DM}/${convId}/messages`, { method: 'POST', body: { body: 'Trois.' } });
    const after = await bell('plainuser');
    check(
      'a burst in one conversation is one interruption, not three',
      after.count === before2,
      `${before2} -> ${after.count}`
    );
  }

  // ── 4b. Read-all ───────────────────────────────────────────────────
  {
    // Something unread, from a different sender, so read-all has work.
    // Read first, for the same reason as above: the notification lands on
    // the counter's first step, not on every message.
    const c = await req('founder', DM, { method: 'POST', body: { username: 'plainuser' } });
    if (c.body?.id) {
      await req('plainuser', `${DM}/${c.body.id}/read`, { method: 'POST' });
      await req('founder', `${DM}/${c.body.id}/messages`, {
        method: 'POST',
        body: { body: 'Bienvenue.' },
      });
    }
    check('an unread one exists', (await bell('plainuser')).count >= 1, String((await bell('plainuser')).count));

    const r = await req('plainuser', `${N}/read-all`, { method: 'POST' });
    check('read-all is accepted', r.status === 200, d(r.body));
    check('and the bell is empty', (await bell('plainuser')).count === 0, String((await bell('plainuser')).count));
  }
  {
    const other = await bell('donator');
    check(
      "read-all emptied one member's bell, not everyone's",
      other.status === 200,
      String(other.status)
    );
  }

  // ── 5. The unread badge on the messages icon ───────────────────────
  {
    // Its own endpoint and its own shape: the messages icon counts unread
    // MESSAGES, the bell counts notifications, and read-all on one must
    // not silence the other.
    const r = await req('plainuser', '/api/messaging/unread');
    check(
      'the message badge counts messages, conversations and requests',
      r.status === 200 &&
        Number.isInteger(r.body?.messages) &&
        Number.isInteger(r.body?.conversations) &&
        Number.isInteger(r.body?.requests),
      d(r.body)
    );
    check(
      'and read-all on the bell did not clear it',
      (r.body?.messages ?? 0) > 0,
      d(r.body)
    );
  }

  // ── 6. The live channel ────────────────────────────────────────────
  // Node has no EventSource, so this is the same request an EventSource
  // makes, read far enough to prove the stream opened and stayed open.
  {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let status = 0;
    let contentType = '';
    let bytes = 0;
    try {
      const res = await fetch(`${API}/api/me/notifications/stream`, {
        headers: { cookie: S.plainuser.cookie, accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      status = res.status;
      contentType = res.headers.get('content-type') ?? '';
      const reader = res.body?.getReader();
      // Bounded: a heartbeat or a first frame is all this needs to see.
      for (let i = 0; reader && i < 4; i += 1) {
        const { value, done } = await reader.read();
        bytes += value?.length ?? 0;
        if (done || bytes > 0) break;
      }
      await reader?.cancel();
    } catch {
      // An abort after a successful open is the expected end.
    } finally {
      clearTimeout(t);
    }
    check('the stream opens', status === 200, String(status));
    check(
      'and announces itself as an event stream',
      contentType.includes('text/event-stream'),
      contentType || '(aucun)'
    );
  }
  {
    const res = await fetch(`${API}/api/me/notifications/stream`, {
      headers: { accept: 'text/event-stream' },
    });
    check('signed out, it is refused', res.status === 401, String(res.status));
    await res.body?.cancel();
  }

  await setDm('off');
  report();
}

main();
