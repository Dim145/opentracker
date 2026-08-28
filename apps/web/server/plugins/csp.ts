import { randomBytes } from 'node:crypto';

/**
 * Per-response CSP nonce, so `script-src` can drop `'unsafe-inline'`.
 *
 * The policy used to carry `'unsafe-inline'` on both the Caddy edge and this
 * SSR layer. That keyword switches off the single defence CSP offers against
 * XSS: any injected `<script>` runs. It matters here because the application
 * renders rich HTML written by its own members — torrent descriptions, forum
 * posts, listings pasted in from other trackers. DOMPurify is the first line
 * and it is configured correctly, but a sanitiser bypass (there have been
 * several over the years), a forgotten DOM sink, or a future BBCode tag would
 * have had nothing behind it.
 *
 * Hashes were the obvious alternative and do not work here: Nuxt emits a
 * second inline script carrying the public runtime config, whose bytes change
 * with `appVersion` and with every operator's tracker URLs. Pinning a hash
 * would mean a policy that breaks on each release. A nonce is regenerated per
 * response and covers both scripts without knowing their content.
 *
 * `style-src` deliberately keeps `'unsafe-inline'`: Vue scoped styles and
 * Tailwind's runtime blocks need it, and injected CSS is a far smaller
 * problem than injected script — the rich sanitiser already restricts the
 * `style` attribute to a whitelist of presentational properties.
 *
 * The edge must not overwrite this header. `docker/caddy/Caddyfile` no longer
 * sets a CSP on the routes proxied to this container, precisely so the nonce
 * survives; it still sets one on the paths it serves itself.
 */

/** Inline `<script>` only — never one with `src`, which `'self'` covers. */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)(?![^>]*\snonce=)/gi;

function buildPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    // See the note above: styles stay permissive on purpose. The
    // `fonts.googleapis.com` origin that used to be here is gone — `@nuxt/fonts`
    // downloads the faces at build time and serves them from `/_fonts/`, so
    // `'self'` covers both the stylesheet and the files.
    "style-src 'self' 'unsafe-inline'",
    // Remote posters and banners come from arbitrary image hosts.
    "img-src 'self' data: https:",
    // `fonts.gstatic.com` likewise. `data:` stays for the icon sets.
    "font-src 'self' data:",
    // Narrowed from `'self' https:`. Every XHR the client makes goes to our
    // own API — metadata lookups are proxied server-side so the TMDb key
    // never reaches the browser. Leaving `https:` here meant that after an
    // XSS, exfiltration to any host was still allowed.
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:html', (html, { event }) => {
    const nonce = randomBytes(16).toString('base64');
    event.context.cspNonce = nonce;

    const stamp = (chunk: string) =>
      chunk.replace(INLINE_SCRIPT, `<script nonce="${nonce}"`);

    html.head = html.head.map(stamp);
    html.bodyPrepend = html.bodyPrepend.map(stamp);
    html.bodyAppend = html.bodyAppend.map(stamp);
  });

  nitro.hooks.hook('render:response', (_response, { event }) => {
    const nonce = event.context.cspNonce as string | undefined;
    if (!nonce) return;
    setHeader(event, 'Content-Security-Policy', buildPolicy(nonce));
  });
});
