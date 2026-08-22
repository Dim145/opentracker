import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TemplateError,
  assertTemplateValid,
  renderTemplate,
  templateVariables,
} from '@trackarr/shared/templateEngine';

// The renderer runs templates written by users, in the browser, inside a
// `computed` that re-evaluates on every keystroke. Two properties matter more
// than features: it must never execute anything, and it must never fail to
// terminate. The rest is the standalone-line rule, which is not cosmetic — the
// default listing template cannot reproduce its blank lines without it, so it
// is tested here rather than only through the listing.

describe('interpolation', () => {
  it('replaces a name with its value', () => {
    expect(renderTemplate('Hello {{NAME}}!', { NAME: 'world' })).toBe('Hello world!');
  });

  it('renders an unknown name as nothing', () => {
    // A listing with no rating is a normal listing, not a broken template.
    expect(renderTemplate('a{{MISSING}}b', {})).toBe('ab');
  });

  it('renders a null or empty value as nothing', () => {
    expect(renderTemplate('[{{A}}{{B}}]', { A: null, B: '' })).toBe('[]');
  });

  it('tolerates spaces inside the braces', () => {
    expect(renderTemplate('{{ NAME }}', { NAME: 'x' })).toBe('x');
  });

  it('leaves a lone brace pair alone as text', () => {
    expect(renderTemplate('a { b } c', {})).toBe('a { b } c');
  });

  it('does not re-read its own output', () => {
    // A value that looks like a tag stays a value: no second pass, so a user
    // cannot smuggle a section in through the metadata.
    expect(renderTemplate('{{A}}', { A: '{{B}}' })).toBe('{{B}}');
  });
});

describe('sections', () => {
  it('keeps the body of a truthy section', () => {
    expect(renderTemplate('a{{#S}}b{{/S}}c', { S: 'yes' })).toBe('abc');
  });

  it('drops the body of an empty, false or missing one', () => {
    for (const value of ['', false, null, undefined]) {
      expect(renderTemplate('a{{#S}}b{{/S}}c', { S: value })).toBe('ac');
    }
  });

  it('inverts on the same rule', () => {
    expect(renderTemplate('a{{^S}}b{{/S}}c', { S: '' })).toBe('abc');
    expect(renderTemplate('a{{^S}}b{{/S}}c', { S: 'yes' })).toBe('ac');
  });

  it('nests, and skips a whole nested branch at once', () => {
    const template = '{{#A}}1{{#B}}2{{#C}}3{{/C}}{{/B}}{{/A}}';
    expect(renderTemplate(template, { A: 'x', B: 'x', C: 'x' })).toBe('123');
    expect(renderTemplate(template, { A: 'x', B: '', C: 'x' })).toBe('1');
  });

  it('reads the same variable as both condition and value', () => {
    expect(renderTemplate('{{#URL}}[img]{{URL}}[/img]{{/URL}}', { URL: 'http://x' })).toBe(
      '[img]http://x[/img]',
    );
  });

  it('drops a comment without dropping its neighbours', () => {
    expect(renderTemplate('a{{! anything at all }}b', {})).toBe('ab');
  });
});

describe('standalone lines', () => {
  it('consumes the line a section tag sits alone on, newline included', () => {
    // The rule the default listing template depends on. Without it each of the
    // two tags would leave an empty line behind and the output would gain two
    // newlines that the original generator never emitted.
    expect(renderTemplate('a\n{{#S}}\nb\n{{/S}}\nc', { S: 'x' })).toBe('a\nb\nc');
  });

  it('consumes the same lines when the section is skipped', () => {
    expect(renderTemplate('a\n{{#S}}\nb\n{{/S}}\nc', { S: '' })).toBe('a\nc');
  });

  it('keeps a blank line that belongs to the body', () => {
    // This is how the listing emits its blank separator lines: an empty line
    // inside the section, not around its tags.
    expect(renderTemplate('a\n{{#S}}\n\nb\n{{/S}}\nc', { S: 'x' })).toBe('a\n\nb\nc');
  });

  it('ignores indentation in front of a standalone tag', () => {
    expect(renderTemplate('a\n  {{#S}}\nb\n  {{/S}}\nc', { S: 'x' })).toBe('a\nb\nc');
  });

  it('treats a tag sharing its line with text as ordinary', () => {
    // Both branches of the listing header banner sit on one line; if this
    // stripped, that line would lose its newline.
    expect(renderTemplate('x{{#S}}\ny{{/S}}z', { S: 'v' })).toBe('x\nyz');
    expect(renderTemplate('x{{#S}}\ny{{/S}}z', { S: '' })).toBe('xz');
  });

  it('treats a line holding two tags as ordinary', () => {
    expect(renderTemplate('{{#A}}1{{/A}}{{^A}}2{{/A}}\nz', { A: 'x' })).toBe('1\nz');
    expect(renderTemplate('{{#A}}1{{/A}}{{^A}}2{{/A}}\nz', { A: '' })).toBe('2\nz');
  });

  it('never strips the line of an interpolation', () => {
    // An interpolation alone on its line is a line of output, empty or not —
    // the pre-rendered blocks of the listing rely on it.
    expect(renderTemplate('a\n{{V}}\nb', { V: 'x' })).toBe('a\nx\nb');
    expect(renderTemplate('a\n{{V}}\nb', { V: '' })).toBe('a\n\nb');
  });

  it('handles a standalone tag at the very start and very end', () => {
    expect(renderTemplate('{{#S}}\nbody\n{{/S}}', { S: 'x' })).toBe('body');
  });

  it('strips a standalone comment line whole', () => {
    expect(renderTemplate('a\n{{! note }}\nb', {})).toBe('a\nb');
  });

  it('strips a windows line ending too', () => {
    // Templates come back from a textarea, which may hand us CRLF.
    expect(renderTemplate('a\r\n{{#S}}\r\nb\r\n{{/S}}\r\nc', { S: 'x' })).toBe('a\r\nb\r\nc');
  });
});

