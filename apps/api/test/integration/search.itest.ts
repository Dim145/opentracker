import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db, schema, ftsVector } from '@trackarr/db';
import { toPrefixTsQuery, FTS_CONFIG } from '../../utils/search';
import { makeCategory } from './helpers';

// Recherche plein-texte, contre un vrai Postgres.
//
// Les helpers sont couverts en unitaire ; ce qui ne peut se vérifier qu'ici,
// c'est l'accord entre l'expression *indexée* et l'expression *interrogée*.
// Un index d'expression ne sert la requête que si les deux sont identiques :
// si elles divergent, rien ne casse — la recherche continue de rendre les
// bons résultats, en parcourant séquentiellement la table. Le défaut est donc
// invisible en test fonctionnel et ne se voit qu'au plan d'exécution. D'où le
// test qui lit `EXPLAIN`.

interface Row {
  name: string;
  description?: string | null;
  nfo?: string | null;
}

let categoryId: string;

async function seed(rows: Row[]): Promise<void> {
  await db.insert(schema.torrents).values(
    rows.map((r, i) => ({
      id: randomUUID(),
      infoHash: i.toString(16).padStart(40, '0'),
      name: r.name,
      size: 1_000_000 + i,
      description: r.description ?? null,
      nfo: r.nfo ?? null,
      categoryId,
      moderationStatus: 'accepted' as const,
    })),
  );
  await db.execute(sql`ANALYZE torrents`);
}

/** Reproduit le prédicat de la route pour les champs demandés. */
function searchCondition(term: string, fields: string[]): SQL {
  const tsq = toPrefixTsQuery(term)!;
  const q = sql`to_tsquery(${FTS_CONFIG}, ${tsq})`;
  const branches: SQL[] = [];
  if (fields.includes('name')) {
    branches.push(sql`${ftsVector(schema.torrents.name)} @@ ${q}`);
  }
  if (fields.includes('description')) {
    branches.push(sql`${ftsVector(schema.torrents.description)} @@ ${q}`);
  }
  if (fields.includes('nfo')) {
    branches.push(sql`${ftsVector(schema.torrents.nfo)} @@ ${q}`);
  }
  return branches.length > 1 ? or(...branches)! : branches[0]!;
}

async function find(term: string, fields: string[]): Promise<string[]> {
  const rows = await db
    .select({ name: schema.torrents.name })
    .from(schema.torrents)
    .where(searchCondition(term, fields));
  return rows.map((r) => r.name).sort();
}

beforeEach(async () => {
  categoryId = await makeCategory();
});

describe('recherche plein-texte — périmètre des champs', () => {
  beforeEach(async () => {
    await seed([
      { name: 'Crimson Vault 1994 1080p BluRay x264-NTb', description: 'Un thriller.' },
      { name: 'Northern Lights 2011 2160p WEB-DL x265', description: 'Contient crimson dans le texte.' },
      { name: 'Paper Lanterns 1983 720p HDTV', nfo: 'Encodeur : crimson-team. Piste VF.' },
    ]);
  });

  it('ne lit que les champs activés', async () => {
    // Le réglage n'est pas une pondération : un champ décoché n'est pas lu.
    expect(await find('crimson', ['name'])).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
    expect(await find('crimson', ['description'])).toEqual([
      'Northern Lights 2011 2160p WEB-DL x265',
    ]);
    expect(await find('crimson', ['nfo'])).toEqual([
      'Paper Lanterns 1983 720p HDTV',
    ]);
  });

  it('unit les champs activés sans doublonner une ligne qui matche deux fois', async () => {
    const found = await find('crimson', ['name', 'description', 'nfo']);
    expect(found).toHaveLength(3);
    expect(new Set(found).size).toBe(3);
  });

  it('trouve un mot présent uniquement dans la description', async () => {
    // C'est la régression que la 0.25 corrige : avant, la recherche ne
    // portait que sur le nom et ce mot était introuvable.
    expect(await find('crimson', ['name'])).not.toContain(
      'Northern Lights 2011 2160p WEB-DL x265',
    );
    expect(await find('crimson', ['name', 'description'])).toContain(
      'Northern Lights 2011 2160p WEB-DL x265',
    );
  });
});

