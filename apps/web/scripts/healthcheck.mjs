// Standalone healthcheck for the distroless runtime (no shell, no curl/wget).
// Invoked via `HEALTHCHECK CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]`.
// We hit /api/branding because Nuxt SSR proxies it to the api service —
// success means the SSR server is up AND can reach upstream.
import http from 'node:http';

const port = process.env.NUXT_PORT || 3000;
const url = `http://127.0.0.1:${port}/`;

const req = http.get(url, (res) => {
  res.resume();
  // 200 OK or 30x redirect (e.g. /auth/register on first boot) both count as live.
  const ok = res.statusCode >= 200 && res.statusCode < 400;
  process.exit(ok ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.setTimeout(4000, () => {
  req.destroy();
  process.exit(1);
});
