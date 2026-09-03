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
 * The stylesheet handed to the popup, extracted from the JS string rather than
 * from the SFC — the file has both.
 *
 * It is no longer wrapped in a literal `<style>…</style>`: the document is
 * built with `createElement` now, so the sheet is whatever is assigned to the
 * element's `textContent`. That removed the very ambiguity described above —
 * the string no longer looks like a single-file-component style block — but
 * the property it must hold is unchanged, so the guard stays.
 */
function printStylesheet(): string {
  // Comments stripped first. The concatenation carries a `//` note explaining
  // why these values must stay literal, and that note necessarily QUOTES the
  // broken form — so a guard reading the raw text flags the explanation of the
  // bug as the bug. Which it duly did.
  const open = SOURCE.indexOf('style.textContent =');
  expect(open, 'the print stylesheet moved or was renamed').toBeGreaterThan(-1);
  const close = SOURCE.indexOf('doc.head.append(style)', open);
  expect(close, 'the print stylesheet is never attached').toBeGreaterThan(open);
  return SOURCE.slice(open, close).replace(/^\s*\/\/.*$/gm, '');
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

  // The nonce, which the tag needs and the sheet's own rules must not.
  it('carries the CSP nonce', () => {
    // `about:blank` from `window.open` inherits the opener's policy, so the
    // stylesheet is blocked without this and the printed page loses its layout —
    // silently, the same way a `var()` here would.
    expect(SOURCE).toMatch(/script\[nonce\]/);
    expect(SOURCE).toMatch(/style\.setAttribute\('nonce', nonce\)/);
  });

  // The reason the shape changed at all.
  it('builds the print document with nodes, not with concatenated markup', () => {
    // `document.write` with an interpolated title, intro and code list was the
    // application's only raw-HTML sink, on its most sensitive screen. Nothing
    // reaching it was attacker-controlled, so nothing was exploitable — but
    // that held only as long as all three sources stayed harmless, which is a
    // promise about the future rather than a property of the code. A text node
    // does not parse; that is a property.
    expect(SOURCE).not.toMatch(/document\s*\.\s*write\s*\(/);
    expect(SOURCE).toMatch(/code\.textContent = c;/);
  });
});
