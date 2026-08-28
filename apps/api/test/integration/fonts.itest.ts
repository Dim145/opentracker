import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import {
  uploadTokenProblems,
  fontFaceCss,
  isWoff2,
  listFonts,
  storeFont,
  themesUsingFont,
  deleteFont,
  MAX_FONT_BYTES,
} from '../../utils/fonts';
import { fontStack, uploadedFontFamily } from '@trackarr/shared/theme';

// Owner-uploaded font faces.
//
// The interesting parts are not "does a row round-trip". They are: that the
// format check looks at the bytes rather than the name, that the same file twice
// is one object, that a face uploaded for one role cannot be selected for
// another, and that deleting a face a theme still names is refused rather than
// silently changing how that theme looks.

/** A woff2 header, which is all `isWoff2` inspects. */
function woff2(payload = 'a'): Buffer {
  return Buffer.concat([Buffer.from('wOF2'), Buffer.from(payload)]);
}

async function makeTheme(tokens: Record<string, string>, name = 'A theme') {
  const id = randomUUID();
  await db.insert(schema.themes).values({
    id,
    slug: `t-${id.slice(0, 8)}`,
    name,
    base: 'dark',
    tokens,
  });
  return id;
}

describe('what counts as a font file', () => {
  it('reads the magic number, not the filename', () => {
    // A `.ttf` renamed to `.woff2` is the case this exists for.
    expect(isWoff2(woff2())).toBe(true);
    expect(isWoff2(Buffer.from('wOFF' + 'padding'))).toBe(false);
    expect(isWoff2(Buffer.from([0x00, 0x01, 0x00, 0x00, 0x01]))).toBe(false);
    expect(isWoff2(Buffer.from('OTTO' + 'padding'))).toBe(false);
    expect(isWoff2(Buffer.from('<!doctype html>'))).toBe(false);
  });

  it('refuses something too short to have a header', () => {
    expect(isWoff2(Buffer.from('wOF'))).toBe(false);
    expect(isWoff2(Buffer.alloc(0))).toBe(false);
    // Exactly the magic and nothing else is not a font either.
    expect(isWoff2(Buffer.from('wOF2'))).toBe(false);
  });

  it('has a cap low enough to matter', () => {
    // Every visitor using the theme downloads it, so this is a page-weight
    // decision rather than a storage one.
    expect(MAX_FONT_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
});

describe('storing', () => {
  it('is idempotent by content, whatever the name', async () => {
    const uid = await makeUser({});
    const a = await storeFont(woff2('same'), 'First Name', 'sans', uid);
    const b = await storeFont(woff2('same'), 'Second Name', 'mono', uid);

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    // The FIRST name and role win, and that is the point: two rows over one set
    // of bytes would mean deleting one breaks the other.
    expect(b.font.id).toBe(a.font.id);
    expect(b.font.family).toBe('First Name');
    expect(b.font.role).toBe('sans');
    expect(await listFonts()).toHaveLength(1);
  });

  it('keeps different bytes apart', async () => {
    const uid = await makeUser({});
    const a = await storeFont(woff2('one'), 'One', 'sans', uid);
    const b = await storeFont(woff2('two'), 'Two', 'sans', uid);
    expect(b.font.id).not.toBe(a.font.id);
    expect(await listFonts()).toHaveLength(2);
  });
});

describe('selecting one from a theme', () => {
  it('accepts a face uploaded for that role', async () => {
    const uid = await makeUser({});
    const { font } = await storeFont(woff2('sans'), 'Sans', 'sans', uid);
    expect(await uploadTokenProblems({ 'font-sans': `upload:${font.id}` })).toEqual([]);
  });

  it('refuses a face uploaded for a different role', async () => {
    // Not pedantry: two families at the same size differ by 10-20 % in advance
    // width, and a proportional face in a column of hashes is a broken table.
    const uid = await makeUser({});
    const { font } = await storeFont(woff2('display'), 'Display', 'display', uid);
    const problems = await uploadTokenProblems({ 'font-mono': `upload:${font.id}` });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no uploaded mono font/);
  });

  it('refuses an id that does not exist', async () => {
    const problems = await uploadTokenProblems({ 'font-sans': `upload:${randomUUID()}` });
    expect(problems[0]).toMatch(/no uploaded sans font/);
  });

  it('reports every bad role at once', async () => {
    // One round trip per problem is how an admin ends up fixing three fields in
    // three attempts.
    const problems = await uploadTokenProblems({
      'font-sans': `upload:${randomUUID()}`,
      'font-mono': `upload:${randomUUID()}`,
    });
    expect(problems.join(' ')).toMatch(/font-sans/);
    expect(problems.join(' ')).toMatch(/font-mono/);
  });

  it('ignores a curated key, which is not its business', async () => {
    expect(
      await uploadTokenProblems({ 'font-sans': 'manrope', 'font-mono': 'fira-code' }),
    ).toEqual([]);
  });
});

describe('what reaches CSS', () => {
  it('names the family after the id, not after anything a human typed', () => {
    // The family name in the stylesheet is generated by this application, so
    // nothing an owner types or a font file declares can become part of a
    // stylesheet.
    const id = randomUUID();
    const family = uploadedFontFamily(`upload:${id}`);
    expect(family).toBe(`ot-font-${id}`);
    expect(family).not.toMatch(/['";{}]/);
  });

  it('builds a stack that still ends in something already on the machine', () => {
    const id = randomUUID();
    const stack = fontStack(`upload:${id}`, 'font-mono');
    expect(stack).toContain(`'ot-font-${id}'`);
    expect(stack).toMatch(/monospace$/);
  });

  it('emits one @font-face per distinct face, and none for a curated key', () => {
    const a = randomUUID();
    const b = randomUUID();
    const css = fontFaceCss([
      { 'font-sans': `upload:${a}`, 'font-mono': 'jetbrains-mono' },
      // The same face again, from another theme: one rule, not two.
      { 'font-display': `upload:${a}` },
      { 'font-mono': `upload:${b}` },
    ]);
    expect((css.match(/@font-face/g) ?? []).length).toBe(2);
    expect(css).toContain(`/api/fonts/${a}`);
    expect(css).toContain(`/api/fonts/${b}`);
    expect(css).not.toContain('jetbrains-mono');
    expect(css).toContain('font-display: swap');
  });

  it('emits nothing when no theme names an uploaded face', () => {
    expect(fontFaceCss([{ 'font-sans': 'inter' }, {}])).toBe('');
  });
});

describe('deleting', () => {
  it('is refused while a theme still names the face', async () => {
    // There is no foreign key — a token is a string, deliberately — so this
    // lookup is the only thing that notices.
    const uid = await makeUser({});
    const { font } = await storeFont(woff2('used'), 'Used', 'sans', uid);
    await makeTheme({ 'font-sans': `upload:${font.id}` }, 'Uses The Font');

    expect(await themesUsingFont(font.id)).toEqual(['Uses The Font']);
  });

  it('is allowed once nothing names it', async () => {
    const uid = await makeUser({});
    const { font } = await storeFont(woff2('free'), 'Free', 'sans', uid);
    await makeTheme({ accent: '1 2 3' }, 'Unrelated');

    expect(await themesUsingFont(font.id)).toEqual([]);
    expect(await deleteFont(font.id)).toBe(true);
    expect(await listFonts()).toHaveLength(0);
    // And a second delete is not an error.
    expect(await deleteFont(font.id)).toBe(false);
  });

  it('does not confuse one role with another when checking use', async () => {
    const uid = await makeUser({});
    const { font } = await storeFont(woff2('mono'), 'Mono', 'mono', uid);
    // The token names the face under the DISPLAY role, which is not a role it
    // was uploaded for — but it is still a reference, and deleting the file
    // would still change that theme.
    await makeTheme({ 'font-display': `upload:${font.id}` }, 'Odd But Referenced');
    expect(await themesUsingFont(font.id)).toEqual(['Odd But Referenced']);
  });
});
