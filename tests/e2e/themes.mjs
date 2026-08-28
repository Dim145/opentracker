/**
 * End-to-end pass over the themes feature, against a real stack.
 *
 * Everything goes through HTTP with real sessions from `seed.mjs`. The
 * integration suite already covers the units; what this checks is the parts no
 * unit test can see — that the stylesheet a browser downloads actually contains
 * what the admin saved, that the ETag moves, that a member's entitlement is
 * enforced on the write path, and that deleting a theme does not strand anyone.
 */
import {
  API,
  WEB,
  caller,
  check,
  report,
  resetRateLimits,
  sessions,
  sleep,
} from './lib.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

async function css() {
  const res = await fetch(`${API}/api/theme.css`);
  return { text: await res.text(), etag: res.headers.get('etag') };
}

// ── 1. What the admin page loads ─────────────────────────────────────
console.log('\n1. GET /api/admin/themes');
{
  const r = await req('founder', '/api/admin/themes');
  check('owner/admin can read it', r.status === 200, `status ${r.status}`);
  check('carries the token schema', Array.isArray(r.body?.schema) && r.body.schema.length >= 27,
    `${r.body?.schema?.length} tokens`);
  check('carries both built-in bases', !!r.body?.builtIns?.dark && !!r.body?.builtIns?.light);
  check('never leaks customCss', !JSON.stringify(r.body?.rows ?? []).includes('customCss'));

  const plain = await req('plainuser', '/api/admin/themes');
  check('a plain member is refused', plain.status === 401 || plain.status === 403, `status ${plain.status}`);
}

// ── 2. A role, so the visibility rule has something to bite on ───────
console.log('\n2. a role for the perk theme');
let roleId = null;
{
  const list = await req('founder', '/api/admin/roles');
  const existing = (Array.isArray(list.body) ? list.body : list.body?.roles ?? [])
    .find((r) => r.name === 'E2E Donator');
  if (existing) {
    roleId = existing.id;
  } else {
    const made = await req('founder', '/api/admin/roles', {
      method: 'POST',
      body: { name: 'E2E Donator', color: '#d4a734', priority: 10 },
    });
    roleId = made.body?.id ?? made.body?.role?.id ?? null;
    check('role created', !!roleId, `status ${made.status} ${JSON.stringify(made.body).slice(0, 160)}`);
  }
  if (roleId) {
    const assign = await req('founder', `/api/admin/users/${S.donator.id}/roles`, {
      method: 'POST',
      body: { roleId },
    });
    check('role assigned to donator', assign.status === 200,
      `status ${assign.status} ${JSON.stringify(assign.body).slice(0, 160)}`);
  }
}

// ── 3. Create a theme, and see it in the stylesheet ──────────────────
console.log('\n3. create a theme');
let crimsonId = null;
{
  const before = await css();
  const r = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Crimson',
      description: 'A duplicate of dark with a red warm accent.',
      base: 'dark',
      duplicateOf: 'dark',
      tokens: { 'accent-warm': '220 38 38', 'accent-warm-fg': '255 255 255' },
      enabled: true,
      visibility: 'site',
    },
  });
  crimsonId = r.body?.id ?? r.body?.theme?.id ?? null;
  check('created', r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

  const after = await css();
  check('the ETag moved', before.etag !== after.etag, `${before.etag} -> ${after.etag}`);
  check("the block is in the stylesheet", after.text.includes(":root[data-theme='e2e-crimson']"),
    'no e2e-crimson block');
  check('the overridden token is the new value', /--accent-warm:\s*220 38 38/.test(after.text));
  check('an untouched token is inherited from the base',
    /--bg-base:\s*10 10 10/.test(after.text), 'bg-base not inherited from dark');
  check('braces balance', (after.text.match(/\{/g) || []).length === (after.text.match(/\}/g) || []).length);
}

