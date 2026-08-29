import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// Components that turn the focus ring off.
//
// main.css defines one site-wide indicator — `:focus-visible { outline: 2px
// solid rgb(var(--focus-ring)) }` — and the note above it says the outline
// "cannot be turned off here: 2.4.11 needs a visible focus indicator, and
// 'inputs are obvious enough' is how sites end up with none". A second note
// says components should not re-declare focus styles because the global rule
// covers them.
//
// It drifted anyway: 27 uses of Tailwind's `focus:outline-none` across 12
// files, including six on the registration form and two on login — the most
// keyboard-driven pages on the site. `focus:outline-none` compiles to
// `.focus\:outline-none:focus { outline: 2px solid transparent }`, specificity
// (0,2,0), which beats `:focus-visible` at (0,1,0). The ring was genuinely
// suppressed, not merely restyled.
//
// Two of the 27 looked compensated, with `focus:ring-2 focus:ring-white/10`
// and `/20`. Measured against their own background — rgb(26,26,26) — those
// composite to 1.34:1 and 1.90:1. WCAG 2.4.11 asks 3:1. They were decoration.
// The global ring measures 7.77:1 on the same background.
//
// This check is textual and deliberately narrow, like `sfcImports.test.ts`:
// it guards the Tailwind utility form, which is the one that drifted. The
// scoped-CSS `outline: none` form is nearly always paired with a real custom
// ring or delegated to a wrapper's `:focus-within`, and no textual rule can
// tell those apart from the broken ones.

const APP = fileURLToPath(new URL('../app', import.meta.url));

/**
 * The only two places allowed to keep it, each documented at the call site.
 * A new entry here needs the same: a reason why the caret or a wrapper is
 * carrying the indicator instead.
 */
const DELIBERATE: Record<string, string> = {
  'components/WysiwygEditor.vue':
    'the ProseMirror editing surface — the caret is the indicator and the wrapper has focus-within',
  'components/TagInput.vue':
    'the inner chip field — .tag-input:focus-within frames the whole control',
};

/** Tailwind's outline-killing utilities, in both the bare and `focus:` forms. */
const SUPPRESSOR = /(?:^|[\s'"`:])(?:focus:)?outline-none(?:[\s'"`]|$)/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.vue') ? [full] : [];
  });
}

const FILES = walk(APP);

describe('the focus ring is not turned off', () => {
  it('sweeps a realistic number of components', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(FILES.map((f) => [relative(APP, f), f]))(
    '%s',
    (rel, full) => {
      const offenders = readFileSync(full, 'utf8')
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        // The prose that explains the rule is not a use of it.
        .filter(([, line]) => !/deliberate|deliberately/.test(line))
        .filter(([, line]) => SUPPRESSOR.test(line));

      if (DELIBERATE[rel]) {
        expect(
          offenders.length,
          `${rel} is allowlisted (${DELIBERATE[rel]}) but no longer suppresses the ring — drop it from DELIBERATE`
        ).toBeGreaterThan(0);
        return;
      }

      expect(
        offenders.map(([n, line]) => `${rel}:${n} ${line.trim()}`),
        `${rel} suppresses the site-wide focus ring. main.css owns the indicator; ` +
          'keep any focus:border-* / focus:bg-* tint and drop the outline-none. ' +
          'If the caret or a wrapper genuinely carries it, document that at the ' +
          'call site and add the file to DELIBERATE.'
      ).toEqual([]);
    }
  );
});
