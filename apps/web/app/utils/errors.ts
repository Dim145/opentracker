/**
 * Best-effort extractor for a user-facing error message out of an
 * unknown thrown value.
 *
 * Nuxt's `$fetch` reject payload shapes its message in `err.data.message`
 * (server-rendered H3 errors), `err.statusMessage` (HTTP status text), or
 * `err.message` (native Error). The previous pattern repeated this
 * `(err as { data?: { message?: string } })?.data?.message ?? …` ladder
 * across the codebase with `: any` casts; this helper keeps the
 * narrowing typed and returns a guaranteed string.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string') return err || fallback;
  if (err && typeof err === 'object') {
    const e = err as {
      data?: { message?: unknown };
      statusMessage?: unknown;
      message?: unknown;
    };
    if (typeof e.data?.message === 'string' && e.data.message) {
      return e.data.message;
    }
    if (typeof e.statusMessage === 'string' && e.statusMessage) {
      return e.statusMessage;
    }
    if (typeof e.message === 'string' && e.message) {
      return e.message;
    }
  }
  return fallback;
}
