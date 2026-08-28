/**
 * The wave-2 levers, checked on the stylesheet a browser actually downloads.
 *
 * The unit tests prove the validators; this proves the plumbing. A theme that
 * sets `shadow-strength` or `motion-scale` or `radius` has to reach hundreds of
 * declarations it never mentions, through `calc()` and a derived scale, and the
 * only place that is observably true is the emitted CSS.
 */
import { API, caller, check, report, resetRateLimits, sessions, sleep } from './lib.mjs';

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
