/**
 * The three decisions behind presentation templates: how many a user may
 * own, who may read one, and who may publish one.
 *
 * All pure on purpose. "Can a stranger read a private template" and "can
 * a non-staff user publish site-wide" are exactly the rules a later edit
 * inverts by accident, and a test that needs Postgres to catch that is a
 * test nobody runs.
 */
import { describe, it, expect } from 'vitest';
import {
  canWriteTemplate,
  clampTemplateQuota,
  resolveTemplateVisibility,
  templateQuotaMessage,
  TEMPLATE_QUOTA_DEFAULT,
  TEMPLATE_QUOTA_MAX,
  TEMPLATE_QUOTA_MIN,
} from '../utils/templatePolicy';

describe('clampTemplateQuota', () => {
  it('reads the number an operator stored', () => {
    expect(clampTemplateQuota('12')).toBe(12);
    expect(clampTemplateQuota(12)).toBe(12);
  });

  it('falls back to the default when the setting was never written', () => {
    // getSetting returns null for a missing row, '' for a blank one.
    expect(clampTemplateQuota(null)).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota(undefined)).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota('')).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota('   ')).toBe(TEMPLATE_QUOTA_DEFAULT);
  });

  it('falls back to the default on garbage rather than returning NaN', () => {
    // A NaN cap would compare false against every count and quietly let
    // an unlimited number of templates through.
    expect(clampTemplateQuota('lots')).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota({})).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota(Number.NaN)).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota(Infinity)).toBe(TEMPLATE_QUOTA_DEFAULT);
  });

  it('keeps the exact bounds usable', () => {
    expect(clampTemplateQuota(TEMPLATE_QUOTA_MIN)).toBe(TEMPLATE_QUOTA_MIN);
    expect(clampTemplateQuota(TEMPLATE_QUOTA_MAX)).toBe(TEMPLATE_QUOTA_MAX);
  });

  it('rejects out-of-range values instead of pinning them to a bound', () => {
    // 0 would lock every user out of creating anything and -1 would do it
    // silently; 9999 is a typo far more often than a real intent.
    expect(clampTemplateQuota(0)).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota(-1)).toBe(TEMPLATE_QUOTA_DEFAULT);
    expect(clampTemplateQuota(TEMPLATE_QUOTA_MAX + 1)).toBe(
      TEMPLATE_QUOTA_DEFAULT,
    );
  });

  it('truncates a fractional quota downwards', () => {
    expect(clampTemplateQuota(5.9)).toBe(5);
    // …and a fraction that floors below the minimum is out of range.
    expect(clampTemplateQuota(0.9)).toBe(TEMPLATE_QUOTA_DEFAULT);
  });
});

describe('templateQuotaMessage', () => {
  it('names the limit that was actually enforced', () => {
    expect(templateQuotaMessage(5)).toContain('5 templates');
  });

  it('does not say "1 templates"', () => {
    expect(templateQuotaMessage(1)).toContain('1 template ');
  });
});

describe('canWriteTemplate', () => {
  const me = { id: 'me', isStaff: false };
  const meStaff = { id: 'me', isStaff: true };

  it('is owner-only on a private draft, staff or not', () => {
    expect(canWriteTemplate({ ownerId: 'me', visibility: 'private' }, me)).toBe(true);
    expect(canWriteTemplate({ ownerId: 'them', visibility: 'private' }, me)).toBe(false);
    // Staff get no read or write bypass on somebody's draft: there is no
    // moderation case for it, and the publish action works on your own rows.
    expect(canWriteTemplate({ ownerId: 'them', visibility: 'private' }, meStaff)).toBe(
      false,
    );
  });

  it('requires a live staff role to write a published template, even your own', () => {
    // The demotion hole this closes: publish while staff, lose the role,
    // keep rewriting what the whole site renders.
    expect(canWriteTemplate({ ownerId: 'me', visibility: 'published' }, me)).toBe(false);
    expect(canWriteTemplate({ ownerId: 'me', visibility: 'published' }, meStaff)).toBe(
      true,
    );
  });

  it('lets staff take down a published template they do not own', () => {
    // Without this a published template whose author went inactive had no
    // removal path at all.
    expect(canWriteTemplate({ ownerId: 'them', visibility: 'published' }, meStaff)).toBe(
      true,
    );
  });

  it('refuses an anonymous caller whatever the row', () => {
    const anon = { id: null, isStaff: false };
    const anonStaff = { id: null, isStaff: true };
    expect(canWriteTemplate({ ownerId: 'them', visibility: 'private' }, anon)).toBe(false);
    // isStaff without an id is nonsense, but the guard must not be reachable.
    expect(canWriteTemplate({ ownerId: 'them', visibility: 'published' }, anonStaff)).toBe(
      false,
    );
  });

  it('treats an unrecognised visibility as private', () => {
    // The column is plain text; a hand-edited row must fail closed.
    expect(canWriteTemplate({ ownerId: 'them', visibility: 'draft' }, meStaff)).toBe(
      false,
    );
    expect(canWriteTemplate({ ownerId: 'me', visibility: 'draft' }, me)).toBe(true);
  });
});

describe('resolveTemplateVisibility', () => {
  it('leaves the current value alone when the field is absent', () => {
    // A rename must not unpublish anything.
    const d = resolveTemplateVisibility({
      current: 'published',
      isStaff: false,
    });
    expect(d).toEqual({ ok: true, visibility: 'published' });
  });

  it('lets a non-staff user restate the value they already have', () => {
    const d = resolveTemplateVisibility({
      requested: 'private',
      current: 'private',
      isStaff: false,
    });
    expect(d).toEqual({ ok: true, visibility: 'private' });
  });

  it('refuses a non-staff user publishing site-wide', () => {
    const d = resolveTemplateVisibility({
      requested: 'published',
      current: 'private',
      isStaff: false,
    });
    expect(d.ok).toBe(false);
    // The message is shown verbatim by the FE, so it has to name the rule.
    expect(d.ok === false && d.message).toContain('staff');
  });

  it('refuses a non-staff user unpublishing too', () => {
    // Retracting a template the site relies on is as disruptive as
    // publishing an unvetted one.
    const d = resolveTemplateVisibility({
      requested: 'private',
      current: 'published',
      isStaff: false,
    });
    expect(d.ok).toBe(false);
  });

  it('lets staff move it in both directions', () => {
    expect(
      resolveTemplateVisibility({
        requested: 'published',
        current: 'private',
        isStaff: true,
      }),
    ).toEqual({ ok: true, visibility: 'published' });
    expect(
      resolveTemplateVisibility({
        requested: 'private',
        current: 'published',
        isStaff: true,
      }),
    ).toEqual({ ok: true, visibility: 'private' });
  });
});
