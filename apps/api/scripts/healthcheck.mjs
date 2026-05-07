// Standalone healthcheck for the distroless runtime (no shell, no curl/wget).
// Invoked via `HEALTHCHECK CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]`.
import http from 'node:http';

const port = process.env.NITRO_PORT || 4000;
const url = `http://127.0.0.1:${port}/api/health`;

const req = http.get(url, (res) => {
  res.resume();
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.setTimeout(4000, () => {
  req.destroy();
  process.exit(1);
});
