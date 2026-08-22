/**
 * The quota behind presentation templates: how many a member may own, and
 * what the refusal tells them.
 *
 * Pure on purpose. A cap read from a hand-editable settings row is exactly
 * the kind of value a later edit turns into NaN or a negative number, and a
 * test that needs Postgres to catch that is a test nobody runs.
 *
 * The visibility suites that used to sit below (`canWriteTemplate`,
 * `resolveTemplateVisibility`) are gone with the functions: members cannot
 * make a template site-wide at all now, and the site catalogue is written by
 * /api/admin/templates behind `requireAdminSession`, which is a route guard
 * rather than a decision to unit-test.
 */
import { describe, it, expect } from 'vitest';
import {
  clampTemplateQuota,
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
