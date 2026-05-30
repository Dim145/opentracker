/**
 * POST /api/auth/logout
 * Destroy current session
 */
export default defineEventHandler(async (event) => {
  // Wipe the fresh-auth stamp before tearing down the session, so a
  // logout fully closes the sensitive-op window (resolve the id
  // first — clearing the session may rotate it).
  try {
    await clearFreshAuth(await getSessionId(event));
  } catch {
    // best-effort
  }
  await clearUserSession(event);

  return {
    success: true,
  };
});
