/**
 * SMTP / email adapter.
 *
 * Uses nodemailer under the hood. The admin configures the SMTP
 * server once (host, port, TLS, login, "From" header); every user
 * just supplies their own "To" email address.
 *
 * Admin test: `transporter.verify()` opens an auth'd TCP/TLS
 * connection to the SMTP server without sending mail — proves the
 * credentials work without spamming an arbitrary mailbox.
 *
 * User test: a real send to the user's `to` address. The body is the
 * synthetic test payload from the dispatcher, formatted as both
 * text/plain (the body) and a thin HTML wrap so Outlook etc. render
 * a clickable link when one is present.
 *
 * nodemailer is imported lazily because Nitro's bundler chokes if we
 * top-level import a CJS module that nobody else uses; deferring
 * keeps it out of the cold-start path for installs that never enable
 * SMTP.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface SmtpServer {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

interface SmtpUser {
  to: string;
}

async function getTransporter(server: SmtpServer) {
  const mod = await import('nodemailer');
  const nm = (mod as any).default ?? mod;
  return nm.createTransport({
    host: server.host,
    port: server.port,
    secure: server.secure,
    auth: server.user
      ? { user: server.user, pass: server.pass }
      : undefined,
    // 8s budget per attempt — long enough for slow TLS handshakes,
    // short enough that a bad config doesn't pile up worker tasks.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildHtml(payload: NotificationPayload): string {
  const safeTitle = escapeHtml(payload.title);
  const safeBody = escapeHtml(payload.body).replaceAll('\n', '<br>');
  const cta = payload.link
    ? `<p style="margin-top:24px"><a href="${escapeHtml(payload.link)}" style="background:#d4a734;color:#1a1a1a;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-family:ui-monospace,SFMono-Regular,monospace;letter-spacing:.05em;text-transform:uppercase;font-size:11px">Open in Trackarr →</a></p>`
    : '';
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fafafa;margin:0;padding:24px;color:#222">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:32px">
    <h1 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">${safeTitle}</h1>
    <p style="margin:0;line-height:1.55">${safeBody}</p>
    ${cta}
    <hr style="margin-top:32px;border:0;border-top:1px solid #eee">
    <p style="font-size:11px;color:#888;margin:12px 0 0">Sent by Trackarr.</p>
  </div>
</body></html>`;
}

export const smtpAdapter: ChannelAdapter<SmtpServer, SmtpUser> = {
  type: 'smtp',
  labelKey: 'admin.channels.smtp.label',
  taglineKey: 'admin.channels.smtp.tagline',
  icon: 'ph:envelope-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'host',
      labelKey: 'admin.channels.smtp.fields.host',
      hintKey: 'admin.channels.smtp.fields.hostHint',
      type: 'string',
      required: true,
    },
    {
      key: 'port',
      labelKey: 'admin.channels.smtp.fields.port',
      hintKey: 'admin.channels.smtp.fields.portHint',
      type: 'int',
      required: true,
      default: 587,
    },
    {
      key: 'secure',
      labelKey: 'admin.channels.smtp.fields.secure',
      hintKey: 'admin.channels.smtp.fields.secureHint',
      type: 'bool',
      required: false,
      default: false,
    },
    {
      key: 'user',
      labelKey: 'admin.channels.smtp.fields.user',
      hintKey: 'admin.channels.smtp.fields.userHint',
      type: 'string',
      required: false,
    },
    {
      key: 'pass',
      labelKey: 'admin.channels.smtp.fields.pass',
      hintKey: 'admin.channels.smtp.fields.passHint',
      type: 'password',
      required: false,
      secret: true,
    },
    {
      key: 'from',
      labelKey: 'admin.channels.smtp.fields.from',
      hintKey: 'admin.channels.smtp.fields.fromHint',
      type: 'string',
      required: true,
    },
  ],
  userFields: [
    {
      key: 'to',
      labelKey: 'admin.channels.smtp.fields.to',
      hintKey: 'admin.channels.smtp.fields.toHint',
      type: 'email',
      required: true,
    },
  ],
  serverDefaults: () => ({ port: 587, secure: false }),
  testServer: async (server) => {
    try {
      const t = await getTransporter(server);
      await t.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  testUser: async (server, user, payload) => {
    try {
      const t = await getTransporter(server);
      await t.sendMail({
        from: server.from,
        to: user.to,
        subject: payload.title,
        text: payload.link
          ? `${payload.body}\n\nOpen in Trackarr: ${payload.link}`
          : payload.body,
        html: buildHtml(payload),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  send: async (server, user, payload) => {
    try {
      const t = await getTransporter(server);
      await t.sendMail({
        from: server.from,
        to: user.to,
        subject: payload.title,
        text: payload.link
          ? `${payload.body}\n\nOpen in Trackarr: ${payload.link}`
          : payload.body,
        html: buildHtml(payload),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
};
