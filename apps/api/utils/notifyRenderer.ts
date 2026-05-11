/**
 * Server-side renderer for notification titles + bodies.
 *
 * Mirrors the web's `notifications.types.<type>.{title,desc}` keys so
 * external channels (SMTP, Discord, Telegram, …) ship the same copy
 * the in-app dropdown shows. The strings are duplicated here on
 * purpose — the api shouldn't have to parse the web's vue-i18n bundle
 * at boot, and the renderer is the only consumer.
 *
 * If you tweak wording on the web side, mirror it here. The 37 type
 * keys are listed exhaustively so a TS compiler error surfaces any
 * drift between the union in `notify.ts` and this dictionary.
 *
 * Locale fallback: missing French keys fall through to English. New
 * notification types are added to both maps when introduced.
 */
import type { NotificationType } from './notify';

interface Strings {
  title: string;
  desc: string;
}

type Dict = Record<NotificationType, Strings>;

const EN: Dict = {
  upload_accepted: {
    title: 'Upload accepted',
    desc: '“{torrentName}” was approved by {moderatorUsername}.',
  },
  upload_rejected: {
    title: 'Upload rejected',
    desc: '“{torrentName}” was rejected by {moderatorUsername}: {message}',
  },
  upload_changes_requested: {
    title: 'Changes requested',
    desc: '{moderatorUsername} wants edits on “{torrentName}”.',
  },
  upload_reset: {
    title: 'Upload re-opened',
    desc: '“{torrentName}” is back in moderation as {newStatus}.',
  },
  moderation_message_received: {
    title: 'New moderation message',
    desc: '{actorUsername} replied on “{torrentName}”: {preview}',
  },
  torrent_deleted_by_staff: {
    title: 'Torrent removed by staff',
    desc: '{actorUsername} deleted “{torrentName}”.',
  },
  hnr_violation_marked: {
    title: 'Hit & Run flagged',
    desc: '“{torrentName}” crossed the grace period without enough seeding.',
  },
  hnr_cleared: {
    title: 'Hit & Run cleared',
    desc: '“{torrentName}” is no longer flagged.',
  },
  hnr_exempted: {
    title: 'Hit & Run exempted',
    desc: '“{torrentName}” was exempted from H&R tracking.',
  },
  account_banned: {
    title: 'Account suspended',
    desc: '{actorUsername} suspended your account: {reason}',
  },
  account_unbanned: {
    title: 'Account restored',
    desc: '{actorUsername} lifted the suspension on your account.',
  },
  role_attached_manually: {
    title: 'Role granted',
    desc: '{actorUsername} granted you the “{roleName}” role.',
  },
  role_detached: {
    title: 'Role removed',
    desc: '{actorUsername} removed the “{roleName}” role from your account.',
  },
  staff_status_changed: {
    title: 'Staff status changed',
    desc: '{actorUsername} updated your staff privileges.',
  },
  bonus_points_adjusted: {
    title: 'Bonus balance adjusted',
    desc: '{actorUsername} adjusted your balance by {delta} points.',
  },
  password_changed: {
    title: 'Password changed',
    desc: "Your password was changed. If this wasn't you, rotate it now.",
  },
  totp_enabled: {
    title: 'TOTP enabled',
    desc: 'Two-factor authenticator app is now active.',
  },
  totp_disabled: {
    title: 'TOTP disabled',
    desc: 'Two-factor authenticator app was turned off.',
  },
  passkey_added: {
    title: 'Passkey added',
    desc: 'New passkey “{passkeyName}” registered on your account.',
  },
  passkey_removed: {
    title: 'Passkey removed',
    desc: 'A passkey was removed from your account.',
  },
  recovery_codes_regenerated: {
    title: 'Recovery codes regenerated',
    desc: 'A new batch of recovery codes was minted. Store them safely.',
  },
  recovery_code_used: {
    title: 'Recovery code used',
    desc: "A recovery code was consumed to sign in. Investigate if it wasn't you.",
  },
  login_new_ip: {
    title: 'Sign-in from new IP',
    desc: 'We saw a login from {currentIp} (previous: {previousIp}).',
  },
  comment_on_my_upload: {
    title: 'New comment on your upload',
    desc: '{actorUsername} on “{torrentName}”: {preview}',
  },
  forum_reply_on_my_topic: {
    title: 'New reply in your topic',
    desc: '{actorUsername} on “{topicTitle}”: {preview}',
  },
  comment_deleted_by_staff: {
    title: 'Your comment was removed',
    desc: '{actorUsername} removed your comment: {preview}',
  },
  forum_post_deleted_by_staff: {
    title: 'Your forum post was removed',
    desc: '{actorUsername} removed your post: {preview}',
  },
  bonus_event_started: {
    title: 'Bonus event started',
    desc: '“{title}” is live — go grab the multipliers.',
  },
  first_seeder_reward: {
    title: 'First seeder reward',
    desc: 'You earned {amount} points as the first seeder.',
  },
  seeding_milestone_reached: {
    title: 'Seeding milestone reached',
    desc: 'Another {amount} bonus points credited from a seeding milestone.',
  },
  invite_redeemed: {
    title: 'Invite redeemed',
    desc: '{inviteeUsername} joined using your invite code.',
  },
  invitee_banned: {
    title: 'Your invitee was banned',
    desc: '{inviteeUsername} was suspended. Reason: {reason}',
  },
  new_pending_upload: {
    title: 'New upload pending review',
    desc: '{uploaderUsername} uploaded “{torrentName}”.',
  },
  new_report_filed: {
    title: 'New report filed',
    desc: '{reporterUsername} reported a {targetType}: {reasonPreview}',
  },
  report_actioned: {
    title: 'Your report was actioned',
    desc: 'Status: {status}. {resolution}',
  },
  trusted_device_added: {
    title: 'Trusted device added',
    desc: 'A new device was marked as trusted on your account.',
  },
};

