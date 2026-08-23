import { describe, expect, it } from 'vitest';
import { renderTemplate } from '@trackarr/shared/templateEngine';
import {
  DISABLED_BLOCK_NAME,
  toggleDisabledBlock,
} from '../app/composables/useSourceEditor';
import { sampleFicheContext } from '../app/utils/ficheTemplate';

/**
 * The part of the source editor that can be tested without a browser.
 *
 * Everything else in `useSourceEditor` is about the undo stack, which only
 * exists in a real engine: `document.execCommand('insertText')` is what makes a
 * programmatic edit undoable, and there is nothing to assert about it in Node.
 *
 * Switching a block off, on the other hand, has to be exact. An author who
 * disables a block and re-enables it must get their template back byte for
 * byte — in a format where one stray space or blank line changes the listing —
 * and the disabled block has to actually render nothing.
 */
describe('toggleDisabledBlock', () => {
  it('wraps a block in markers on their own lines', () => {
    expect(toggleDisabledBlock('[b]{{TITLE}}[/b]')).toBe(
      ['{{#OFF}}', '[b]{{TITLE}}[/b]', '{{/OFF}}'].join('\n'),
    );
  });

  it('round-trips a multi-line block exactly', () => {
    const block = ['[center]', '  {{TITLE}}', '', '[/center]'].join('\n');
    expect(toggleDisabledBlock(toggleDisabledBlock(block))).toBe(block);
  });

  it('copies the indentation of the first meaningful line', () => {
    expect(toggleDisabledBlock('    {{FACTS_BLOCK}}')).toBe(
      ['    {{#OFF}}', '    {{FACTS_BLOCK}}', '    {{/OFF}}'].join('\n'),
    );
  });

  it('leaves surrounding blank lines where they were', () => {
    // Blank lines separate sections in a listing template; moving one shifts
    // the whole layout.
    const block = ['', '{{TITLE}}', ''].join('\n');
    expect(toggleDisabledBlock(block)).toBe(
      ['', '{{#OFF}}', '{{TITLE}}', '{{/OFF}}', ''].join('\n'),
    );
  });

  it('does nothing to a selection with no content', () => {
    expect(toggleDisabledBlock('')).toBe('');
    expect(toggleDisabledBlock('\n\n')).toBe('\n\n');
  });

  it('does not treat a block that merely starts with a section as disabled', () => {
    const block = ['{{#YEAR}}', '{{YEAR}}', '{{/YEAR}}'].join('\n');
    expect(toggleDisabledBlock(block)).toBe(
      ['{{#OFF}}', ...block.split('\n'), '{{/OFF}}'].join('\n'),
    );
  });

  it('nests, so an inner disabled block survives disabling the outer one', () => {
    const inner = toggleDisabledBlock('{{TITLE}}');
    const outer = toggleDisabledBlock(inner);
    // Enabling the outer block must give the inner one back untouched.
    expect(toggleDisabledBlock(outer)).toBe(inner);
  });
});

describe('a disabled block renders nothing', () => {
  // The reason this mechanism is a section and not the grammar's comment.
  it('renders as empty, whatever the body contains', () => {
    const source = toggleDisabledBlock('[b]{{TITLE}}[/b] and {{OVERVIEW}}');
    expect(renderTemplate(source, sampleFicheContext())).toBe('');
  });

  it('is why the comment form was not used', () => {
    // A comment ends at the FIRST `}}`, so wrapping a line that contains a
    // variable leaves the tail of it rendering. This is the measurement the
    // choice rests on, kept as a test so nobody "simplifies" it back.
    expect(renderTemplate('{{! [b]{{TITLE}}[/b] }}', { TITLE: 'T' })).toBe('[/b] }}');
  });

  it('leaves no blank line behind once switched back on', () => {
    const body = ['[center]', '{{TITLE}}', '[/center]'].join('\n');
    const off = toggleDisabledBlock(body);
    // Standalone marker lines are consumed whole by the engine, so the
    // disabled form renders empty rather than as two blank lines.
    expect(renderTemplate(off, sampleFicheContext())).toBe('');
    expect(toggleDisabledBlock(off)).toBe(body);
  });

  it('uses a name nothing can fill', () => {
    // If the context ever grew a key by this name the mechanism would break,
    // so the sample bag — which mirrors the real one — must not carry it.
    expect(Object.keys(sampleFicheContext())).not.toContain(DISABLED_BLOCK_NAME);
  });
});
