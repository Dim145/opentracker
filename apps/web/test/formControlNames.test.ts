import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

/*
 * Tout contrôle de formulaire doit porter un nom accessible.
 *
 * Sans nom, un lecteur d'écran annonce « saisie de texte » ou « liste » et
 * s'arrête là : le champ existe, mais rien ne dit ce qu'il attend. C'est le
 * critère WCAG 4.1.2, et c'est aussi la panne la plus banale d'un formulaire
 * — le motif dominant du dépôt était `<label class="…">Texte</label>` suivi
 * d'un `<input>`, sans `for` ni imbrication, ce qui fait du `<label>` un
 * paragraphe stylé.
 *
 * Textuel, comme `sfcImports.test.ts` et `printStylesheet.test.ts`, parce que
 * c'est ce qui marche sans compilateur Vue dans l'environnement de test.
 *
 * # Ce que la spéc appelle un nom
 *
 * Pour un `input`/`select`/`textarea`, HTML-AAM retient dans l'ordre :
 * `aria-labelledby`, `aria-label`, un `<label>` associé (par `for`/`id` ou par
 * imbrication), puis `title`, puis `placeholder`. D'où deux rangs :
 *
 *   A — AUCUN de ces mécanismes. Échec net. Le test exige zéro.
 *   B — nommé seulement par `title` ou `placeholder`. Techniquement conforme,
 *       pratiquement fragile : le placeholder disparaît à la première frappe.
 *       Un cliquet, pour que le chiffre ne puisse que baisser.
 *
 * # Trois classes de faux positifs, apprises en construisant ce détecteur
 *
 * Le premier comptage grossier annonçait ~300 contrôles anonymes. Le chiffre
 * réel était 24. Ce qui séparait les deux :
 *
 *   1. `SettingsGroup` rend lui-même un vrai `<label :for="controlId">`. Les
 *      17 champs de réglages qui l'utilisent ont donc bien un libellé — dans
 *      UN AUTRE FICHIER. D'où la prise en compte de `:control-id`.
 *   2. Un commentaire HTML qui PARLE d'un `<select>` n'est pas un select. Les
 *      commentaires sont blanchis avant analyse.
 *   3. Un `<input type="file" class="hidden">` piloté par un bouton visible
 *      est en `display:none` : ni le clavier ni le lecteur d'écran ne
 *      l'atteignent, il n'a pas de nom à porter. `hidden md:block` ne compte
 *      pas — là il est visible quelque part.
 */

const WEB = fileURLToPath(new URL('../app', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.vue') ? [p] : [];
  });
}

interface Finding {
  where: string;
  tag: string;
  type: string;
}

/** Les attributs d'une balise, noms en minuscules. */
function attrsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(
    /([:@]?[\w.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g,
  )) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function scan(file: string): { a: Finding[]; b: Finding[] } {
  const src = readFileSync(file, 'utf8');
  const tplMatch = /<template[^>]*>([\s\S]*)<\/template>/.exec(src);
  const a: Finding[] = [];
  const b: Finding[] = [];
  if (!tplMatch) return { a, b };

  const lineOffset = src.slice(0, tplMatch.index! + tplMatch[0].indexOf('>') + 1).split('\n')
    .length - 1;
  // Blanchis, pas supprimés : les numéros de ligne doivent rester justes.
  const tpl = tplMatch[1]!.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));

  const targets = new Set<string>();
  for (const m of tpl.matchAll(/<label\b[^>]*?\s:?for\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    targets.add(m[1] ?? m[2] ?? '');
  }
  for (const m of tpl.matchAll(/:control-id\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    targets.add(m[1] ?? m[2] ?? '');
  }
  const wrappers = [...tpl.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].map(
    (m) => [m.index!, m.index! + m[0].length] as const,
  );

  for (const m of tpl.matchAll(
    /<(input|select|textarea)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g,
  )) {
    const tag = m[1]!.toLowerCase();
    const at = attrsOf(m[2] ?? '');
    const type = (at.type ?? '').trim();
    if (tag === 'input' && type === 'hidden') continue;
    if (
      tag === 'input' &&
      ['submit', 'button', 'reset'].includes(type) &&
      (at.value !== undefined || at[':value'] !== undefined)
    ) {
      continue;
    }
    const toks = `${at.class ?? ''} ${at[':class'] ?? ''}`.split(/\s+/);
    const shownSomewhere = toks.some(
      (t) =>
        t.includes(':') &&
        ['block', 'flex', 'inline', 'inline-block', 'grid'].includes(t.split(':').pop()!),
    );
    if (toks.includes('hidden') && !shownSomewhere) continue;

    const ident = at.id ?? at[':id'];
    const strong =
      'aria-label' in at ||
      ':aria-label' in at ||
      'aria-labelledby' in at ||
      ':aria-labelledby' in at ||
      (ident !== undefined && targets.has(ident)) ||
      wrappers.some(([s, e]) => m.index! >= s && m.index! < e);

    if (strong) continue;
    const line = lineOffset + tpl.slice(0, m.index!).split('\n').length;
    const f = { where: `${relative(ROOT, file)}:${line}`, tag, type };
    const weak =
      'title' in at || ':title' in at || 'placeholder' in at || ':placeholder' in at;
    (weak ? b : a).push(f);
  }
  return { a, b };
}

const all = walk(WEB).map(scan);
const tierA = all.flatMap((r) => r.a);
const tierB = all.flatMap((r) => r.b);

describe('nom accessible des contrôles de formulaire', () => {
  it('aucun contrôle sans nom accessible', () => {
    const detail = tierA
      .map((f) => `  ${f.where}  <${f.tag}${f.type ? ` type=${f.type}` : ''}>`)
      .join('\n');
    expect(
      tierA.length,
      tierA.length
        ? `Contrôles sans nom accessible :\n${detail}\n\n` +
            'Ajoute un `aria-label`, un `aria-labelledby`, ou associe un `<label>` ' +
            "au champ (`useFieldIds()` donne des identifiants stables entre le rendu " +
            'serveur et l’hydratation ; `SettingsGroup` accepte un `control-id`).'
        : undefined,
    ).toBe(0);
  });

  it('les contrôles nommés seulement par placeholder/title ne se multiplient pas', () => {
    /*
     * Un cliquet, pas une exigence. Un `placeholder` seul EST un nom au sens
     * de la spéc, mais il s'efface dès la première frappe — quelqu'un qui
     * revient sur un champ à moitié rempli n'a plus rien pour savoir ce qu'il
     * y met. Convertir les 56 restants est un chantier ; empêcher le 57e est
     * gratuit.
     */
    expect(tierB.length).toBeLessThanOrEqual(56);
  });
});
