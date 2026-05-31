export function safeHttpUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  // only absolute http(s); reject javascript:, data:, etc.
  if (!/^https?:\/\//i.test(t)) return null;
  try { const url = new URL(t); return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : null; } catch { return null; }
}
