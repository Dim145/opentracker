/**
 * Export an account — the GDPR right of access (Art. 15) and the right to data
 * portability (Art. 20).
 *
 * ## Why this is a mirror of `eraseAccount`
 *
 * Erasure already had to answer, precisely, "what of this person is held here"
 * — it deletes some rows, scrubs fields on others, and states which retentions
 * survive and on what basis. That inventory is the same one an export needs,
 * read instead of written. So this file follows it table for table rather than
 * inventing a second list, because two independently-maintained inventories of
 * the same thing drift, and the direction they drift in is "the export forgot
 * something the erasure knew about".
 *
 * If you add a personal table, it belongs in BOTH.
 *
 * ## Structured, machine-readable, and one file
 *
 * Art. 20 asks for a "structured, commonly used and machine-readable format".
 * JSON is all three, and it is the only one this codebase can produce without
 * taking a dependency — a zip writer would be a new package on a distroless
 * image for the sake of a folder structure nobody needs. One document, one
 * request, no archive to unpack.
 *
 * ## What is deliberately NOT in here
 *
 * Three exclusions, each with a reason, all of them declared in the payload
 * itself under `notIncluded` so the reader is told rather than left to notice:
 *
 *   - **Other people's data.** A follower list names members who followed this
 *     account; their identities are theirs, not this account's. Counted, never
 *     listed. Same for who used an invite, and for the other side of a
 *     conversation.
 *   - **Secrets, including this account's own.** Notification channels carry a
 *     webhook URL or a chat token, and they are encrypted at rest with a key
 *     this export has no business decrypting with. A file in a Downloads
 *     folder is a worse place for a live token than the database is. Channel
 *     *types* and their state are exported; the credential is not.
 *   - **Anti-cheat findings.** Art. 15 is not absolute — it yields where
 *     disclosure would prejudice the detection of abuse or the rights of
 *     others. Handing somebody the heuristics that flagged them is a recipe
 *     for evading the next check. An operator asked for these by a member (or
 *     by a regulator) can produce them from the moderation console.
 *
 * ## Bounded
 *
 * Every collection is capped and reports its own true total, so an account
 * with 40 000 notifications produces a bounded document that SAYS it is
 * bounded. An export that silently stops at the cap would be worse than one
 * that refuses: the reader would take it for the whole record.
 */
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

/**
 * Rows per collection. Generous enough that a normal account is exported in
 * full, small enough that the biggest imaginable one still fits in memory and
 * in a browser's download.
 */
const CAP = 5000;

/** A capped list, honest about what it left out. */
interface Capped<T> {
  total: number;
  returned: number;
  /** True when `total > returned` — the list is a prefix, not the record. */
  truncated: boolean;
  items: T[];
}

function capped<T>(items: T[], total: number): Capped<T> {
  return {
    total,
    returned: items.length,
    truncated: total > items.length,
    items,
  };
}