// ── 4. A theme reserved to a role ────────────────────────────────────
console.log('\n4. a role-reserved theme');
let goldId = null;
{
  const r = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Gold',
      base: 'dark',
      duplicateOf: 'dark',
      tokens: { 'accent-warm': '255 215 0' },
      enabled: true,
      visibility: 'roles',
      requiredRoles: [roleId],
    },
  });
  goldId = r.body?.id ?? r.body?.theme?.id ?? null;
  check('created', r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

  const sheet = await css();
  check('it IS in the shared stylesheet (documented trade)',
    sheet.text.includes(":root[data-theme='e2e-gold']"));

  const forDonator = await req('donator', '/api/branding');
  const forPlain = await req('plainuser', '/api/branding');
  const slugs = (b) => (b.body?.themes ?? []).map((t) => t.slug);
  check('offered to the member holding the role', slugs(forDonator).includes('e2e-gold'),
    JSON.stringify(slugs(forDonator)));
  check('not offered to a member without it', !slugs(forPlain).includes('e2e-gold'),
    JSON.stringify(slugs(forPlain)));
  check('the open theme is offered to both',
    slugs(forDonator).includes('e2e-crimson') && slugs(forPlain).includes('e2e-crimson'));
}

// ── 5. The write path is where entitlement is enforced ───────────────
console.log('\n5. PATCH /api/me { theme }');
{
  const ok = await req('donator', '/api/me', { method: 'PATCH', body: { theme: 'e2e-gold' } });
  check('the entitled member may keep it', ok.status === 200, `status ${ok.status}`);

  const no = await req('plainuser', '/api/me', { method: 'PATCH', body: { theme: 'e2e-gold' } });
  check('a member without the role is refused', no.status >= 400, `status ${no.status}`);

  const ghost = await req('plainuser', '/api/me', { method: 'PATCH', body: { theme: 'no-such-theme' } });
  check('a theme that does not exist is refused', ghost.status >= 400, `status ${ghost.status}`);
  check('both refusals read the same (no enumeration)',
    JSON.stringify(no.body?.message) === JSON.stringify(ghost.body?.message),
    `${no.body?.message} vs ${ghost.body?.message}`);

  const built = await req('plainuser', '/api/me', { method: 'PATCH', body: { theme: 'light' } });
  check('a built-in is always allowed', built.status === 200, `status ${built.status}`);
  const sys = await req('plainuser', '/api/me', { method: 'PATCH', body: { theme: 'system' } });
  check('system is always allowed', sys.status === 200, `status ${sys.status}`);
}

// ── 5b. A partial update must not silently un-gate a theme ───────────
console.log('\n5b. visibility cannot be dropped by omission');
{
  await sleep(200);
  const made = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Gated',
      base: 'dark',
      duplicateOf: 'dark',
      enabled: false,
      visibility: 'roles',
      requiredRoles: [roleId],
    },
  });
  const id = made.body?.id ?? made.body?.theme?.id;
  check('a role-gated theme exists', !!id, `status ${made.status}`);

  // Found in review: the update route writes `visibility` unconditionally, so a
  // schema default of `site` turned "the caller did not mention it" into "make
  // this public". Omitting it must be refused, not interpreted.
  await sleep(200);
  const partial = await req('founder', `/api/admin/themes/${id}`, {
    method: 'PUT',
    body: { name: 'E2E Gated', base: 'dark', enabled: false },
  });
  check('omitting visibility is refused', partial.status === 400,
    `status ${partial.status}`);

  const after = await req('founder', '/api/admin/themes');
  const row = (after.body?.themes ?? []).find((t) => t.id === id);
  check('and the theme is still gated', row?.visibility === 'roles',
    `visibility is now ${row?.visibility}`);

  await req('founder', `/api/admin/themes/${id}`, { method: 'DELETE' });
}

