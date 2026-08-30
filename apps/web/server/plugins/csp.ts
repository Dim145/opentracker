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
 * Styles are split three ways rather than kept permissive, and the reasoning
 * changed with the feature set. The old note said injected CSS was "a far
 * smaller problem than injected script"; that is no longer the position anyone
 * holds — CSS alone exfiltrates data through `url()` and intercepts clicks
 * through a fixed overlay, neither of which needs a line of JavaScript. So
 * `style-src-elem` now requires the nonce and only the ATTRIBUTE form keeps
 * `'unsafe-inline'`, because Vue's runtime `:style` bindings cannot carry a
 * nonce and their values are not known ahead of time. See `buildPolicy`.
 *
 * The edge must not overwrite this header. `docker/caddy/Caddyfile` no longer
 * sets a CSP on the routes proxied to this container, precisely so the nonce
 * survives; it still sets one on the paths it serves itself.
 */

/** Inline `<script>` only — never one with `src`, which `'self'` covers. */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)(?![^>]*\snonce=)/gi;

/**
 * Inline `<style>` elements, stamped the same way.
 *
 * Nuxt emits the SSR'd component styles as inline `<style>` blocks, so
 * `style-src-elem` can only be tightened to a nonce if every one of them
 * carries it. Same pattern as the scripts above, same `stamp()`.
 */
const INLINE_STYLE = /<style(?![^>]*\snonce=)/gi;

/**
 * Only an explicit origin, and only when configured.
 *
 * A relay reached through a same-origin path needs nothing here. This
 * exists for the deployment that gives it its own hostname, and it is
 * deliberately not derived from `MESSAGING_SERVICE_URL`: widening a
 * security header should be something an operator wrote down, not
 * something that happened because another variable was set.
 */
const relayOrigin = (() => {
  const raw = process.env.NUXT_PUBLIC_RELAY_ORIGIN?.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
})();

function buildPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    // Three declarations, not one, and the split is the point.
    //
    // `style-src` alone had to carry `'unsafe-inline'`, which permits ANY
    // injected `<style>` — the exact vector of the CSS-exfiltration attacks that
    // the owner-CSS feature makes worth caring about. Splitting lets the element
    // form require a nonce while the attribute form keeps `'unsafe-inline'`,
    // which it must: the site has ~134 Vue `:style` bindings whose values are
    // computed at runtime, so neither a nonce (attributes cannot carry one — the
    // MDN page is misleading here) nor `'unsafe-hashes'` (values unknown ahead of
    // time) is available for them.
    //
    // `style-src` stays as the fallback and that is not decoration:
    // `style-src-elem` only became Baseline in December 2025, and a browser that
    // does not know it falls back to this line rather than to nothing.
    //
    // The `fonts.googleapis.com` origin that used to be here is gone —
    // `@nuxt/fonts` downloads the faces at build time and serves them from
    // `/_fonts/`, so `'self'` covers both the stylesheet and the files.
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    // Remote posters and banners come from arbitrary image hosts.
    "img-src 'self' data: https:",
    // `fonts.gstatic.com` likewise. `data:` stays for the icon sets.
    "font-src 'self' data:",
    // Narrowed from `'self' https:`. Every XHR the client makes goes to our
    // own API — metadata lookups are proxied server-side so the TMDb key
    // never reaches the browser. Leaving `https:` here meant that after an
    // XSS, exfiltration to any host was still allowed.
    // The messaging relay, when an operator puts it on its own origin.
    //
    // Leaving this unset is the recommended shape: proxy the relay under
    // the site's own origin (`/relay` → the relay service) and `'self'`
    // already covers it. Setting it is a conscious widening of a directive
    // that was narrowed on purpose — one origin, never a scheme.
    `connect-src 'self'${relayOrigin ? ` ${relayOrigin}` : ''}`,
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
      chunk
        .replace(INLINE_SCRIPT, `<script nonce="${nonce}"`)
        .replace(INLINE_STYLE, `<style nonce="${nonce}"`);

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
