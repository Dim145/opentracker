import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

type UserInsert = typeof schema.users.$inferInsert;
type RequestInsert = typeof schema.uploadRequests.$inferInsert;

/** Insert a minimal valid user; override any column (e.g. bonusPoints). */
export async function makeUser(over: Partial<UserInsert> = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    username: `u_${id.slice(0, 8)}`,
    authSalt: 'x'.repeat(40),
    authVerifier: 'y'.repeat(40),
    passkey: id.replace(/-/g, ''),
    ...over,
  });
  return id;
}

export async function getBonus(userId: string): Promise<number> {
  const [row] = await db
    .select({ b: schema.users.bonusPoints })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return row!.b;
}

export async function makeCategory(): Promise<string> {
  const id = randomUUID();
  await db
    .insert(schema.categories)
    .values({ id, name: 'Movies', slug: `s_${id.slice(0, 8)}` });
  return id;
}

/** An unused invitation owned by `createdBy`. Returns its id. */
export async function makeInvitation(createdBy: string): Promise<string> {
  const id = randomUUID();
  await db
    .insert(schema.invitations)
    .values({ id, code: id.replace(/-/g, '').slice(0, 32), createdBy });
  return id;
}

export async function makeRequest(
  requesterId: string,
  categoryId: string,
  over: Partial<RequestInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.uploadRequests).values({
    id,
    requesterId,
    categoryId,
    title: 'Need this release',
    description: 'please upload it',
    rewardPoints: 100,
    status: 'requested',
    ...over,
  });
  return id;
}
