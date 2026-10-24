/**
 * GET /api/welcome — the staff's welcome note, for signed-in members.
 *
 * Admin → Branding has edited this note for a long time, and the branding
 * guide promised it to members; nothing served it, so nothing showed it. The
 * home page now renders it as a card a member can dismiss. Behind a session
 * because it is written for members, not for whoever reaches the API.
 */
import { getWelcomeMessage } from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  await requireUserSession(event);
  return { message: await getWelcomeMessage() };
});