// ── 5c. The site default applies to whoever never chose ──────────────
console.log('\n5c. the site default');
await resetRateLimits();
{
  // `founder`, because the phases above hand `plainuser` and `donator` a theme
  // and a member who HAS chosen is a different case. Nothing in this file sets
  // the founder's, so what is being read here is what registration wrote — and
  // registration writing `'dark'` is exactly what used to leave the site-default
  // setting with nobody to apply to.
  const me = await req('founder', '/api/me');
  check('registration leaves the theme unchosen',
    me.body?.theme === null,
    `theme=${JSON.stringify(me.body?.theme)}`);

  const withDefault = async (slug) => {
    await resetRateLimits();
    const r = await req('founder', '/api/admin/themes/settings', {
      method: 'PUT',
      body: { themeDefault: slug },
    });
    if (r.status !== 200) return null;
    await sleep(300);
    const page = await fetch(`${WEB}/`, { redirect: 'follow' });
    const html = await page.text();
    return (html.match(/<html[^>]*data-theme="([a-z0-9-]+)"/) || [])[1];
  };

  // The assertion the whole change exists for: the setting reaches an anonymous
  // visitor's very first paint, from the server, with no correcting script.
  check('an anonymous visitor is served the site default',
    (await withDefault('e2e-crimson')) === 'e2e-crimson',
    'SSR did not carry the default');

  // And it keeps reaching them — a default is a live setting, not a value
  // stamped onto people once.
  check('changing the default moves them',
    (await withDefault('light')) === 'light',
    'SSR kept the old default');

  // A CHOICE is not a default, and must survive the owner changing theirs.
  await resetRateLimits();
  await req('plainuser', '/api/me', { method: 'PATCH', body: { theme: 'dark' } });
  const chosen = await withDefault('e2e-crimson');
  check('an explicit choice is untouched by a change of default',
    (await req('plainuser', '/api/me')).body?.theme === 'dark',
    'the choice was overwritten');
  check('while the anonymous visitor still follows it',
    chosen === 'e2e-crimson', `got ${chosen}`);

  // Going back to following is a choice too, and needs no entitlement: the
  // owner's default is available to everyone by definition.
  await resetRateLimits();
  const back = await req('plainuser', '/api/me', {
    method: 'PATCH',
    body: { theme: null },
  });
  check('a member can go back to following the default', back.status === 200,
    `status ${back.status}`);
  check('and stores no theme again',
    (await req('plainuser', '/api/me')).body?.theme === null,
    'null was not stored');

  await resetRateLimits();
  await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { themeDefault: 'dark' },
  });
}

// ── 6. System mode ───────────────────────────────────────────────────
console.log('\n6. system mode mapping');
await resetRateLimits();
{
  const same = await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { systemLight: 'light', systemDark: 'light' },
  });
  check('refuses the same theme for both halves', same.status >= 400, `status ${same.status}`);

  const map = await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { themeDefault: 'dark', systemLight: 'light', systemDark: 'e2e-crimson' },
  });
  check('accepts two different themes', map.status === 200, `status ${map.status} ${JSON.stringify(map.body).slice(0, 160)}`);

  const sheet = await css();
  const i = sheet.text.indexOf('@media (prefers-color-scheme: dark)');
  check('the media query is emitted', i > 0);
  const before = sheet.text.slice(0, i);
  const after = sheet.text.slice(i);
  const sysBlocks = (s) => s.slice(s.indexOf("[data-theme='system']"));
  check('the light half is unconditional', /--bg-base:\s*250 250 250/.test(sysBlocks(before)));
  check('the dark half carries the mapped theme',
    /--accent-warm:\s*220 38 38/.test(after), 'crimson accent not in the dark half');
}

// ── 7. Deleting a theme does not strand its users ────────────────────
console.log('\n7. delete');
await resetRateLimits();
{
  const del = await req('founder', `/api/admin/themes/${goldId}`, { method: 'DELETE' });
  check('deleted', del.status === 200 || del.status === 204, `status ${del.status}`);

  const who = await req('donator', '/api/auth/status');
  check('the member who held it goes back to following the default',
    who.body?.user?.theme === null,
    `theme is ${who.body?.user?.theme}`);

  const sheet = await css();
  check('its block is gone', !sheet.text.includes("[data-theme='e2e-gold']"));
}