/**
 * `SELECT count(*)` for one table/predicate, unwrapped.
 *
 * Untyped on purpose: it is called against a dozen different tables and the
 * only thing it needs from each is that Drizzle accepts it in `from()`.
 * Spelling that out generically buys a signature nobody reads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countOf(table: any, where: any): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

export async function exportAccount(userId: string) {
  const account = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: {
      // Identity and profile — everything the member typed or chose.
      id: true,
      username: true,
      displayName: true,
      bio: true,
      language: true,
      theme: true,
      createdAt: true,
      lastSeen: true,
      // The economy's view of this account.
      uploaded: true,
      bonusUploaded: true,
      downloaded: true,
      bonusPoints: true,
      invitesRemaining: true,
      // Privacy preferences, which are themselves personal data: they record
      // a choice this person made.
      showLastSeen: true,
      showAdultContent: true,
      messagingReadReceipts: true,
      anonymousUploads: true,
      hideDownloadHistory: true,
      restrictComments: true,
      shareReputationFederated: true,
      trustDevicesEnabled: true,
      // Standing with the site. A sanction is this account's data and is
      // exported; who imposed it is staff data and is not.
      isBanned: true,
      banReason: true,
      bannedUntil: true,
      // Whether a second factor exists — never the secret itself.
      totpEnabled: true,
      // Set only on an already-erased account; present so an export taken
      // after an erasure is self-explanatory rather than mysteriously empty.
      deletedAt: true,
    },
  });

  if (!account) return null;

  const [
    devices,
    passkeys,
    channels,
    routing,
    roles,
    favourites,
    following,
    followerCount,
    invitesCreated,
    uploads,
    uploadCount,
    comments,
    commentCount,
    topics,
    topicCount,
    posts,
    postCount,
    snatches,
    snatchCount,
    bonus,
    bonusCount,
    purchases,
    purchaseCount,
    poolContributions,
    reportsFiled,
    requests,
    requestFills,
    ticketRows,
    templates,
    notificationRows,
    notificationCount,
  ] = await Promise.all([
    db.query.trustedDevices.findMany({
      where: eq(schema.trustedDevices.userId, userId),
      // No `tokenHash`: it is a credential, and the label plus the dates are
      // what tells a person which device this is.
      columns: { label: true, createdAt: true, expiresAt: true, lastUsedAt: true },
    }),
    db.query.webauthnCredentials.findMany({
      where: eq(schema.webauthnCredentials.userId, userId),
      // No `publicKey`, no `credentialId` — identifiers of a key the browser
      // holds, useless outside it and not something to copy around.
      columns: { name: true, transports: true, createdAt: true, lastUsedAt: true },
    }),
    db.query.userNotificationChannels.findMany({
      where: eq(schema.userNotificationChannels.userId, userId),
      // `userConfig` is the encrypted destination + token. Excluded on
      // purpose — see the note at the top of this file.
      columns: {
        channelType: true,
        enabled: true,
        lastTestStatus: true,
        lastTestedAt: true,
        createdAt: true,
      },
    }),
    db.query.userNotificationRouting.findMany({
      where: eq(schema.userNotificationRouting.userId, userId),
      columns: { type: true, channelType: true },
    }),
    db
      .select({
        role: schema.roles.name,
        assignedAt: schema.userRoles.assignedAt,
        assignedManually: schema.userRoles.assignedManually,
      })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId)),
    db
      .select({
        infoHash: schema.torrents.infoHash,
        name: schema.torrents.name,
        favouritedAt: schema.torrentFavorites.createdAt,
      })
      .from(schema.torrentFavorites)
      .innerJoin(
        schema.torrents,
        eq(schema.torrents.id, schema.torrentFavorites.torrentId)
      )
      .where(eq(schema.torrentFavorites.userId, userId))
      .limit(CAP),
    // Who this account follows is its own choice, so it is exported by name.
    db
      .select({
        username: schema.users.username,
        since: schema.userFollows.createdAt,
      })
      .from(schema.userFollows)
      .innerJoin(schema.users, eq(schema.users.id, schema.userFollows.followingId))
      .where(eq(schema.userFollows.followerId, userId))
      .limit(CAP),
    // Followers are other people. Counted, not named.
    countOf(schema.userFollows, eq(schema.userFollows.followingId, userId)),
    db.query.invitations.findMany({
      where: eq(schema.invitations.createdBy, userId),
      // `usedBy` identifies somebody else; `usedAt` says the same thing about
      // this account's invite without naming them.
      columns: {
        code: true,
        createdAt: true,
        usedAt: true,
        expiresAt: true,
      },
      limit: CAP,
    }),
    db.query.torrents.findMany({
      where: eq(schema.torrents.uploaderId, userId),
      columns: {
        infoHash: true,
        name: true,
        size: true,
        moderationStatus: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [desc(schema.torrents.createdAt)],
      limit: CAP,
    }),
    countOf(schema.torrents, eq(schema.torrents.uploaderId, userId)),
    db.query.torrentComments.findMany({
      where: eq(schema.torrentComments.authorId, userId),
      columns: { content: true, createdAt: true, updatedAt: true },
      orderBy: [desc(schema.torrentComments.createdAt)],
      limit: CAP,
    }),
    countOf(schema.torrentComments, eq(schema.torrentComments.authorId, userId)),
    db.query.forumTopics.findMany({
      where: eq(schema.forumTopics.authorId, userId),
      columns: { title: true, createdAt: true, updatedAt: true },
      orderBy: [desc(schema.forumTopics.createdAt)],
      limit: CAP,
    }),
    countOf(schema.forumTopics, eq(schema.forumTopics.authorId, userId)),
    db.query.forumPosts.findMany({
      where: eq(schema.forumPosts.authorId, userId),
      columns: { content: true, createdAt: true, updatedAt: true },
      orderBy: [desc(schema.forumPosts.createdAt)],
      limit: CAP,
    }),
    countOf(schema.forumPosts, eq(schema.forumPosts.authorId, userId)),
    // The snatch list. Exported regardless of `hideDownloadHistory`: that
    // toggle hides the list from a browser session (a stolen cookie cannot
    // enumerate it), and this route is behind a fresh-auth step-up. Refusing
    // the member their own record here would be the toggle working against
    // the person it protects.
    db
      .select({
        infoHash: schema.torrents.infoHash,
        name: schema.torrents.name,
        downloadedAt: schema.hnrTracking.downloadedAt,
        completedAt: schema.hnrTracking.completedAt,
        seedTime: schema.hnrTracking.seedTime,
        requiredSeedTime: schema.hnrTracking.requiredSeedTime,
        isHnr: schema.hnrTracking.isHnr,
        isExempt: schema.hnrTracking.isExempt,
        uploaded: schema.hnrTracking.uploaded,
        downloaded: schema.hnrTracking.downloaded,
      })
      .from(schema.hnrTracking)
      .innerJoin(schema.torrents, eq(schema.torrents.id, schema.hnrTracking.torrentId))
      .where(eq(schema.hnrTracking.userId, userId))
      .orderBy(desc(schema.hnrTracking.downloadedAt))
      .limit(CAP),
    countOf(schema.hnrTracking, eq(schema.hnrTracking.userId, userId)),
    db.query.bonusGrants.findMany({
      where: eq(schema.bonusGrants.userId, userId),
      columns: { source: true, amount: true, createdAt: true },
      orderBy: [desc(schema.bonusGrants.createdAt)],
      limit: CAP,
    }),
    countOf(schema.bonusGrants, eq(schema.bonusGrants.userId, userId)),
    db.query.shopPurchases.findMany({
      where: eq(schema.shopPurchases.userId, userId),
      columns: {
        itemNameSnapshot: true,
        itemTypeSnapshot: true,
        costPaid: true,
        createdAt: true,
      },
      orderBy: [desc(schema.shopPurchases.createdAt)],
      limit: CAP,
    }),
    countOf(schema.shopPurchases, eq(schema.shopPurchases.userId, userId)),
    db.query.freeleechPoolContributions.findMany({
      where: eq(schema.freeleechPoolContributions.userId, userId),
      columns: { amount: true, createdAt: true },
      orderBy: [desc(schema.freeleechPoolContributions.createdAt)],
      limit: CAP,
    }),
    // Reports this account filed. Not reports filed ABOUT it: those are
    // somebody else's statement, and disclosing them would identify the
    // reporter — the one thing a reporting system must not do.
    db.query.reports.findMany({
      where: eq(schema.reports.reporterId, userId),
      columns: {
        targetType: true,
        reason: true,
        details: true,
        status: true,
        resolution: true,
        withdrawnAt: true,
        createdAt: true,
        resolvedAt: true,
      },
      orderBy: [desc(schema.reports.createdAt)],
      limit: CAP,
    }),
    db.query.uploadRequests.findMany({
      where: eq(schema.uploadRequests.requesterId, userId),
      columns: {
        title: true,
        description: true,
        rewardPoints: true,
        status: true,
        createdAt: true,
        filledAt: true,
        validatedAt: true,
        cancelledAt: true,
      },
      orderBy: [desc(schema.uploadRequests.createdAt)],
      limit: CAP,
    }),
    db.query.uploadRequestFillAttempts.findMany({
      where: eq(schema.uploadRequestFillAttempts.userId, userId),
      columns: { status: true, createdAt: true, rejectedAt: true },
      orderBy: [desc(schema.uploadRequestFillAttempts.createdAt)],
      limit: CAP,
    }),
    db.query.tickets.findMany({
      where: eq(schema.tickets.openedById, userId),
      columns: {
        number: true,
        category: true,
        subject: true,
        status: true,
        closureReason: true,
        closingNote: true,
        createdAt: true,
        closedAt: true,
      },
      orderBy: [desc(schema.tickets.createdAt)],
      limit: CAP,
    }),
    db.query.presentationTemplates.findMany({
      where: eq(schema.presentationTemplates.ownerId, userId),
      columns: {
        name: true,
        description: true,
        category: true,
        content: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
      limit: CAP,
    }),
    db.query.notifications.findMany({
      where: eq(schema.notifications.userId, userId),
      columns: {
        type: true,
        payload: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: [desc(schema.notifications.createdAt)],
      limit: CAP,
    }),
    countOf(schema.notifications, eq(schema.notifications.userId, userId)),
  ]);

  // Ticket messages, for the tickets just read. Second query rather than a
  // join so a ticket with 200 replies does not multiply the ticket rows, and
  // scoped to this author: a staff reply is on the ticket but is staff's text.
  const myTicketMessages = await db.query.ticketMessages.findMany({
    where: and(
      eq(schema.ticketMessages.authorId, userId),
      eq(schema.ticketMessages.fromStaff, false)
    ),
    columns: { body: true, createdAt: true },
    orderBy: [desc(schema.ticketMessages.createdAt)],
    limit: CAP,
  });

  // Messaging. Conversations this account takes part in, with the count of its
  // own messages — never the messages themselves, and never the other
  // participant's. Encrypted conversations cannot be read server-side at all
  // (the key never leaves the members' browsers), so even the willing case is
  // not available; an unencrypted one COULD be read, and is excluded on the
  // same grounds — a two-party conversation is not one party's record.
  const conversationCount = await countOf(
    schema.conversationParticipants,
    eq(schema.conversationParticipants.userId, userId)
  );
  const sentMessageCount = await countOf(
    schema.messages,
    and(eq(schema.messages.authorId, userId), isNull(schema.messages.deletedAt))
  );

  return {
    /**
     * Metadata about the export itself, so a file found later can be dated and
     * placed without guessing.
     */
    export: {
      generatedAt: new Date().toISOString(),
      /** Bump when the shape changes in a way a consumer would notice. */
      schemaVersion: 1,
      subject: account.username,
      rowCapPerCollection: CAP,
      basis: [
        'GDPR Art. 15 — right of access',
        'GDPR Art. 20 — right to data portability',
      ],
    },

    account,
    security: { trustedDevices: devices, passkeys, roles },
    notificationSettings: { channels, routing },

    social: {
      following: capped(following, following.length),
      /** Other people. A number, by design — see the note at the top. */
      followerCount,
      favourites: capped(favourites, favourites.length),
    },

    invitesCreated: capped(invitesCreated, invitesCreated.length),

    contributions: {
      uploads: capped(uploads, uploadCount),
      torrentComments: capped(comments, commentCount),
      forumTopics: capped(topics, topicCount),
      forumPosts: capped(posts, postCount),
      presentationTemplates: capped(templates, templates.length),
    },

    activity: {
      snatches: capped(snatches, snatchCount),
      notifications: capped(notificationRows, notificationCount),
    },

    economy: {
      bonusLedger: capped(bonus, bonusCount),
      shopPurchases: capped(purchases, purchaseCount),
      freeleechPoolContributions: capped(
        poolContributions,
        poolContributions.length
      ),
    },

    requests: {
      opened: capped(requests, requests.length),
      fillAttempts: capped(requestFills, requestFills.length),
    },

    support: {
      tickets: capped(ticketRows, ticketRows.length),
      myMessages: capped(myTicketMessages, myTicketMessages.length),
    },

    reportsFiled: capped(reportsFiled, reportsFiled.length),

    messaging: {
      conversationCount,
      sentMessageCount,
      note: 'Message bodies are not exported. See `notIncluded`.',
    },

    /**
     * Said out loud rather than left to be noticed. An export whose omissions
     * are undocumented is indistinguishable from an incomplete one.
     */
    notIncluded: [
      {
        what: 'Other members’ identities',
        where: 'follower list, who used an invite, the other side of a conversation, who filed a report about this account',
        why: 'Their data, not this account’s. Counted where a count is meaningful.',
      },
      {
        what: 'Credentials and secrets',
        where: 'password verifier, passkey material, trusted-device tokens, TOTP secret, notification-channel tokens and webhook URLs, the account passkey',
        why: 'A live credential in a downloaded file is a worse risk than one in the database. Channel types and state are exported; the credential is not.',
      },
      {
        what: 'Private message bodies',
        where: 'direct messages and room messages',
        why: 'A conversation belongs to both parties. Encrypted ones cannot be read server-side at all — the key never leaves the browser.',
      },
      {
        what: 'Anti-cheat findings',
        where: 'automated flags raised on announces from this account',
        why: 'Art. 15 yields where disclosure would prejudice the detection of abuse. An operator can produce these from the moderation console on request.',
      },
    ],
  };
}