const FR: Dict = {
  upload_accepted: {
    title: 'Upload accepté',
    desc: '« {torrentName} » a été approuvé par {moderatorUsername}.',
  },
  upload_rejected: {
    title: 'Upload rejeté',
    desc: '« {torrentName} » a été rejeté par {moderatorUsername} : {message}',
  },
  upload_changes_requested: {
    title: 'Modifications demandées',
    desc: '{moderatorUsername} demande des modifications sur « {torrentName} ».',
  },
  upload_reset: {
    title: 'Upload ré-ouvert',
    desc: '« {torrentName} » est repassé en modération avec le statut {newStatus}.',
  },
  moderation_message_received: {
    title: 'Nouveau message de modération',
    desc: '{actorUsername} a répondu sur « {torrentName} » : {preview}',
  },
  torrent_deleted_by_staff: {
    title: 'Torrent supprimé par un staff',
    desc: '{actorUsername} a supprimé « {torrentName} ».',
  },
  hnr_violation_marked: {
    title: 'Hit & Run signalé',
    desc: '« {torrentName} » a dépassé la période de grâce sans seed suffisant.',
  },
  hnr_cleared: {
    title: 'Hit & Run levé',
    desc: '« {torrentName} » n\'est plus signalé.',
  },
  hnr_exempted: {
    title: 'Hit & Run exempté',
    desc: '« {torrentName} » a été exempté du suivi H&R.',
  },
  account_banned: {
    title: 'Compte suspendu',
    desc: '{actorUsername} a suspendu ton compte : {reason}',
  },
  account_unbanned: {
    title: 'Compte rétabli',
    desc: '{actorUsername} a levé la suspension sur ton compte.',
  },
  role_attached_manually: {
    title: 'Rôle accordé',
    desc: '{actorUsername} t\'a accordé le rôle « {roleName} ».',
  },
  role_detached: {
    title: 'Rôle retiré',
    desc: '{actorUsername} a retiré le rôle « {roleName} ».',
  },
  staff_status_changed: {
    title: 'Statut staff mis à jour',
    desc: '{actorUsername} a modifié tes privilèges staff.',
  },
  bonus_points_adjusted: {
    title: 'Solde bonus ajusté',
    desc: '{actorUsername} a ajusté ton solde de {delta} points.',
  },
  password_changed: {
    title: 'Mot de passe modifié',
    desc: 'Ton mot de passe a été changé. Si ce n\'est pas toi, change-le maintenant.',
  },
  totp_enabled: {
    title: 'TOTP activé',
    desc: 'L\'application d\'authentification à deux facteurs est active.',
  },
  totp_disabled: {
    title: 'TOTP désactivé',
    desc: 'L\'application d\'authentification à deux facteurs a été désactivée.',
  },
  passkey_added: {
    title: 'Passkey ajoutée',
    desc: 'Nouvelle passkey « {passkeyName} » enregistrée sur ton compte.',
  },
  passkey_removed: {
    title: 'Passkey retirée',
    desc: 'Une passkey a été retirée de ton compte.',
  },
  recovery_codes_regenerated: {
    title: 'Codes de récupération régénérés',
    desc: 'Une nouvelle série de codes de récupération a été frappée. Garde-les en lieu sûr.',
  },
  recovery_code_used: {
    title: 'Code de récupération utilisé',
    desc: 'Un code de récupération a été consommé pour se connecter. Vérifie si ce n\'est pas toi.',
  },
  login_new_ip: {
    title: 'Connexion depuis une nouvelle IP',
    desc: 'Connexion détectée depuis {currentIp} (précédente : {previousIp}).',
  },
  comment_on_my_upload: {
    title: 'Nouveau commentaire sur ton upload',
    desc: '{actorUsername} sur « {torrentName} » : {preview}',
  },
  forum_reply_on_my_topic: {
    title: 'Nouvelle réponse dans ton sujet',
    desc: '{actorUsername} sur « {topicTitle} » : {preview}',
  },
  comment_deleted_by_staff: {
    title: 'Ton commentaire a été supprimé',
    desc: '{actorUsername} a supprimé ton commentaire : {preview}',
  },
  forum_post_deleted_by_staff: {
    title: 'Ton message forum a été supprimé',
    desc: '{actorUsername} a supprimé ton message : {preview}',
  },
  bonus_event_started: {
    title: 'Évènement bonus démarré',
    desc: '« {title} » est actif — profite des multiplicateurs.',
  },
  first_seeder_reward: {
    title: 'Récompense premier seeder',
    desc: 'Tu as gagné {amount} points en étant le premier à seeder.',
  },
  seeding_milestone_reached: {
    title: 'Palier de seed atteint',
    desc: '{amount} points bonus crédités pour un palier de seed.',
  },
  invite_redeemed: {
    title: 'Invitation utilisée',
    desc: '{inviteeUsername} a rejoint avec ton code d\'invitation.',
  },
  invitee_banned: {
    title: 'Ton invité a été banni',
    desc: '{inviteeUsername} a été suspendu. Raison : {reason}',
  },
  new_pending_upload: {
    title: 'Nouvel upload à modérer',
    desc: '{uploaderUsername} a uploadé « {torrentName} ».',
  },
  new_report_filed: {
    title: 'Nouveau signalement',
    desc: '{reporterUsername} a signalé un {targetType} : {reasonPreview}',
  },
  report_actioned: {
    title: 'Ton signalement a été traité',
    desc: 'Statut : {status}. {resolution}',
  },
  trusted_device_added: {
    title: 'Appareil de confiance ajouté',
    desc: 'Un nouvel appareil a été marqué comme de confiance sur ton compte.',
  },
};