// ── 7b. Deleting a system half cannot collapse the two ───────────────
console.log('\n7b. the two system halves stay different through a delete');
{
  await resetRateLimits();
  const made = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Half',
      base: 'dark',
      duplicateOf: 'dark',
      enabled: true,
      visibility: 'site',
    },
  });
  const id = made.body?.id ?? made.body?.theme?.id;

  // A legal but awkward mapping: the LIGHT half is a custom theme and the DARK
  // half is the `light` built-in. Deleting the custom theme resets the light
  // half to `light` — which is what the dark half already is.
  await sleep(200);
  const map = await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { systemLight: 'e2e-half', systemDark: 'light' },
  });
  check('the awkward mapping is accepted', map.status === 200, `status ${map.status}`);

  await sleep(200);
  await req('founder', `/api/admin/themes/${id}`, { method: 'DELETE' });

  const after = await req('founder', '/api/admin/themes');
  const s2 = after.body?.settings ?? {};
  check('the halves are still different after the delete',
    s2.systemLight !== s2.systemDark,
    `light=${s2.systemLight} dark=${s2.systemDark}`);
  check('and neither still names the deleted theme',
    s2.systemLight !== 'e2e-half' && s2.systemDark !== 'e2e-half',
    `light=${s2.systemLight} dark=${s2.systemDark}`);

  // Put it back so later phases start from the documented default.
  await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { themeDefault: 'dark', systemLight: 'light', systemDark: 'dark' },
  });
}

// ── 7c. Disabling releases the same references a delete does ─────────
console.log('\n7c. disabling a theme in use releases it too');
await resetRateLimits();
{
  const made = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Off',
      base: 'dark',
      duplicateOf: 'dark',
      enabled: true,
      visibility: 'site',
    },
  });
  const id = made.body?.id ?? made.body?.theme?.id;
  check('created', made.status === 200 || made.status === 201, `status ${made.status}`);

  await sleep(200);
  const set = await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { themeDefault: 'e2e-off', systemLight: 'e2e-off', systemDark: 'dark' },
  });
  check('it is the site default and the light half', set.status === 200, `status ${set.status}`);

  // Disabling, not deleting. The theme still exists; it just stops being
  // emitted, which is the same problem for anything pointing at it.
  await sleep(200);
  const off = await req('founder', `/api/admin/themes/${id}`, {
    method: 'PUT',
    body: { enabled: false, visibility: 'site' },
  });
  check('disabled', off.status === 200, `status ${off.status}`);

  const after = await req('founder', '/api/admin/themes');
  const s3 = after.body?.settings ?? {};
  check('the site default no longer names it',
    s3.themeDefault !== 'e2e-off', `themeDefault=${s3.themeDefault}`);
  check('nor does either system half',
    s3.systemLight !== 'e2e-off' && s3.systemDark !== 'e2e-off',
    `light=${s3.systemLight} dark=${s3.systemDark}`);
  check('and the halves are still different',
    s3.systemLight !== s3.systemDark,
    `light=${s3.systemLight} dark=${s3.systemDark}`);

  // The stylesheet is the thing that actually breaks, so assert on it rather
  // than only on the settings row.
  const sheet = (await css()).text;
  check('the disabled theme has no block',
    !sheet.includes("data-theme='e2e-off'"), 'a disabled theme is still emitted');
  const dflt = s3.themeDefault;
  check('and whatever the default now names does have one',
    ['light', 'dark'].includes(dflt) || sheet.includes(`data-theme='${dflt}'`),
    `default ${dflt} has no block`);

  await req('founder', `/api/admin/themes/${id}`, { method: 'DELETE' });
  await req('founder', '/api/admin/themes/settings', {
    method: 'PUT',
    body: { themeDefault: 'dark', systemLight: 'light', systemDark: 'dark' },
  });
}

