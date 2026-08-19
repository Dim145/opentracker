import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  POOL_CONFIG_ID,
  contribute,
  getConfig,
  getCurrentCycle,
  getUserContribution,
  getTopContributors,
  FreeleechPoolError,
} from '../../utils/freeleechPool';
import { getBonus, makeUser } from './helpers';

// Pool de freeleech — le pot commun.
//
// Chaque contribution est un débit réel du solde d'un membre, et la cagnotte
// est partagée : deux invariants s'y opposent en permanence. D'un côté, une
// contribution ne doit jamais créditer le pot sans débiter l'auteur (ni
// l'inverse). De l'autre, le plafond par personne doit tenir même quand
// plusieurs contributions arrivent en même temps — c'est justement le
// scénario où un contrôle lu-puis-écrit laisse passer.
//
// `contribute` prend un verrou consultatif sur le pot avant d'écrire ; ces
// tests figent ce que ce verrou garantit.

const CIBLE = 1000;

async function setConfig(over: Record<string, unknown> = {}): Promise<void> {
  await db
    .insert(schema.freeleechPoolConfig)
    .values({
      id: POOL_CONFIG_ID,
      enabled: true,
      pointsTarget: CIBLE,
      contributionMin: 10,
      ...over,
    })
    .onConflictDoUpdate({
      target: schema.freeleechPoolConfig.id,
      set: { enabled: true, pointsTarget: CIBLE, contributionMin: 10, ...over },
    });
}

async function potCourant(): Promise<number> {
  const cycle = await getCurrentCycle();
  return cycle?.totalContributed ?? 0;
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE freeleech_pool_windows, freeleech_pool_config RESTART IDENTITY CASCADE`,
  );
  await setConfig();
});

describe('contribute — le pot et le solde bougent ensemble', () => {
  it('débite l’auteur et crédite le pot du même montant', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await contribute(user, 100);

    expect(await getBonus(user)).toBe(400);
    expect(await potCourant()).toBe(100);
    expect(await getUserContribution((await getCurrentCycle())!.id, user)).toBe(100);
  });

  it('cumule les contributions successives du même membre', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await contribute(user, 50);
    await contribute(user, 30);

    expect(await getBonus(user)).toBe(420);
    expect(await potCourant()).toBe(80);
    expect(await getUserContribution((await getCurrentCycle())!.id, user)).toBe(80);
  });

  it('additionne les contributions de plusieurs membres', async () => {
    const a = await makeUser({ bonusPoints: 500 });
    const b = await makeUser({ bonusPoints: 500 });
    await contribute(a, 100);
    await contribute(b, 250);

    expect(await potCourant()).toBe(350);
    expect(await getBonus(a)).toBe(400);
    expect(await getBonus(b)).toBe(250);
  });

  it('refuse de mettre un solde à découvert, et ne touche à rien', async () => {
    const user = await makeUser({ bonusPoints: 40 });
    await expect(contribute(user, 100)).rejects.toThrow();

    expect(await getBonus(user)).toBe(40);
    expect(await potCourant()).toBe(0);
  });
});

describe('contribute — garde-fous d’entrée', () => {
  it('refuse un montant non entier, nul ou négatif', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    for (const bad of [0, -10, 1.5, Number.NaN]) {
      await expect(contribute(user, bad)).rejects.toBeInstanceOf(FreeleechPoolError);
    }
    expect(await getBonus(user)).toBe(500);
  });

  it('refuse en dessous du minimum configuré', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await expect(contribute(user, 9)).rejects.toThrow(/[Mm]inimum/);
    await expect(contribute(user, 10)).resolves.toBeDefined();
  });

  it('refuse quand le pot est désactivé', async () => {
    await setConfig({ enabled: false });
    const user = await makeUser({ bonusPoints: 500 });
    await expect(contribute(user, 100)).rejects.toThrow(/disabled/i);
  });

  it('refuse quand aucune cible n’est configurée', async () => {
    await setConfig({ pointsTarget: 0 });
    const user = await makeUser({ bonusPoints: 500 });
    await expect(contribute(user, 100)).rejects.toThrow(/target/i);
  });
});

describe('contribute — concurrence', () => {
  it('n’encaisse pas plus que le solde sous contributions simultanées', async () => {
    // Le cas qui compte : dix requêtes de 100 sur un solde de 250. Sans le
    // verrou, plusieurs liraient le même solde et le pot recevrait plus que
    // ce que le membre possède — de la monnaie créée à partir de rien.
    const user = await makeUser({ bonusPoints: 250 });
    const essais = await Promise.allSettled(
      Array.from({ length: 10 }, () => contribute(user, 100)),
    );

    const reussies = essais.filter((r) => r.status === 'fulfilled').length;
    expect(reussies).toBe(2); // 250 ne finance que deux fois 100
    expect(await getBonus(user)).toBe(50);
    expect(await potCourant()).toBe(200);
  });

  it('le pot reste égal à la somme des contributions enregistrées', async () => {
    // Invariant de cohérence : le compteur dénormalisé du cycle ne doit
    // jamais diverger du détail, même après une rafale.
    const membres = await Promise.all(
      Array.from({ length: 6 }, () => makeUser({ bonusPoints: 500 })),
    );
    await Promise.allSettled(membres.map((m) => contribute(m, 50)));

    const cycle = await getCurrentCycle();
    const [somme] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)::int` })
      .from(schema.freeleechPoolContributions)
      .where(eq(schema.freeleechPoolContributions.cycleId, cycle!.id));

    expect(cycle!.totalContributed).toBe(somme!.total);
  });
});

describe('plafond par personne', () => {
  it('empêche une seule personne de porter tout le pot', async () => {
    // `maxPerUserBp` est en points de base : 2500 = 25 % de la cible.
    await setConfig({ maxPerUserBp: 2500 });
    const user = await makeUser({ bonusPoints: 5000 });

    await contribute(user, 250); // pile le plafond
    await expect(contribute(user, 10)).rejects.toThrow();

    expect(await getUserContribution((await getCurrentCycle())!.id, user)).toBe(250);
  });

  it('tient sous contributions simultanées', async () => {
    await setConfig({ maxPerUserBp: 2500 });
    const user = await makeUser({ bonusPoints: 5000 });

    await Promise.allSettled(
      Array.from({ length: 8 }, () => contribute(user, 100)),
    );

    const total = await getUserContribution((await getCurrentCycle())!.id, user);
    expect(total).toBeLessThanOrEqual(250);
  });
});

describe('tableau des contributeurs', () => {
  it('classe par montant décroissant', async () => {
    const petit = await makeUser({ bonusPoints: 500 });
    const gros = await makeUser({ bonusPoints: 500 });
    const moyen = await makeUser({ bonusPoints: 500 });
    await contribute(petit, 20);
    await contribute(gros, 200);
    await contribute(moyen, 80);

    const cycle = await getCurrentCycle();
    const top = await getTopContributors(cycle!.id, 10);
    expect(top.map((t) => t.total)).toEqual([200, 80, 20]);
  });

  it('agrège les contributions multiples d’une même personne en une ligne', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await contribute(user, 40);
    await contribute(user, 60);

    const cycle = await getCurrentCycle();
    const top = await getTopContributors(cycle!.id, 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.total).toBe(100);
  });
});

describe('configuration', () => {
  it('crée une configuration par défaut plutôt que d’échouer', async () => {
    await db.execute(sql`TRUNCATE TABLE freeleech_pool_config CASCADE`);
    const cfg = await getConfig();
    expect(cfg.id).toBe(POOL_CONFIG_ID);
    expect(typeof cfg.pointsTarget).toBe('number');
  });
});
