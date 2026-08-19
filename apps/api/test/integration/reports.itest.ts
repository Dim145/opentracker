import { describe, it, expect } from 'vitest';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeReport, makeUser } from './helpers';

// Retrait d'un signalement — la pierre tombale de la 0.26.
//
// La règle métier tient en une phrase à deux moitiés qui se contredisent en
// apparence : le signalement doit disparaître pour son auteur, et rester pour
// le staff. C'est précisément le genre d'invariant qu'un test protège mieux
// qu'un commentaire, parce qu'une future « simplification » consistant à
// filtrer au même endroit des deux côtés casserait exactement l'une des deux
// moitiés — et la moitié cassée serait invisible à l'usage courant.

/** Ce que voit le signaleur : tout sauf ses retraits. */
function reporterList(reporterId: string) {
  return db
    .select({ id: schema.reports.id, status: schema.reports.status })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.reporterId, reporterId),
        ne(schema.reports.status, 'withdrawn'),
      ),
    );
}

/** Le retrait, tel que l'endpoint l'exécute : UPDATE conditionné au statut. */
async function withdraw(id: string, reporterId: string): Promise<void> {
  await db
    .update(schema.reports)
    .set({ status: 'withdrawn', withdrawnAt: new Date() })
    .where(
      and(
        eq(schema.reports.id, id),
        eq(schema.reports.reporterId, reporterId),
        eq(schema.reports.status, 'pending'),
      ),
    );
}

describe('retrait — la ligne survit mais quitte la vue du signaleur', () => {
  it('disparaît de la liste de son auteur, sans être supprimée', async () => {
    const user = await makeUser();
    const id = await makeReport(user);

    expect(await reporterList(user)).toHaveLength(1);
    await withdraw(id, user);
    expect(await reporterList(user)).toHaveLength(0);

    // La preuve que ce n'est pas un DELETE : la ligne est toujours là.
    const [row] = await db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(row).toBeDefined();
    expect(row!.status).toBe('withdrawn');
    expect(row!.withdrawnAt).toBeInstanceOf(Date);
  });

  it('reste visible pour la modération', async () => {
    const user = await makeUser();
    const id = await makeReport(user);
    await withdraw(id, user);

    const vus = await db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.status, 'withdrawn'));
    expect(vus.map((r) => r.id)).toEqual([id]);
  });

  it('horodate le retrait, pour distinguer un retrait ancien d’un récent', async () => {
    const user = await makeUser();
    const id = await makeReport(user);
    const avant = Date.now();
    await withdraw(id, user);

    const [row] = await db
      .select({ at: schema.reports.withdrawnAt })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(row!.at!.getTime()).toBeGreaterThanOrEqual(avant - 1000);
  });
});

describe('retrait — garde-fous', () => {
  it('ne touche pas au signalement d’un autre membre', async () => {
    const auteur = await makeUser();
    const intrus = await makeUser();
    const id = await makeReport(auteur);

    await withdraw(id, intrus);

    const [row] = await db
      .select({ s: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(row!.s).toBe('pending');
  });

  it('ne retire pas un signalement déjà traité', async () => {
    // Un signalement accepté a déclenché une cascade — rejet du torrent,
    // notification de l'uploadeur — qu'on ne va pas défaire ici. Un
    // signalement rejeté est justement la trace qu'on veut garder.
    const user = await makeUser();
    for (const statut of ['resolved', 'dismissed'] as const) {
      const id = await makeReport(user, { status: statut });
      await withdraw(id, user);
      const [row] = await db
        .select({ s: schema.reports.status })
        .from(schema.reports)
        .where(eq(schema.reports.id, id));
      expect(row!.s).toBe(statut);
    }
  });

  it('deux retraits concurrents n’en appliquent qu’un', async () => {
    // L'UPDATE est conditionné à `status = 'pending'` précisément pour ça :
    // un modérateur qui traite pendant que l'auteur retire ne doit pas
    // pouvoir produire un état incohérent.
    const user = await makeUser();
    const id = await makeReport(user);

    await Promise.all([withdraw(id, user), withdraw(id, user)]);

    const rows = await db
      .select({ s: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.s).toBe('withdrawn');
  });

  it('un modérateur qui tranche pendant le retrait gagne ou perd, jamais les deux', async () => {
    const user = await makeUser();
    const id = await makeReport(user);

    await Promise.all([
      withdraw(id, user),
      db
        .update(schema.reports)
        .set({ status: 'dismissed', resolvedAt: new Date() })
        .where(
          and(eq(schema.reports.id, id), eq(schema.reports.status, 'pending')),
        ),
    ]);

    const [row] = await db
      .select({ s: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    // L'un des deux a gagné — peu importe lequel, l'important est qu'on ne
    // se retrouve pas dans un état intermédiaire.
    expect(['withdrawn', 'dismissed']).toContain(row!.s);
  });
});

describe('compteur de retraits par signaleur', () => {
  it('compte les retraits, un signaleur à la fois', async () => {
    // C'est la raison d'être de la pierre tombale : un retrait isolé ne dit
    // rien, une série en dit long.
    const serial = await makeUser();
    const honnete = await makeUser();

    for (let i = 0; i < 4; i++) {
      const id = await makeReport(serial);
      await withdraw(id, serial);
    }
    const unique = await makeReport(honnete);
    await withdraw(unique, honnete);
    await makeReport(honnete); // en attente, ne doit pas être compté

    const rows = await db
      .select({
        reporterId: schema.reports.reporterId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.reports)
      .where(
        and(
          inArray(schema.reports.reporterId, [serial, honnete]),
          eq(schema.reports.status, 'withdrawn'),
        ),
      )
      .groupBy(schema.reports.reporterId);

    const parAuteur = Object.fromEntries(
      rows.map((r) => [r.reporterId, r.count]),
    );
    expect(parAuteur[serial]).toBe(4);
    expect(parAuteur[honnete]).toBe(1);
  });

  it('ne compte pas les signalements traités comme des retraits', async () => {
    const user = await makeUser();
    await makeReport(user, { status: 'resolved' });
    await makeReport(user, { status: 'dismissed' });

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.reporterId, user),
          eq(schema.reports.status, 'withdrawn'),
        ),
      );
    expect(row!.count).toBe(0);
  });
});