const DICTS: Record<string, Dict> = { en: EN, fr: FR };

/**
 * Interpolate `{key}` placeholders with values from `params`. Unknown
 * keys keep their literal `{key}` so a missing payload field is easy
 * to spot in the rendered output rather than disappearing silently.
 */
function interpolate(
  template: string,
  params: Record<string, unknown>
): string {
  return template.replaceAll(/\{(\w+)\}/g, (_match, key: string) => {
    if (key in params) {
      const v = params[key];
      return v == null ? '' : String(v);
    }
    return `{${key}}`;
  });
}

export interface RenderedNotification {
  title: string;
  body: string;
}

/**
 * Render a notif type + payload into a `{ title, body }` pair the
 * channel adapters can ship. Falls back to a generic stub if the
 * type is somehow unknown (caller never expects this in practice —
 * the union is exhaustive — but a `console.warn` is friendlier than
 * an exception during a fan-out loop).
 */
export function renderNotification(
  type: NotificationType,
  payload: Record<string, unknown> | null,
  locale: string | null | undefined
): RenderedNotification {
  const lang = locale && DICTS[locale] ? locale : 'en';
  const dict = DICTS[lang]!;
  const entry = dict[type] ?? EN[type];
  if (!entry) {
    return {
      title: `Trackarr notification (${type})`,
      body: 'A new notification is available.',
    };
  }
  const params = payload ?? {};
  return {
    title: interpolate(entry.title, params),
    body: interpolate(entry.desc, params),
  };
}

/**
 * Synthetic payload used by the "Test" buttons. The fields cover
 * every placeholder used across the 37 types so the rendered output
 * doesn't show `{torrentName}` etc. in the test message.
 */
export function buildTestPayload(): Record<string, unknown> {
  return {
    torrentName: 'Sample.Release.2026.1080p.WEB-DL',
    moderatorUsername: 'mod_alice',
    actorUsername: 'mod_alice',
    uploaderUsername: 'user_bob',
    reporterUsername: 'user_carol',
    inviteeUsername: 'newcomer_dave',
    roleName: 'Trusted',
    passkeyName: 'Example device',
    message: 'This is a test message.',
    preview: 'This is a test preview.',
    reason: 'This is a test reason.',
    resolution: 'No action needed.',
    targetType: 'torrent',
    reasonPreview: 'This is a test report.',
    status: 'resolved',
    newStatus: 'pending',
    title: 'Test bonus event',
    topicTitle: 'Test forum topic',
    delta: 100,
    amount: 100,
    currentIp: '192.0.2.1',
    previousIp: '192.0.2.42',
  };
}
