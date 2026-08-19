import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { creditPoints, creditDailyLoginIfDue } from '../../utils/bonusEarning';
import { redis } from '../../redis/client';
import { getBonus, makeUser } from './helpers';

// Crédit de points bonus, contre un vrai Postgres.
//
// C'est de la monnaie : les points s'échangent en boutique, financent le pool
// de freeleech et servent de mise sur le tableau de primes. Deux invariants
// comptent plus que le reste, et aucun des deux ne se vérifie sans base.
//
//   * le solde et le ledger ne peuvent pas diverger — ils sont écrits dans la
//     même transaction, donc un échec partiel doit tout annuler ;
//   * le crédit quotidien ne peut pas être réclamé deux fois le même jour,
//     même par deux requêtes simultanées.
//
// Le second est le seul qui ait déjà été exploité ailleurs : un double-clic
// suffit à le déclencher si la garde n'est pas atomique.

async function grantCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bonusGrants)
    .where(eq(schema.bonusGrants.userId, userId));
  return row!.n;
}

describe('creditPoints — solde et ledger avancent ensemble', () => {
  it('crédite le solde et inscrit une ligne au ledger', async () => {
    const user = await makeUser({ bonusPoints: 0 });
    await creditPoints({ userId: user, source: 'seeding', amount: 42 });

    expect(await getBonus(user)).toBe(42);
    expect(await grantCount(user)).toBe(1);

    const [grant] = await db
      .select()
      .from(schema.bonusGrants)
      .where(eq(schema.bonusGrants.userId, user));
    expect(grant!.amount).toBe(42);
    expect(grant!.source).toBe('seeding');
  });

  it('cumule sans écraser', async () => {
    const user = await makeUser({ bonusPoints: 10 });
    await creditPoints({ userId: user, source: 'seeding', amount: 5 });
    await creditPoints({ userId: user, source: 'first_seeder', amount: 25 });

    expect(await getBonus(user)).toBe(40);
    expect(await grantCount(user)).toBe(2);
  });

  it('ignore un montant nul ou négatif sans rien écrire', async () => {
    // Un crédit négatif serait un débit déguisé, hors de tout garde-fou de
    // solde ; le refuser en amont vaut mieux que de le rattraper après.
    const user = await makeUser({ bonusPoints: 100 });
    await creditPoints({ userId: user, source: 'seeding', amount: 0 });
    await creditPoints({ userId: user, source: 'seeding', amount: -50 });

    expect(await getBonus(user)).toBe(100);
    expect(await grantCount(user)).toBe(0);
  });

  it('n’écrit ni solde ni ledger quand l’utilisateur n’existe pas', async () => {
    // L'UPDATE ne touche aucune ligne ; l'INSERT du ledger doit alors
    // échouer sur la clé étrangère et annuler la transaction entière.
    // Sans transaction, on se retrouverait avec un ledger orphelin.
    const avant = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bonusGrants);
    await expect(
      creditPoints({
        userId: '00000000-0000-0000-0000-000000000000',
        source: 'seeding',
        amount: 10,
      }),
    ).rejects.toThrow();
    const apres = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bonusGrants);
    expect(apres[0]!.n).toBe(avant[0]!.n);
  });

  it('supporte des crédits concurrents sans en perdre', async () => {
    // `bonus_points = bonus_points + x` est atomique côté Postgres ; le test
    // fige ce choix, car un passage à un lire-puis-écrire côté application
    // perdrait des crédits sous charge et ce serait indétectable à l'œil.
    const user = await makeUser({ bonusPoints: 0 });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        creditPoints({ userId: user, source: 'seeding', amount: 3 }),
      ),
    );
    expect(await getBonus(user)).toBe(60);
    expect(await grantCount(user)).toBe(20);
  });
});

describe('creditDailyLoginIfDue — une fois par jour, pas deux', () => {
  const RECOMPENSE = 5;

  beforeEach(async () => {
    // La règle vit en base et n'est amorcée qu'au premier démarrage de l'API ;
    // le TRUNCATE de `setup.ts` ne la recrée pas, donc on la pose ici.
    await db
      .insert(schema.bonusRules)
      .values({
        id: randomUUID(),
        kind: 'daily_login',
        enabled: true,
        config: { reward: RECOMPENSE },
      })
      .onConflictDoNothing();
    // La garde d'idempotence est une clé Redis à TTL de 36 h : sans purge,
    // le deuxième test de la journée hériterait de la clé du premier.
    const keys = await redis.keys('bonus:dailyLogin:*');
    if (keys.length) await redis.del(...keys);
  });
  it('crédite au premier appel', async () => {
    const user = await makeUser({ bonusPoints: 0 });
    const credite = await creditDailyLoginIfDue(user);
    expect(credite).toBeGreaterThan(0);
    expect(await getBonus(user)).toBe(credite);
  });

  it('ne recrédite pas au deuxième appel du même jour', async () => {
    const user = await makeUser({ bonusPoints: 0 });
    const premier = await creditDailyLoginIfDue(user);
    const second = await creditDailyLoginIfDue(user);

    expect(second).toBe(0);
    expect(await getBonus(user)).toBe(premier);
  });

  it('résiste à deux réclamations simultanées', async () => {
    // Le cas du double-clic, ou de deux onglets. Si la garde n'était qu'un
    // SELECT suivi d'un INSERT, les deux passeraient.
    const user = await makeUser({ bonusPoints: 0 });
    const [a, b] = await Promise.all([
      creditDailyLoginIfDue(user),
      creditDailyLoginIfDue(user),
    ]);

    // Exactement un des deux crédite.
    expect([a, b].filter((n) => n > 0)).toHaveLength(1);
    expect(await getBonus(user)).toBe(Math.max(a, b));
    expect(await grantCount(user)).toBe(1);
  });

  it('ne mélange pas les comptes', async () => {
    const a = await makeUser({ bonusPoints: 0 });
    const b = await makeUser({ bonusPoints: 0 });
    await creditDailyLoginIfDue(a);
    expect(await getBonus(b)).toBe(0);
    expect(await grantCount(b)).toBe(0);
  });
});
