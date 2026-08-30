import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every notification the API can send has a label in the bell.
 *
 * There are two dictionaries and it is easy to fill only one: the API's
 * `notifyRenderer` is what email and push read, while the bell renders
 * client-side from `notifications.types.<type>` in the locale files. A
 * type present in the first and missing from the second does not throw —
 * vue-i18n renders the key path, so the member sees
 * `notifications.types.ticket_answered.title` in their notification list
 * and nothing anywhere reports a problem.
 *
 * That is exactly what happened when the ticket desk shipped: four new
 * types, one dictionary. This test is the detector.
 */
const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

/** The union in `apps/api/utils/notify.ts`, parsed rather than duplicated. */
function declaredTypes(): string[] {
  const src = read('../api/utils/notify.ts');
  const start = src.indexOf('export type NotificationType =');
  expect(start).toBeGreaterThan(-1);
  const out: string[] = [];
  for (const line of src.slice(start).split('\n').slice(1)) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    const m = /^\|\s*'([a-z_]+)'/.exec(t);
    if (!m) break;
    out.push(m[1]!);
  }
  return out;
}

const locales = ['fr', 'en'] as const;

describe('notification labels', () => {
  const types = declaredTypes();

  it('finds the union at all', () => {
    // A parser that silently matches nothing would make every assertion
    // below vacuously true.
    expect(types.length).toBeGreaterThan(40);
    expect(types).toContain('message_received');
  });

  for (const loc of locales) {
    const dict = JSON.parse(read(`i18n/locales/${loc}.json`)) as {
      notifications: { types: Record<string, { title?: string; desc?: string }> };
    };

    it(`${loc}: every type the API sends can be drawn`, () => {
      const missing = types.filter((t) => !dict.notifications.types[t]);
      expect(missing).toEqual([]);
    });

    it(`${loc}: every label has a title`, () => {
      const untitled = Object.entries(dict.notifications.types)
        .filter(([, v]) => !v?.title)
        .map(([k]) => k);
      expect(untitled).toEqual([]);
    });

    it(`${loc}: no label for a type that no longer exists`, () => {
      const orphans = Object.keys(dict.notifications.types).filter(
        (k) => !types.includes(k)
      );
      expect(orphans).toEqual([]);
    });
  }

  it('both locales carry the same set', () => {
    const [fr, en] = locales.map(
      (l) =>
        new Set(
          Object.keys(
            (JSON.parse(read(`i18n/locales/${l}.json`)) as {
              notifications: { types: Record<string, unknown> };
            }).notifications.types
          )
        )
    );
    expect([...fr!].filter((k) => !en!.has(k))).toEqual([]);
    expect([...en!].filter((k) => !fr!.has(k))).toEqual([]);
  });
});
