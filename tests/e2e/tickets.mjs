/**
 * The ticket desk.
 *
 * What is pinned here is everything that would be expensive to discover
 * in production: the three-way mode, the caps, the two-layer state model,
 * claim-on-response, and the freeze — in both directions, which is the
 * half that is easy to implement on one side only.
 *
 * The single most important assertion in this file is the one that says a
 * BLOCKED member can still open a ticket. That is the reason the feature
 * is not built on `conversations`, and it is exactly the sort of property
 * that a later refactor "simplifies" away.
 */
import { API, caller, check, report, resetRateLimits, sessions } from './lib.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

const T = '/api/tickets';
const MOD = '/api/mod/tickets';

const d = (value, max = 160) => String(JSON.stringify(value) ?? value).slice(0, max);

const setMode = async (ticketsMode) =>
  (await req('founder', '/api/admin/settings', { method: 'PUT', body: { ticketsMode } })).status;

const setDm = async (messagingDmScope) =>
  (await req('founder', '/api/admin/settings', { method: 'PUT', body: { messagingDmScope } })).status;

async function main() {
  await resetRateLimits();

  // Private messages stay OFF for this whole scenario except where a
  // phase says otherwise. The desk is not a messaging feature and must
  // not quietly depend on one being enabled — an instance that runs no
  // DMs at all still needs a way for a member to reach the staff.
  await setDm('off');

  // ── 1. Off is absent, not forbidden ────────────────────────────────
  check('the desk starts off', (await setMode('off')) === 200);
  {
    const r = await req('donator', T);
    check('a member sees no desk at all', r.status === 404, String(r.status));
  }
  {
    const r = await req('founder', MOD);
    check('and neither does the staff queue', r.status === 404, String(r.status));
  }

  // ── 2. On ──────────────────────────────────────────────────────────
  check('the desk can be switched on', (await setMode('on')) === 200);
  {
    // The admin panel reads this back to fill its own control. A setting
    // that only accepts writes is a setting nobody can find.
    const r = await req('founder', '/api/admin/settings');
    check(
      'and the settings the admin page reads say so',
      r.body?.ticketsMode === 'on',
      d(r.body?.ticketsMode)
    );
  }
  {
    const r = await req('donator', T);
    check(
      'the mode travels with the list',
      r.status === 200 && r.body?.mode === 'on' && Array.isArray(r.body?.tickets),
      d(r.body)
    );
  }

  let id = null;
  let number = null;
  {
    const r = await req('donator', T, {
      method: 'POST',
      body: { subject: 'Mon ratio', category: 'account', body: 'Bonjour, question sur mon ratio.' },
    });
    id = r.body?.id;
    number = r.body?.number;
    check('a member opens one', r.status === 200 && !!id && Number.isInteger(number), d(r.body));
  }

  // ── 3. It is nobody else's ─────────────────────────────────────────
  {
    const r = await req('plainuser', `${T}/${id}`);
    check("another member gets 404, not 403", r.status === 404, String(r.status));
  }
  {
    const r = await req('donator', `${T}/${id}`);
    check(
      'the opener reads it with its first message',
      r.status === 200 && r.body?.messages?.length === 1 && r.body.ticket.status === 'open',
      d(r.body?.ticket)
    );
  }
  {
    const r = await req('founder', `${T}/${id}`);
    check('the staff reads any ticket', r.status === 200, String(r.status));
  }

  // ── 4. Two layers, and "taken" is derived ──────────────────────────
  {
    const r = await req('founder', MOD);
    const row = r.body?.tickets?.find((t) => t.id === id);
    check(
      'it lands in the queue, untaken',
      r.status === 200 && !!row && row.status === 'open' && row.assignedToId === null,
      d(row)
    );
    check(
      'and the untaken counter sees it',
      (r.body?.counts?.untaken ?? 0) >= 1,
      d(r.body?.counts)
    );
  }

  // ── 5. Claim on response ───────────────────────────────────────────
  {
    const r = await req('founder', `${T}/${id}/messages`, {
      method: 'POST',
      body: { body: 'Bonjour, je regarde ça.' },
    });
    check('the staff answers', r.status === 200, d(r.body));
  }
  {
    const r = await req('founder', `${T}/${id}`);
    check(
      'answering claims it — no button pressed',
      r.body?.ticket?.assignedToId === S.founder.id || !!r.body?.ticket?.assignedToName,
      d(r.body?.ticket)
    );
    check(
      'the state stayed open: taken is not a status',
      r.body?.ticket?.status === 'open',
      String(r.body?.ticket?.status)
    );
    check(
      'and who spoke last is recorded, not asked for',
      r.body?.ticket?.lastMessageBy === 'staff',
      String(r.body?.ticket?.lastMessageBy)
    );
  }

  // ── 6. Suspended: open ones live, new ones do not ──────────────────
  check('the desk can be suspended', (await setMode('suspended')) === 200);
  {
    const r = await req('donator', T);
    check('the page is still there', r.status === 200 && r.body?.mode === 'suspended', d(r.body?.mode));
  }
  {
    const r = await req('donator', `${T}/${id}/messages`, {
      method: 'POST',
      body: { body: 'Merci !' },
    });
    check('and an open ticket still takes replies', r.status === 200, d(r.body));
  }
  {
    const r = await req('donator', T, {
      method: 'POST',
      body: { subject: 'Autre', category: 'other', body: 'Une autre question.' },
    });
    check('but no new ticket is accepted', r.status === 409, String(r.status));
  }
  check('back on', (await setMode('on')) === 200);

  // ── 7. Blocking does not reach the staff desk ──────────────────────
  // The whole reason this is not a `conversations` row. Blocking lives
  // behind the DM scope, so it goes on just long enough to set one up.
  check('DMs on, briefly', (await setDm('all')) === 200);
  {
    const r = await req('donator', '/api/messaging/blocks', {
      method: 'POST',
      body: { username: 'founder' },
    });
    check('a member blocks a moderator', r.status === 200 || r.status === 201, d(r.body));
  }
  let blockedId = null;
  {
    const r = await req('donator', T, {
      method: 'POST',
      body: { subject: 'Appel', category: 'appeal', body: 'Je conteste.' },
    });
    blockedId = r.body?.id;
    check('and can still open a ticket', r.status === 200 && !!blockedId, d(r.body));
  }
  {
    const r = await req('founder', `${T}/${blockedId}/messages`, {
      method: 'POST',
      body: { body: 'Reçu.' },
    });
    check('the blocked moderator can still answer it', r.status === 200, d(r.body));
  }
  await req('donator', '/api/messaging/blocks/founder', { method: 'DELETE' });
  check('DMs off again', (await setDm('off')) === 200);

  // ── 8. The cap on open tickets ─────────────────────────────────────
  {
    // Two are already open. One more reaches the ceiling of three.
    const third = await req('donator', T, {
      method: 'POST',
      body: { subject: 'Trois', category: 'other', body: 'Troisième.' },
    });
    check('a third is fine', third.status === 200, String(third.status));
    const fourth = await req('donator', T, {
      method: 'POST',
      body: { subject: 'Quatre', category: 'other', body: 'Quatrième.' },
    });
    check(
      'a fourth open ticket is refused',
      fourth.status === 429,
      `${fourth.status} ${d(fourth.body)}`
    );
  }

  // ── 9. Closure is a reason, and the freeze cuts both ways ──────────
  {
    const r = await req('founder', `${MOD}/${id}/close`, {
      method: 'POST',
      body: { reason: 'resolved', note: 'Ratio recalculé.' },
    });
    check('the staff closes it', r.status === 200, d(r.body));
  }
  {
    const r = await req('donator', `${T}/${id}`);
    check(
      'closed is the state, resolved is the reason',
      r.body?.ticket?.status === 'closed' && r.body?.ticket?.closureReason === 'resolved',
      d(r.body?.ticket)
    );
  }
  {
    const r = await req('donator', `${T}/${id}/messages`, {
      method: 'POST',
      body: { body: 'Une dernière chose…' },
    });
    check('the member can no longer write to it', r.status === 409, String(r.status));
  }
  {
    const r = await req('founder', `${T}/${id}/messages`, {
      method: 'POST',
      body: { body: 'Et moi non plus.' },
    });
    check('and neither can the staff — the freeze is symmetric', r.status === 409, String(r.status));
  }
  {
    const r = await req('founder', `${MOD}/${id}/close`, {
      method: 'POST',
      body: { reason: 'rejected' },
    });
    check('closing an already closed ticket is refused', r.status === 409, String(r.status));
  }

  // ── 10. Reopening is the escape hatch, and staff-only ──────────────
  {
    const r = await req('donator', `${MOD}/${id}/reopen`, { method: 'POST' });
    check('a member cannot reopen their own', r.status === 403 || r.status === 404, String(r.status));
  }
  {
    const r = await req('founder', `${MOD}/${id}/reopen`, { method: 'POST' });
    check('the staff can', r.status === 200, d(r.body));
  }
  {
    const r = await req('donator', `${T}/${id}`);
    check(
      'and it comes back open, unassigned, with the closure erased',
      r.body?.ticket?.status === 'open' &&
        r.body?.ticket?.closureReason === null &&
        r.body?.ticket?.assignedToId === null,
      d(r.body?.ticket)
    );
  }
  {
    const r = await req('donator', `${T}/${id}/messages`, {
      method: 'POST',
      body: { body: 'Merci, en fait il reste un point.' },
    });
    check('the member can write again', r.status === 200, d(r.body));
  }

  // ── 10c. The member can end their own, and only their own ──────────
  let mine = null;
  {
    const r = await req('plainuser', T, {
      method: 'POST',
      body: { subject: 'Je me débrouille', category: 'other', body: "Finalement j'ai trouvé." },
    });
    mine = r.body?.id;
    check('a member opens one of their own', r.status === 200 && !!mine, d(r.body));
  }
  {
    const r = await req('plainuser', `${T}/${mine}`);
    check('and is told they may close it', r.body?.canClose === true, d(r.body?.canClose));
  }
  {
    const r = await req('donator', `${T}/${mine}/close`, { method: 'POST' });
    check("but nobody else can — 404, it is not theirs to see", r.status === 404, String(r.status));
  }
  {
    // Staff can read it, and are still refused this route: closing as the
    // member would file a staff decision as "they withdrew it".
    const seen = await req('founder', `${T}/${mine}`);
    check('the staff can read it', seen.status === 200, String(seen.status));
    check(
      'and are not offered the member control',
      seen.body?.canClose === false,
      d(seen.body?.canClose)
    );
    const r = await req('founder', `${T}/${mine}/close`, { method: 'POST' });
    check('nor allowed to use it', r.status === 403, String(r.status));
  }
  {
    const r = await req('plainuser', `${T}/${mine}/close`, { method: 'POST' });
    check('the opener closes it', r.status === 200, d(r.body));
  }
  {
    const r = await req('plainuser', `${T}/${mine}`);
    check(
      'withdrawn is its own reason, not a fake resolution',
      r.body?.ticket?.status === 'closed' && r.body?.ticket?.closureReason === 'withdrawn',
      d(r.body?.ticket)
    );
    check(
      'and the control is gone with it',
      r.body?.canClose === false,
      d(r.body?.canClose)
    );
  }
  {
    const r = await req('plainuser', `${T}/${mine}/messages`, {
      method: 'POST',
      body: { body: 'Ah non finalement.' },
    });
    check('closing it froze it for them too', r.status === 409, String(r.status));
  }
  {
    const r = await req('plainuser', `${T}/${mine}/close`, { method: 'POST' });
    check('and it cannot be closed twice', r.status === 409, String(r.status));
  }
  {
    const r = await req('founder', `${MOD}/${mine}/reopen`, { method: 'POST' });
    check('the staff can still bring it back', r.status === 200, d(r.body));
    const after = await req('plainuser', `${T}/${mine}`);
    check(
      'and the member has the control again',
      after.body?.ticket?.closureReason === null && after.body?.canClose === true,
      d(after.body?.ticket?.closureReason)
    );
  }
  // Tidied away so the caps in later phases start from a known place.
  await req('plainuser', `${T}/${mine}/close`, { method: 'POST' });

  // ── 10d. The folded header needs an honest count ───────────────────
  {
    const r = await req('plainuser', `${T}?closed=true`);
    check(
      'the open count travels with the history tab too',
      typeof r.body?.openCount === 'number' && r.body.openCount === 0,
      d(r.body?.openCount)
    );
  }
  {
    const r = await req('donator', T);
    check(
      'and counts what that member has open',
      r.body?.openCount === (r.body?.tickets ?? []).length,
      `${d(r.body?.openCount)} vs ${(r.body?.tickets ?? []).length}`
    );
  }

  // ── 11. The queue is a queue ───────────────────────────────────────
  {
    const r = await req('founder', `${MOD}?closed=false`);
    const times = (r.body?.tickets ?? []).map((t) => new Date(t.lastMessageAt).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    check(
      'open tickets come oldest-activity-first',
      JSON.stringify(times) === JSON.stringify(sorted),
      d(times)
    );
  }
  {
    const r = await req('plainuser', MOD);
    check('and a plain member cannot see it', r.status === 403 || r.status === 404, String(r.status));
  }

  // ── 12. Off again hides everything, including what exists ──────────
  check('the desk goes off', (await setMode('off')) === 200);
  {
    const r = await req('donator', `${T}/${id}`);
    check('a ticket that exists becomes 404', r.status === 404, String(r.status));
  }
  await setMode('on');

  // ── 13. Staff-ness is read live, not off the cookie ───────────────
  // `plainuser` gets promoted here, with a session that was sealed long
  // before. Every route that widens what a caller may do has to reconcile
  // against the live role, or a new moderator is staff in the queue —
  // which reconciles — and a stranger to every ticket in it.
  {
    const r = await req('founder', `/api/admin/users/${S.plainuser.id}/role`, {
      method: 'PUT',
      body: { isAdmin: false, isModerator: true },
    });
    check('a member is promoted mid-session', r.status === 200, d(r.body));
  }
  {
    const r = await req('plainuser', `${T}/${id}`);
    check(
      "the new moderator can read a ticket that is not theirs",
      r.status === 200,
      `${r.status} — the sealed cookie still says member`
    );
  }
  {
    const r = await req('plainuser', `${T}/${id}/messages`, {
      method: 'POST',
      body: { body: 'Je prends la suite.' },
    });
    check('and answer it', r.status === 200, d(r.body));
  }
  {
    const r = await req('donator', `${T}/${id}`);
    const last = r.body?.messages?.[r.body.messages.length - 1];
    check(
      'their line is recorded as staff, not as a member',
      last?.fromStaff === true && last?.authorName === 'plainuser',
      d(last)
    );
  }
  // Put back, so nothing after this scenario inherits a moderator.
  await req('founder', `/api/admin/users/${S.plainuser.id}/role`, {
    method: 'PUT',
    body: { isAdmin: false, isModerator: false },
  });

  report();
}

main();
