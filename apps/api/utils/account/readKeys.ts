/**
 * The two read keys — minting, rotating, and resolving a caller from one.
 *
 * ## What each is for
 *
 * | key | authenticates | can announce |
 * | --- | --- | --- |
 * | `passkey` | the tracker's announce and scrape | **yes** |
 * | `rssKey` | RSS feeds, the Torznab endpoint | no |
 * | `apiKey` | programmatic calls | no |
 *
 * One secret used to do all three. A member who pasted their feed URL into a
 * third-party service was handing over the credential that announces for them,
 * and the only remedy — rotating the passkey — broke every torrent in their
 * client at once. The whole point of the split is that revoking the key you
 * gave away costs you nothing else.
 *
 * ## Minted on demand
 *
 * Registration does not create them. A member who never wires up a feed reader
 * should not be carrying two live secrets they have never seen, and a column
 * that is null until someone asks is a column an attacker cannot use.
 * `ensureKey` mints on first read and is safe to call repeatedly.
 *
 * ## 40 hex, like `generatePasskey`
 *
 * The codebase already has three generators producing 32, 40 and 32 characters,
 * which is why the Torznab gate accepts "32 or 40". New keys use one length so
 * the next gate can be exact.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { generatePasskey } from '~~/utils/auth';

export type ReadKeyKind = 'rss' | 'api';

const COLUMN = {
  rss: schema.users.rssKey,
  api: schema.users.apiKey,
} as const;

/** `^[a-f0-9]{40}$` — what `generatePasskey` produces, lowercased. */
export const READ_KEY_PATTERN = /^[a-f0-9]{40}$/;

export function isReadKeyShaped(value: string): boolean {
  return READ_KEY_PATTERN.test(value.toLowerCase());
}

/**
 * The member's key, minting one if they have none yet.
 *
 * The write is guarded on the column still being null, so two concurrent first
 * reads cannot end with one of them holding a key the row no longer carries.
 * The loser re-reads and returns what actually landed.
 */
export async function ensureKey(
  userId: string,
  kind: ReadKeyKind
): Promise<string> {
  const column = COLUMN[kind];

  const [existing] = await db
    .select({ value: column })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (existing?.value) return existing.value;

  const minted = generatePasskey();
  const [claimed] = await db
    .update(schema.users)
    .set({ [kind === 'rss' ? 'rssKey' : 'apiKey']: minted })
    // The guard this function's docstring always described and did not have.
    // Without it two concurrent first reads — a double click on the reveal
    // button is enough — both minted, the last write won the row, and each
    // request returned ITS OWN value: one member walked away with a key the row
    // does not carry, and a 401 with no explanation.
    .where(and(eq(schema.users.id, userId), isNull(column)))
    .returning({ value: column });
  if (claimed?.value) return claimed.value;

  // We lost the race: read what actually landed rather than returning the value
  // we minted and threw away.
  const [settled] = await db
    .select({ value: column })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return settled?.value ?? minted;
}

/**
 * Replace a key. Whatever the member handed out stops working immediately —
 * there is no cache in front of these, by design.
 */
export async function rotateKey(
  userId: string,
  kind: ReadKeyKind
): Promise<string> {
  const minted = generatePasskey();
  await db
    .update(schema.users)
    .set({ [kind === 'rss' ? 'rssKey' : 'apiKey']: minted })
    .where(eq(schema.users.id, userId));
  return minted;
}

/** Drop a key without minting a replacement. */
export async function revokeKey(
  userId: string,
  kind: ReadKeyKind
): Promise<void> {
  await db
    .update(schema.users)
    .set({ [kind === 'rss' ? 'rssKey' : 'apiKey']: null })
    .where(eq(schema.users.id, userId));
}

/**
 * The columns every read-key holder lookup wants. Shared so the three call
 * sites project the same fields — a caller resolved by RSS key and one
 * resolved by passkey must be the same shape or the routes downstream start
 * branching on how somebody authenticated.
 */
const HOLDER_COLUMNS = {
  id: schema.users.id,
  username: schema.users.username,
  passkey: schema.users.passkey,
  isAdmin: schema.users.isAdmin,
  isModerator: schema.users.isModerator,
  isBanned: schema.users.isBanned,
  uploaded: schema.users.uploaded,
  downloaded: schema.users.downloaded,
  showAdultContent: schema.users.showAdultContent,
  deletedAt: schema.users.deletedAt,
} as const;

/**
 * Written out rather than mapped over `HOLDER_COLUMNS`: the mapped form drops
 * nullability (`deletedAt` came back as `Date` instead of `Date | null`), and a
 * type that quietly disagrees with the column it describes is worse than one
 * that has to be kept in step by hand.
 */
export interface ReadKeyHolder {
  id: string;
  username: string;
  passkey: string;
  isAdmin: boolean;
  isModerator: boolean;
  isBanned: boolean;
  uploaded: number;
  downloaded: number;
  showAdultContent: boolean;
  deletedAt: Date | null;
}

/**
 * Resolve whoever holds this key, or null.
 *
 * Shape-checked before it touches the database: a value that cannot be a key
 * is not worth a query, and refusing early keeps an arbitrary string out of a
 * `WHERE`. Lowercased, because keys are stored lowercase and a member copying
 * one out of a config file may well have uppercased it — the Torznab gate
 * already lowercases and the RSS one did not, which meant the same key worked
 * on one surface and failed on the other.
 */
export async function findByReadKey(
  kind: ReadKeyKind,
  raw: string
): Promise<ReadKeyHolder | null> {
  const value = raw.toLowerCase();
  if (!isReadKeyShaped(value)) return null;

  const [row] = await db
    .select(HOLDER_COLUMNS)
    .from(schema.users)
    .where(eq(COLUMN[kind], value))
    .limit(1);

  if (!row || row.isBanned || row.deletedAt) return null;
  return row;
}
