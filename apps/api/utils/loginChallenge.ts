/**
 * What `login:<challenge>` holds for a username that has no account.
 *
 * A real challenge holds the account id — a UUID, so this can never collide with
 * one. The challenge route stores it under the same key as a real challenge, and
 * the login turns it into the same "Invalid credentials" as a wrong proof:
 * the two branches have to be indistinguishable from outside, or the error
 * message enumerates the members the fake salt is there to hide.
 */
export const UNKNOWN_ACCOUNT_CHALLENGE = '!unknown';
