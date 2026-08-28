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

// ── 6. System mode ───────────────────────────────────────────────────
console.log('\n6. system mode mapping');
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
{
  const del = await req('founder', `/api/admin/themes/${goldId}`, { method: 'DELETE' });
  check('deleted', del.status === 200 || del.status === 204, `status ${del.status}`);

  const who = await req('donator', '/api/auth/status');
  check('the member who held it moved to the default', who.body?.user?.theme === 'dark',
    `theme is ${who.body?.user?.theme}`);

  const sheet = await css();
  check('its block is gone', !sheet.text.includes("[data-theme='e2e-gold']"));
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

report();
