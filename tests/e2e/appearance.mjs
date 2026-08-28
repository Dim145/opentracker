/**
 * The wave-2 levers, checked on the stylesheet a browser actually downloads.
 *
 * The unit tests prove the validators; this proves the plumbing. A theme that
 * sets `shadow-strength` or `motion-scale` or `radius` has to reach hundreds of
 * declarations it never mentions, through `calc()` and a derived scale, and the
 * only place that is observably true is the emitted CSS.
 */
import {
  API,
  caller,
  check,
  expireFreshAuth,
  report,
  resetRateLimits,
  sessions,
  sleep,
} from './lib.mjs';

const S = sessions(['founder']);
const req = caller(S);

async function sheet() {
  const res = await fetch(`${API}/api/theme.css`);
  return res.text();
}

/** The declaration block for one theme, so a match cannot come from elsewhere. */
function blockFor(css, slug) {
  const at = css.indexOf(`:root[data-theme='${slug}']`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

await resetRateLimits();

// ── 1. The levers survive the round trip ─────────────────────────────
console.log('\n1. a theme that moves every lever at once');
{
  const r = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Flat',
      description: 'No shadows, no motion, square corners.',
      base: 'dark',
      duplicateOf: 'dark',
      tokens: {
        'shadow-strength': '0',
        'motion-scale': '0',
        radius: '0px',
        'radius-pill': '0px',
        'ease-standard': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      enabled: true,
      visibility: 'site',
    },
  });
  check('created', r.status === 200 || r.status === 201,
    `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

  const block = blockFor(await sheet(), 'e2e-flat');
  check('the block exists', block.length > 0);
  check('shadow-strength is 0', /--shadow-strength:\s*0\s*;/.test(block), block.slice(0, 120));
  check('motion-scale is 0', /--motion-scale:\s*0\s*;/.test(block));
  check('radius is 0px', /--radius:\s*0px\s*;/.test(block));
  check('the overshoot easing survived intact',
    block.includes('cubic-bezier(0.34, 1.56, 0.64, 1)'),
    'easing missing or rewritten');
  check('the untouched tokens are inherited from dark',
    /--bg-base:\s*10 10 10\s*;/.test(block));
}

// ── 1b. The pattern geometry, which CSS cannot select on its own ─────
console.log('\n1b. background pattern geometry');
{
  await sleep(150);
  const r = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Plain',
      base: 'light',
      duplicateOf: 'light',
      tokens: { 'bg-pattern-kind': 'none', 'bg-pattern-step': '80px' },
      enabled: true,
      visibility: 'site',
    },
  });
  check('created', r.status === 200 || r.status === 201, `status ${r.status}`);

  const css = await sheet();
  const plain = blockFor(css, 'e2e-plain');
  check('the kind is stored as the enum', /--bg-pattern-kind:\s*none\s*;/.test(plain));
  check('the emitter derived the image', /--bg-pattern-image:\s*none\s*;/.test(plain),
    plain.slice(0, 160));
  check('the step came through', /--bg-pattern-step:\s*80px\s*;/.test(plain));

  // The default has to keep painting the dot grid, or every existing theme
  // silently loses its background.
  await sleep(150);
  const g = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Graph',
      base: 'dark',
      duplicateOf: 'dark',
      tokens: { 'bg-pattern-kind': 'grid' },
      enabled: true,
      visibility: 'site',
    },
  });
  check('a grid theme is accepted', g.status === 200 || g.status === 201, `status ${g.status}`);
  const grid = blockFor(await sheet(), 'e2e-graph');
  check('the grid image is two linear-gradients',
    (grid.match(/linear-gradient/g) ?? []).length === 2, grid.slice(0, 200));
  check('the image still composes the tint and the step',
    grid.includes('var(--bg-pattern)'), 'the tint is not referenced');

  await sleep(150);
  const bad = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Bad Pattern',
      base: 'dark',
      duplicateOf: 'dark',
      // The whole reason the kind is an enum: this is what a free-form
      // `background-image` would have accepted.
      tokens: { 'bg-pattern-kind': 'url(https://evil.example/beacon.png)' },
      visibility: 'site',
    },
  });
  check('an image is not a kind', bad.status >= 400, `status ${bad.status}`);
}

// ── 1c. Font roles: a short name in, a whole stack out ───────────────
console.log('\n1c. font families');
{
  await sleep(150);
  const r = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Editorial',
      base: 'light',
      duplicateOf: 'light',
      tokens: {
        'font-sans': 'manrope',
        'font-mono': 'space-mono',
        'font-display': 'playfair-display',
      },
      enabled: true,
      visibility: 'site',
    },
  });
  check('created', r.status === 200 || r.status === 201, `status ${r.status}`);

  const block = blockFor(await sheet(), 'e2e-editorial');
  // The stored value is a name; what CSS receives is the stack. This is the
  // only place that difference is observable.
  check('the sans stack was looked up', block.includes("--font-sans: 'Manrope'"),
    block.match(/--font-sans:[^;]*/)?.[0] ?? 'missing');
  check('the mono stack was looked up', block.includes("--font-mono: 'Space Mono'"));
  check('the display stack was looked up',
    block.includes("--font-display: 'Playfair Display'"));
  check('every stack still ends in something already on the machine',
    /--font-sans:[^;]*sans-serif;/.test(block) &&
      /--font-mono:[^;]*monospace;/.test(block) &&
      /--font-display:[^;]*serif;/.test(block),
    'a stack has no system fallback');
  check('the name is not what reaches CSS', !/--font-sans:\s*manrope\s*;/.test(block));

  await sleep(150);
  const bad = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Ghost Font',
      base: 'dark',
      duplicateOf: 'dark',
      // A font the build never shipped. A free text field would have accepted
      // this and the page would silently fall back.
      tokens: { 'font-sans': 'Comic Sans MS' },
      visibility: 'site',
    },
  });
  check('a family the build did not ship is refused', bad.status >= 400, `status ${bad.status}`);

  await sleep(150);
  const wrongRole = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Wrong Role',
      base: 'dark',
      duplicateOf: 'dark',
      // The roles are separate lists on purpose: a proportional face in a
      // column of hashes is not a theme, it is a broken table.
      tokens: { 'font-mono': 'playfair-display' },
      visibility: 'site',
    },
  });
  check('a display face is not offered for the mono role',
    wrongRole.status >= 400, `status ${wrongRole.status}`);
}

// ── 2. What the validators refuse, refused over HTTP ─────────────────
console.log('\n2. the route refuses what the schema refuses');
{
  const cases = [
    ['a scalar past its ceiling', { 'shadow-strength': '4' }],
    ['a negative scalar', { 'motion-scale': '-1' }],
    ['a radius past its ceiling', { radius: '400px' }],
    ['a radius in a unit the token disallows', { radius: '2em' }],
    ['a calc() smuggled into a length', { radius: 'calc(6px * 100)' }],
    ['an easing with unbounded arguments', { 'ease-standard': 'steps(40, end)' }],
    ['an easing with an out-of-range x', { 'ease-standard': 'cubic-bezier(2, 0, 0.5, 1)' }],
    ['CSS syntax in a scalar', { 'shadow-strength': '1;}html{display:none' }],
    ['a url() in an easing', { 'ease-standard': 'ease) ;background:url(https://evil.example' }],
  ];
  for (const [what, tokens] of cases) {
    await sleep(120);
    const r = await req('founder', '/api/admin/themes', {
      method: 'POST',
      body: {
        name: `E2E Reject ${what}`,
        base: 'dark',
        duplicateOf: 'dark',
        tokens,
        visibility: 'site',
      },
    });
    check(what, r.status >= 400 && r.status < 500, `status ${r.status}`);
  }

  const css = await sheet();
  check('nothing hostile reached the stylesheet',
    !css.includes('evil.example') && !css.includes('display:none') && !css.includes('url('),
    'the emitter let something through');
}

// ── 3. A theme can only reach tokens the schema knows ────────────────
console.log('\n3. unknown tokens');
{
  await sleep(120);
  const r = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Unknown',
      base: 'dark',
      duplicateOf: 'dark',
      // `--dur-2` is a DERIVED value, deliberately not a token: letting a theme
      // set it independently would break the proportions the scale exists for.
      tokens: { 'dur-2': '5s', 'radius-md': '40px' },
      visibility: 'site',
    },
  });
  check('a derived name is not a token', r.status >= 400, `status ${r.status}`);
}

// ── 4. The owner's raw CSS ───────────────────────────────────────────
console.log('\n4. raw CSS, owner only');
{
  await resetRateLimits();
  const made = await req('founder', '/api/admin/themes', {
    method: 'POST',
    body: {
      name: 'E2E Raw',
      base: 'dark',
      duplicateOf: 'dark',
      enabled: true,
      visibility: 'site',
    },
  });
  const id = made.body?.id ?? made.body?.theme?.id;
  check('theme created', !!id, `status ${made.status}`);

  // A plain member is refused on both verbs.
  const write = await req('donator', `/api/admin/themes/${id}/css`, {
    method: 'PUT',
    body: { css: '.a { color: red; }' },
  });
  check('a plain member cannot write CSS', write.status === 401 || write.status === 403,
    `status ${write.status}`);
  const read = await req('donator', `/api/admin/themes/${id}/css`);
  check('a plain member cannot read it either', read.status === 401 || read.status === 403,
    `status ${read.status}`);

  // The owner's session is fresh — `login` stamps it for ten minutes — so this
  // is the success path.
  const saved = await req('founder', `/api/admin/themes/${id}/css`, {
    method: 'PUT',
    body: {
      css:
        '.torrent-row:hover { background: rgb(var(--accent-warm) / 0.06); }\n' +
        '@keyframes glow { to { opacity: 0.4; } }\n' +
        '.pill { animation: glow 2s infinite; }',
    },
  });
  check('the owner can save', saved.status === 200,
    `status ${saved.status} ${JSON.stringify(saved.body).slice(0, 200)}`);

  const css = await sheet();
  check('it reaches the stylesheet scoped to the theme',
    css.includes('[data-theme="e2e-raw"] .torrent-row:hover'),
    css.slice(css.indexOf('e2e-raw'), css.indexOf('e2e-raw') + 200));
  check('the keyframes were namespaced',
    css.includes('@keyframes e2e-raw-glow') && !/@keyframes glow\b/.test(css));
  check('and the reference was rewritten with them',
    css.includes('animation:e2e-raw-glow'));
  check('the theme tokens are still there', /:root\[data-theme='e2e-raw'\]/.test(css));

  // Read-back is what makes the editor able to edit rather than only overwrite.
  const back = await req('founder', `/api/admin/themes/${id}/css`);
  check('the owner reads back what was stored', back.status === 200 &&
    typeof back.body?.css === 'string' && back.body.css.includes('torrent-row'),
    `status ${back.status}`);
  check('what is stored is unscoped', !back.body?.css?.includes('data-theme'),
    'the stored value carries a scope it should not');

  // The refusals that matter.
  for (const [what, css_] of [
    ['url()', '.a { background: url(https://evil.example/x); }'],
    ['@import', "@import 'https://evil.example/x.css';"],
    ['@font-face', "@font-face { font-family: 'Inter'; src: local(x); }"],
    ['a url() hidden in a custom property',
     ':root { --bg-pattern-image: url(https://evil.example/x); }'],
  ]) {
    const r = await req('founder', `/api/admin/themes/${id}/css`, {
      method: 'PUT',
      body: { css: css_ },
    });
    check(`refuses ${what}`, r.status === 400, `status ${r.status}`);
    check(`and says why for ${what}`,
      Array.isArray(r.body?.data?.issues) && r.body.data.issues.length > 0,
      JSON.stringify(r.body).slice(0, 160));
  }

  const after = await sheet();
  check('none of it reached the stylesheet',
    !after.includes('evil.example') && !after.includes('url('),
    'something got through');

  // Finally, the fresh-auth gate. Done last because it makes every session in
  // this run stale, and nothing after it needs one.
  await expireFreshAuth();
  const stale = await req('founder', `/api/admin/themes/${id}/css`, {
    method: 'PUT',
    body: { css: '.a { color: red; }' },
  });
  check('a stale session cannot write CSS', stale.status === 401, `status ${stale.status}`);
  check('and is told to re-authenticate', stale.body?.data?.reauthRequired === true,
    JSON.stringify(stale.body).slice(0, 160));
  const stillReads = await req('founder', `/api/admin/themes/${id}/css`);
  check('reading is deliberately not fresh-gated', stillReads.status === 200,
    `status ${stillReads.status}`);
}

// ── Clean up ─────────────────────────────────────────────────────────
// Scenarios share one database and the enabled-theme cap is a global. Leaving
// `e2e-flat` behind would silently move the count another scenario asserts on.
{
  const list = await req('founder', '/api/admin/themes');
  for (const row of list.body?.rows ?? []) {
    if (row.slug?.startsWith('e2e-')) {
      await req('founder', `/api/admin/themes/${row.id}`, { method: 'DELETE' });
    }
  }
}

report();
