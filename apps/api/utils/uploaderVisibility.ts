/**
 * Whether a viewer gets to see who uploaded a release.
 *
 * One definition, because `users.anonymous_uploads` has to hold on every
 * surface that names an uploader — the detail page, the cross-seed list, the
 * RSS feeds, the catalogue we publish to federated peers, the per-user upload
 * listing. A rule spelled out five times is a rule that will disagree with
 * itself after the next edit, and the failure mode here is a privacy leak
 * rather than a wrong pixel.
 */

export interface UploaderIdentity {
  id: string;
  username: string;
  anonymousUploads: boolean;
}

export interface UploaderViewer {
  id: string;
  isAdmin?: boolean | null;
  isModerator?: boolean | null;
}

export interface RedactedUploader<T> {
  /** The uploader row, or null when concealed (or genuinely absent). */
  uploader: T | null;
  /** Kept in step with `uploader` — see the note on leaking below. */
  uploaderId: string | null;
  /**
   * True only when a real uploader was concealed. Lets the client say
   * "Anonymous" instead of "uploader account deleted", which is what a bare
   * null already means on these pages.
   */
  uploaderAnonymous: boolean;
}

/**
 * Two people always see the real name: the uploader, and staff.
 *
 * Staff are exempt on purpose. A moderator has to be able to tie a release to
 * whoever posted it — that is the whole basis of the moderation queue, the
 * upload rules and any abuse response. So this setting conceals an identity
 * from other members and from federated peers, never from the operator, and
 * the settings copy should not imply otherwise.
 *
 * `uploaderId` is blanked alongside the name, which matters more than it
 * looks: the public profile endpoint resolves an id straight back to a
 * username, so returning the id while hiding the name would leave the
 * anonymity one request deep. The owner's own id is never blanked, so the
 * client-side "is this mine?" comparisons that read `uploaderId` keep working
 * for the one viewer who needs them.
 */
export function redactUploader<T extends UploaderIdentity>(
  uploader: T | null | undefined,
  viewer: UploaderViewer
): RedactedUploader<T> {
  if (!uploader) {
    return { uploader: null, uploaderId: null, uploaderAnonymous: false };
  }

  const isStaff = !!(viewer.isAdmin || viewer.isModerator);
  const isSelf = uploader.id === viewer.id;

  if (!uploader.anonymousUploads || isStaff || isSelf) {
    return { uploader, uploaderId: uploader.id, uploaderAnonymous: false };
  }

  return { uploader: null, uploaderId: null, uploaderAnonymous: true };
}

/**
 * The same decision without a row to hand — for the feed and federation paths,
 * which select `anonymousUploads` as a scalar next to the name and have no
 * viewer at all (RSS and the published catalogue are read by whoever holds the
 * key, so there is nobody to be exempt).
 */
export function concealsUploader(anonymousUploads: boolean | null | undefined): boolean {
  return anonymousUploads === true;
}
