/**
 * The re-authentication gate, checked last on purpose.
 *
 * `requireFreshAuth` gives a session ten minutes after login, so a scenario
 * cannot reach the refusal path by waiting — it has to clear the stamp. Doing
 * that makes every session in the run stale, which is why this is its own
 * scenario and why `run.sh` orders it last rather than globbing the directory.
 */
import { caller, check, expireFreshAuth, report, resetRateLimits, sessions } from './lib.mjs';

const S = sessions(['founder']);
const req = caller(S);

await resetRateLimits();

// Something to write to.
// `enabled: false` on purpose. `enabled` defaults to true in the database, so
// omitting it creates an ENABLED theme and counts against the ten-theme cap —
// which is how this scenario first failed, on a 400 from a cap it had no
// business reaching. A draft is all it needs.
const made = await req('founder', '/api/admin/themes', {
  method: 'POST',
  body: {
    name: 'E2E Fresh',
    base: 'dark',
    duplicateOf: 'dark',
    enabled: false,
    visibility: 'site',
  },
});
const id = made.body?.id ?? made.body?.theme?.id;
check('a theme to write to', !!id,
  `status ${made.status} ${JSON.stringify(made.body).slice(0, 200)}`);

console.log('\n1. while the session is fresh');
{
  const ok = await req('founder', `/api/admin/themes/${id}/css`, {
    method: 'PUT',
    body: { css: '.a { color: red; }' },
  });
  check('raw CSS is accepted', ok.status === 200, `status ${ok.status}`);
}

console.log('\n2. once the stamp is gone');
{
  await expireFreshAuth();

  const css = await req('founder', `/api/admin/themes/${id}/css`, {
    method: 'PUT',
    body: { css: '.b { color: blue; }' },
  });
  check('raw CSS is refused', css.status === 401, `status ${css.status}`);
  check('with reauthRequired, so the client can prompt',
    css.body?.data?.reauthRequired === true,
    JSON.stringify(css.body).slice(0, 160));

  const read = await req('founder', `/api/admin/themes/${id}/css`);
  check('reading is deliberately not gated', read.status === 200, `status ${read.status}`);
  check('and still shows the earlier write', read.body?.css?.includes('.a'),
    JSON.stringify(read.body).slice(0, 120));

  // The same gate on the other owner-only writes.
  const del = await req('founder', '/api/admin/fonts/00000000-0000-4000-8000-000000000000', {
    method: 'DELETE',
  });
  check('deleting a font is refused too', del.status === 401, `status ${del.status}`);

  // And an ordinary admin write is NOT gated — the point of a separate gate is
  // that it applies to the dangerous handful, not to everything.
  const ordinary = await req('founder', `/api/admin/themes/${id}`, {
    method: 'PUT',
    body: { name: 'E2E Fresh Renamed', base: 'dark', tokens: {}, visibility: 'site' },
  });
  check('an ordinary theme edit still works', ordinary.status === 200,
    `status ${ordinary.status}`);
}

await req('founder', `/api/admin/themes/${id}`, { method: 'DELETE' });
report();
