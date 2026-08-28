import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The recovery-code print sheet, and the trap it keeps falling into.
//
// `RecoveryCodesView.vue` builds a stylesheet as a JavaScript string and hands
// it to a document opened with `window.open`. That document is not this
// application: none of its custom properties exist there, so
// `font-family: var(--font-mono)` resolves to nothing and
// `letter-spacing: calc(.06em * var(--tracking-scale))` is invalid at
// computed-value time. Either way the declaration is silently dropped and the
// printed page loses the styling — no error, nothing in the console, and the
// only way to notice is to print a page of recovery codes and look at it.
//
// It has happened TWICE, from two different codemods, and for the same reason
// both times: the string literally contains `<style>` … `</style>`, so a
// regex looking for a single-file-component style block matches it. The two
// are textually identical and only a parser could tell them apart.
//
// So this is a guard rather than a unit test. It asserts the property the file
// needs — the print stylesheet refers to nothing outside its own document —
// which is exactly what a codemod breaks and a reviewer skims past.

const SOURCE = readFileSync(
  fileURLToPath(
    new URL('../app/components/security/RecoveryCodesView.vue', import.meta.url),
  ),
  'utf8',
);

/**
 * The `<style>…</style>` written into the popup, extracted from the JS string
 * rather than from the SFC — the file has both.
 */
function printStylesheet(): string {
  // Comments stripped first. The concatenation carries a `//` note explaining
  // why these values must stay literal, and that note necessarily QUOTES the
  // broken form — so a guard reading the raw text flags the explanation of the
  // bug as the bug. Which it duly did.
  const call = SOURCE.slice(SOURCE.indexOf('w.document.write('))
    .replace(/^\s*\/\/.*$/gm, '');
  expect(call, 'the print window call moved or was renamed').not.toHaveLength(0);
  const open = call.indexOf('<style>');
  const close = call.indexOf('</style>');
  expect(open, 'no <style> in the print document').toBeGreaterThan(-1);
  expect(close, 'unterminated <style> in the print document').toBeGreaterThan(open);
  return call.slice(open, close);
}

describe('the recovery-code print stylesheet', () => {
  it('refers to no custom property', () => {
    // The whole point. A `var()` here is a declaration that silently does
    // nothing, in the one view a member prints and keeps on paper.
    const css = printStylesheet();
    expect(css).not.toMatch(/var\(\s*--/);
  });

  it('refers to no calc() over one either', () => {
    // The subtler form: `calc(.06em * var(--x))` is not just an unresolved
    // value, it is invalid at computed-value time, which drops the property
    // rather than falling back.
    expect(printStylesheet()).not.toMatch(/calc\(/);
  });

  it('still styles the codes, so the guard cannot pass by the sheet being empty', () => {
    // A test that only forbids things passes when somebody deletes the
    // stylesheet. Pin what it must still contain.
    const css = printStylesheet();
    expect(css).toMatch(/font-family:/);
    expect(css).toMatch(/letter-spacing:/);
  });
});