describe('the closing whitespace pass', () => {
  it('collapses four newlines or more down to three', () => {
    expect(renderTemplate('a{{V}}b', { V: '\n\n\n\n\n' })).toBe('a\n\n\nb');
  });

  it('runs over the whole render rather than variable by variable', () => {
    // Two variables each ending and starting with newlines add up to a run
    // that only a final pass can see.
    expect(renderTemplate('{{A}}{{B}}', { A: 'a\n\n', B: '\n\nb' })).toBe('a\n\n\nb');
  });

  it('trims the ends', () => {
    expect(renderTemplate('\n\n  {{V}}  \n\n', { V: 'x' })).toBe('x');
  });
});

describe('broken templates fail loudly', () => {
  it('names the unclosed section and the line it was opened on', () => {
    // The failure mode this replaces: the rest of the template read as section
    // body and silently dropped, producing a listing missing its last third.
    expect(() => renderTemplate('a\nb\n{{#S}}\nrest', {})).toThrow(TemplateError);
    expect(() => renderTemplate('a\nb\n{{#S}}\nrest', {})).toThrow('{{#S}} is never closed');
    expect(() => renderTemplate('a\nb\n{{#S}}\nrest', {})).toThrow('line 3');
  });

  it('rejects a close that does not match the open', () => {
    expect(() => renderTemplate('{{#A}}x{{/B}}', {})).toThrow('does not close {{#A}}');
  });

  it('rejects a close with nothing open', () => {
    expect(() => renderTemplate('x{{/A}}', {})).toThrow('never opened');
  });

  it('rejects a tag that is never closed by braces', () => {
    expect(() => renderTemplate('a {{NAME', {})).toThrow('never closed by a "}}"');
  });

  it('rejects a name that is not a name', () => {
    for (const template of ['{{a-b}}', '{{9}}', '{{a.b}}', '{{}}', '{{a b}}']) {
      expect(() => renderTemplate(template, {})).toThrow(TemplateError);
    }
  });

  it('refuses the parts of Mustache we do not implement, by name', () => {
    expect(() => renderTemplate('{{>partial}}', {})).toThrow('partials');
    expect(() => renderTemplate('{{{raw}}}', {})).toThrow('triple mustache');
    expect(() => renderTemplate('{{=<% %>=}}', {})).toThrow('delimiter changes');
  });

  it('validates without needing a context', () => {
    expect(() => assertTemplateValid('{{#S}}x')).toThrow(TemplateError);
    expect(() => assertTemplateValid('{{#S}}x{{/S}}')).not.toThrow();
  });

  it('lists the names a template uses, sections included', () => {
    expect(templateVariables('{{A}}{{#B}}{{C}}{{A}}{{/B}}')).toEqual(['A', 'B', 'C']);
  });
});

describe('the hard limits', () => {
  it('refuses to render past the output cap', () => {
    const template = `{{V}}`;
    expect(() => renderTemplate(template, { V: 'x'.repeat(50) }, { maxOutputChars: 10 })).toThrow(
      'exceeds 10 characters',
    );
  });

  it('accepts a render that fits exactly', () => {
    expect(renderTemplate('{{V}}', { V: 'xxxxx' }, { maxOutputChars: 5 })).toBe('xxxxx');
  });

  it('refuses to parse past the nesting cap', () => {
    const deep = '{{#A}}{{#A}}{{#A}}{{#A}}x{{/A}}{{/A}}{{/A}}{{/A}}';
    expect(() => renderTemplate(deep, { A: 'x' }, { maxDepth: 3 })).toThrow('nested more than 3');
    expect(renderTemplate(deep, { A: 'x' }, { maxDepth: 4 })).toBe('x');
  });

  it('stays linear on a long template with many tags', () => {
    // No loop in the grammar, so output is bounded by the template itself and
    // the only way to hang is an accidental quadratic scan — which is exactly
    // what looking the current line up per tag used to be. 120 000 tags with
    // no newline among them: ~50 ms linear against ~10 s quadratic, so the
    // budget is loose enough for a busy runner and still catches a regression.
    const template = '{{#A}}x{{/A}}'.repeat(40_000);
    const started = Date.now();
    expect(renderTemplate(template, { A: 'x' }, { maxOutputChars: 100_000 })).toHaveLength(40_000);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('nothing is compiled or evaluated', () => {
  it('builds no pattern out of the template', () => {
    // The engine matches names against one fixed pattern and never constructs
    // one, so a template can neither be crafted into a pathological pattern
    // nor smuggle anything into a matcher. Regular-expression literals do not
    // go through this global, so replacing it catches only construction.
    const original = globalThis.RegExp;
    const trap = function trap() {
      throw new Error('a pattern was compiled while rendering');
    };
    let rendered = '';
    try {
      (globalThis as { RegExp: unknown }).RegExp = trap;
      rendered = renderTemplate('{{#S}}a.*b(c{2,})|[x-z]{{S}}{{/S}}', { S: '$1\\d+' });
    } finally {
      (globalThis as { RegExp: unknown }).RegExp = original;
    }
    expect(rendered).toBe('a.*b(c{2,})|[x-z]$1\\d+');
  });

  it('contains no dynamic evaluation at all', () => {
    // A tripwire on the source itself: the review above is only worth
    // something as long as nobody adds one of these later.
    const source = readFileSync(
      new URL('../../../packages/shared/src/templateEngine.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of ['new RegExp', 'eval(', 'new Function', 'Function(']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
