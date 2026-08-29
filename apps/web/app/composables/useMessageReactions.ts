/**
 * The reaction vocabulary, and the one call that toggles one.
 *
 * Shared because the strip and the picker are two components now: the
 * counts sit under the message, the "add" trigger sits in the hover
 * toolbar. Keeping them together meant the strip's wrapper was rendered
 * on every message whether or not it had anything in it, and reserved
 * its height there — a band of empty space under every line.
 */

/**
 * Six keys, fixed, and stored as KEYS rather than emoji.
 *
 * `❤️` is U+2764 U+FE0F and `❤` is U+2764: storing the character would
 * make those two different reactions to the same message, and two
 * clients normalising differently would silently split every count. An
 * open picker would also make the distinct-key space per message
 * unbounded, which is what turns "count the reactions on this page" into
 * a scan.
 */
export const REACTION_KEYS = [
  'up',
  'heart',
  'haha',
  'wow',
  'thanks',
  'done',
] as const;

export const REACTION_GLYPH: Record<string, string> = {
  up: '👍',
  heart: '❤️',
  haha: '😂',
  wow: '😮',
  thanks: '🙏',
  done: '✅',
};

/** What a message carries, from the caller's point of view. */
export interface ReactionTarget {
  reactions?: Record<string, number>;
  myReactions?: string[];
}

/**
 * Apply a delta locally.
 *
 * A delta, never a replacement map: two readers reacting inside the same
 * second would each write a snapshot taken before the other's, and the
 * second would silently erase the first.
 */
export function applyReactionDelta(
  msg: ReactionTarget,
  key: string,
  delta: number
): void {
  const counts = { ...(msg.reactions ?? {}) };
  const next = (counts[key] ?? 0) + delta;
  if (next > 0) counts[key] = next;
  else delete counts[key];
  msg.reactions = counts;

  const mine = new Set(msg.myReactions ?? []);
  if (delta > 0) mine.add(key);
  else mine.delete(key);
  msg.myReactions = [...mine];
}

/**
 * Toggle, optimistically, and put it back if the server refuses.
 *
 * Sending the same key twice removes it — there is no separate delete,
 * because "react" and "un-react" are the same gesture in every interface
 * that has this, and modelling them apart only invites the two to
 * disagree.
 */
export async function toggleReaction(
  endpoint: string,
  msg: ReactionTarget,
  key: string
): Promise<void> {
  const had = (msg.myReactions ?? []).includes(key);
  applyReactionDelta(msg, key, had ? -1 : 1);
  try {
    await $fetch(endpoint, { method: 'POST', body: { key } });
  } catch {
    applyReactionDelta(msg, key, had ? 1 : -1);
  }
}