// ── 8. The enabled cap ───────────────────────────────────────────────
console.log('\n8. the ten-theme cap');
{
  // Seven phases of admin writes have already spent the `mutation` budget, so
  // without this the first create here comes back 429 and the cap is never
  // reached. See lib.mjs on why the harness may do this.
  await resetRateLimits();
  let created = 0;
  let refusal = null;
  for (let i = 0; i < 12; i++) {
    // The admin routes are rate-limited like everything else, and twelve creates
    // in a row is exactly the shape that trips it. Pace rather than disable —
    // the point is to reach the theme cap, not to outrun the middleware.
    await sleep(700);
    const r = await req('founder', '/api/admin/themes', {
      method: 'POST',
      body: {
        name: `E2E Filler ${i}`,
        base: 'dark',
        duplicateOf: 'dark',
        enabled: true,
        visibility: 'site',
      },
    });
    if (r.status === 200 || r.status === 201) created++;
    else if (!refusal) refusal = { i, status: r.status, message: r.body?.message };
  }
  check(
    'refuses past the cap',
    !!refusal && !/too many requests/i.test(refusal.message ?? ''),
    refusal
      ? `refused for the wrong reason: ${refusal.message}`
      : `created ${created} with no refusal`,
  );
  const sheet = await css();
  const blocks = new Set([...sheet.text.matchAll(/\[data-theme='([a-z0-9-]+)'\]/g)].map((m) => m[1]));
  blocks.delete('system');
  check('the stylesheet never carries more than ten', blocks.size <= 10, `${blocks.size} themes`);
  console.log(`       (created ${created}, first refusal at #${refusal?.i}: ${refusal?.message})`);
}

// ── 9. What a browser actually receives ──────────────────────────────
console.log('\n9. through the web container');
{
  const page = await fetch(`${WEB}/`, { redirect: 'follow' });
  const html = await page.text();
  check('the html tag carries data-theme from SSR', /<html[^>]*data-theme="[a-z0-9-]+"/.test(html),
    (html.match(/<html[^>]*>/) || [''])[0]);
  const csp = page.headers.get('content-security-policy') ?? '';
  check('no font CDN in style-src', !/style-src[^;]*fonts\.googleapis/.test(csp));
  check('no font CDN in font-src', !/font-src[^;]*gstatic/.test(csp));
  check('the theme stylesheet is linked', html.includes('/api/theme.css'));

  const themed = await fetch(`${WEB}/`, {
    headers: { cookie: 'trackarr-theme=e2e-crimson' },
    redirect: 'follow',
  });
  const themedHtml = await themed.text();
  check('a theme cookie is honoured by SSR',
    /<html[^>]*data-theme="e2e-crimson"/.test(themedHtml),
    (themedHtml.match(/<html[^>]*>/) || [''])[0]);

  const hostile = await fetch(`${WEB}/`, {
    headers: { cookie: 'trackarr-theme=" onload="alert(1)' },
    redirect: 'follow',
  });
  const hostileHtml = await hostile.text();
  check('a hostile cookie cannot break out of the attribute',
    !hostileHtml.includes('onload="alert(1)"'),
    'attribute injection');
}

// ── Clean up ─────────────────────────────────────────────────────────
// The cap phase deliberately fills the ten enabled slots. Leaving them filled
// makes the next scenario's first `POST /api/admin/themes` fail on a cap it has
// nothing to do with — which is exactly what it did.
{
  const list = await req('founder', '/api/admin/themes');
  for (const row of list.body?.themes ?? []) {
    if (row.slug?.startsWith('e2e-') || row.slug?.startsWith('t-')) {
      await req('founder', `/api/admin/themes/${row.id}`, { method: 'DELETE' });
    }
  }
}

report();
