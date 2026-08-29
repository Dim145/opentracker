/**
 * Filtering for the admin section list.
 *
 * This lives outside AdminNavTree.vue so it can be tested. The accent folding
 * and the label-before-description ordering are the two things here that break
 * silently — neither shows up in a screenshot, and both only bite the person
 * who is already lost enough to be typing in the filter box.
 */

export interface NavFilterItem {
  label: string;
  description?: string;
}

/**
 * Case- and accent-blind. Someone typing "economie" has to reach "Économie":
 * the French labels carry diacritics that nobody puts in a filter box.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Label hits first, then the entries that only matched on their description —
 * so what you typed shows up at the top, while "ban" still finds Banned IPs
 * through its description when you cannot recall the section's name.
 *
 * An empty query returns nothing rather than everything: the caller shows the
 * grouped tree in that case, and a stray space should not flatten the menu.
 */
export function filterNavItems<T extends NavFilterItem>(
  items: T[],
  query: string
): T[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return [];

  const byLabel: T[] = [];
  const byDescription: T[] = [];
  for (const item of items) {
    if (foldForSearch(item.label).includes(needle)) byLabel.push(item);
    else if (foldForSearch(item.description ?? '').includes(needle)) {
      byDescription.push(item);
    }
  }
  return [...byLabel, ...byDescription];
}
