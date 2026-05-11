/**
 * Channel adapter contract.
 *
 * Each external notification transport (SMTP, Discord, Telegram, …)
 * exports one adapter object that satisfies this interface. The
 * `index.ts` registry stitches them into a single map the rest of the
 * app talks to — the dispatcher / API routes / UI never branches on
 * channel type, they just call `adapter.send` / `adapter.testServer` /
 * `adapter.testUser` and the adapter handles the protocol specifics.
 *
 * The interface separates the **server-side** config (admin-owned;
 * shared by every user of the channel) from the **user-side** config
 * (per-user; the recipient address / token). For pure-webhook channels
 * like Discord/Slack/Mattermost the server side is empty and the
 * adapter sets `hasServerConfig = false` so the admin UI doesn't render
 * a config form.
 *
 * `fields` is the form schema the UI uses to render inputs. Each field
 * is a typed primitive (`string`, `password`, `email`, `int`, `bool`,
 * `url`, `select`); the UI maps it to an `<input>` of the right type
 * and masks passwords/tokens. Required-ness and sensitivity are
 * declared here so the API can reject incomplete payloads and the UI
 * can decide whether to redact existing values.
 */
import type { NotificationType } from '../notify';

export interface ChannelFieldOption {
  value: string;
  label: string;
}

export interface ChannelField {
  /** Key in the config JSON. Kept short and snake-free for the UI. */
  key: string;
  /** Human label shown in the form. Resolves through i18n on the UI. */
  labelKey: string;
  /** Inline placeholder / help. Resolves through i18n on the UI. */
  hintKey?: string;
  type: 'string' | 'password' | 'email' | 'int' | 'bool' | 'url' | 'select';
  required: boolean;
  /** Treat the value as a secret — never re-emit it once stored, even
   *  when the admin/user edits the row again. Used for SMTP password,
   *  Telegram bot token, etc. */
  secret?: boolean;
  default?: string | number | boolean;
  options?: ChannelFieldOption[];
}

/**
 * What the dispatcher hands to `adapter.send`. Adapters that support
 * rich rendering (Discord embeds, Telegram Markdown) read `payload`
 * and the original `type` directly; simpler ones just use
 * `{ title, body }`.
 */
export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Deep link into the web app — adapters that can render a button
   *  (Discord, Telegram, ntfy "View" action) wire it as a CTA; SMTP
   *  inlines it as a closing line. */
  link: string | null;
  /** Original payload bag the in-app notif also carries, for adapters
   *  that need to surface specific fields (e.g. moderator username
   *  inline on Discord). */
  meta: Record<string, unknown>;
}

export type TestResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ChannelAdapter<TServer = unknown, TUser = unknown> {
  /** Stable id used in the DB + URLs. snake-style, lowercase. */
  type: string;
  /** i18n key for the human label shown in admin + user UIs. */
  labelKey: string;
  /** Phosphor icon name used in both UIs. */
  icon: string;
  /** Short tagline; one phrase max. Resolves through i18n. */
  taglineKey: string;
  /** Some channels are entirely user-owned (Discord webhooks): no
   *  admin server-side config to fill. The admin UI still renders an
   *  enable/disable toggle but skips the config form + admin test. */
  hasServerConfig: boolean;
  /** When `hasServerConfig = true`, this validates a config blob is
   *  alive (e.g. SMTP login succeeds, Telegram getMe returns ok). */
  testServer?: (server: TServer) => Promise<TestResult>;
  /** Per-user test — sends a synthetic notification to the user's
   *  configured destination so they can confirm the round-trip. */
  testUser: (
    server: TServer,
    user: TUser,
    payload: NotificationPayload
  ) => Promise<TestResult>;
  /** Real send path. Returns a TestResult so the dispatcher can
   *  update the consecutive-failures counter uniformly. */
  send: (
    server: TServer,
    user: TUser,
    payload: NotificationPayload
  ) => Promise<TestResult>;
  /** Admin-form fields (rendered to the operator). Empty when
   *  `hasServerConfig = false`. */
  serverFields: ChannelField[];
  /** User-form fields. Always at least one entry — even a pure-URL
   *  channel asks the user to paste the URL. */
  userFields: ChannelField[];
  /** Defaults applied when the server config is created for the first
   *  time. Lets adapters seed sensible values (e.g. ntfy base URL =
   *  https://ntfy.sh, SMTP port = 587). */
  serverDefaults?: () => Record<string, unknown>;
  /** Server-side info that's safe to surface to end users (e.g. the
   *  public base URL of a self-hosted ntfy instance — users need it
   *  to subscribe from their mobile app, but we wouldn't dare leak
   *  the SMTP password). Returned as an ordered list of
   *  {labelKey, value} so the UI can render it as a hint block
   *  with proper i18n. Omit on channels that have nothing to share. */
  publicServerInfo?: (server: TServer) => Array<{ labelKey: string; value: string }>;
}

export interface ChannelMeta {
  type: string;
  labelKey: string;
  taglineKey: string;
  icon: string;
  hasServerConfig: boolean;
  serverFields: ChannelField[];
  userFields: ChannelField[];
}