describe('recherche plein-texte — comportement de la requête', () => {
  beforeEach(async () => {
    await seed([
      { name: 'Crimson Vault 1994 1080p BluRay x264-NTb' },
      { name: 'Crimson Tide 1995 1080p WEB-DL x264' },
      { name: 'Glass Cathedral 2003 720p HDTV XviD' },
      { name: 'Salt and Cedar 2019 2160p BluRay x265' },
    ]);
  });

  it('complète le dernier terme saisi', async () => {
    expect(await find('crim', ['name'])).toHaveLength(2);
    expect(await find('cathed', ['name'])).toEqual([
      'Glass Cathedral 2003 720p HDTV XviD',
    ]);
  });

  it('lie les termes par ET, pas par OU', async () => {
    // « crimson vault » ne doit pas ramener Crimson Tide.
    expect(await find('crimson vault', ['name'])).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
    expect(await find('crimson tide', ['name'])).toEqual([
      'Crimson Tide 1995 1080p WEB-DL x264',
    ]);
  });

  it('ignore la casse et la ponctuation du nom de release', async () => {
    expect(await find('CRIMSON.VAULT', ['name'])).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
    expect(await find('web dl', ['name'])).toEqual([
      'Crimson Tide 1995 1080p WEB-DL x264',
    ]);
  });

  it('ne casse pas sur une saisie contenant des opérateurs tsquery', async () => {
    // Sans le nettoyage côté helper, Postgres lèverait une erreur de syntaxe
    // et la route rendrait un 500 sur une simple parenthèse.
    for (const evil of ['crimson & (vault', 'crimson | vault', "crim'son", '!crimson']) {
      await expect(find(evil, ['name'])).resolves.toBeInstanceOf(Array);
    }
  });

  it('rend zéro résultat sur un terme absent, sans erreur', async () => {
    expect(await find('zorglubinette', ['name', 'description', 'nfo'])).toEqual([]);
  });
});

describe('accord index / requête', () => {
  it('le planificateur utilise bien l’index d’expression', async () => {
    // Le cœur du sujet. On insère assez de lignes pour que Postgres préfère
    // l'index à un parcours séquentiel, puis on lit le plan. Si l'expression
    // de `ftsVector()` cessait de correspondre à celle déclarée dans
    // `schema.ts`, la recherche resterait *fonctionnellement* correcte et ce
    // test serait le seul à s'en apercevoir.
    const rows: Row[] = [];
    for (let i = 0; i < 2000; i++) {
      rows.push({ name: `Filler Release ${i} 1080p BluRay x264-GRP` });
    }
    rows.push({ name: 'Crimson Vault 1994 1080p BluRay x264-NTb' });
    await seed(rows);

    const plan = await db.execute(
      sql`EXPLAIN SELECT id FROM torrents WHERE ${searchCondition('crimson', ['name'])}`,
    );
    const text = (plan as unknown as Array<Record<string, string>>)
      .map((r) => Object.values(r).join(' '))
      .join('\n');

    expect(text).toMatch(/torrents_fts_name_idx/);
    expect(text).not.toMatch(/Seq Scan/);
  });
});

describe('repli sur faute de frappe', () => {
  beforeEach(async () => {
    await seed([{ name: 'Crimson Vault 1994 1080p BluRay x264-NTb' }]);
  });

  it('le plein-texte seul ne rattrape pas la faute', async () => {
    expect(await find('crimsen', ['name'])).toEqual([]);
  });

  it('word_similarity la rattrape', async () => {
    // `word_similarity` et non `similarity` : sur un nom de release entier,
    // la similarité globale reste sous le seuil et ne trouve jamais rien.
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(sql`${'crimsen'} <% ${schema.torrents.name}`);
    expect(rows.map((r) => r.name)).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
  });

  it('similarity sur la chaîne entière, elle, ne trouve rien', async () => {
    // Le piège documenté : c'est ce qui avait été essayé en premier.
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(sql`${schema.torrents.name} % ${'crimsen'}`);
    expect(rows).toEqual([]);
  });
});

describe('les autres modes de recherche restent intacts', () => {
  it('l’infohash reste une égalité exacte servie par son index unique', async () => {
    await seed([{ name: 'Crimson Vault 1994' }, { name: 'Northern Lights 2011' }]);
    const hash = '0'.repeat(40);
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(eq(schema.torrents.infoHash, hash));
    expect(rows).toHaveLength(1);
  });

  it('un identifiant externe filtre sur sa colonne dédiée', async () => {
    await db.insert(schema.torrents).values({
      id: randomUUID(),
      infoHash: 'f'.repeat(40),
      name: 'Avec identifiant externe',
      size: 1,
      categoryId,
      imdbId: 'tt0111161',
      moderationStatus: 'accepted',
    });
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(and(eq(schema.torrents.imdbId, 'tt0111161')));
    expect(rows).toHaveLength(1);
    const none = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(eq(schema.torrents.imdbId, 'tt9999999'));
    expect(none).toEqual([]);
  });
});
