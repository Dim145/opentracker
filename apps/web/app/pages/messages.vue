<template>
  <div class="msg-shell">
    <!--
      A short confirmation, floating over the page.

      It cannot live inside the thread: archiving, blocking and unblocking
      all close or move the very thing you acted on, so a line rendered
      there leaves with it and the action looks like it did nothing. The
      state existed and had styles; it had no markup at all.

      `role="status"` + polite: announced, never stealing the caret.
    -->
    <Teleport to="body">
      <Transition name="msg-notice">
        <p
          v-if="notice"
          class="msg-notice"
          :class="{ 'msg-notice--warn': noticeKind === 'warn' }"
          role="status"
          aria-live="polite"
        >
          <Icon :name="noticeKind === 'warn' ? 'ph:warning-bold' : 'ph:check-circle-bold'" />
          {{ notice }}
        </p>
      </Transition>
    </Teleport>
    <!-- Below md the two panes become one: the list, then the thread with
         a way back. Two columns on a phone means two half-columns. -->
    <aside class="msg-list" :class="{ 'msg-hide-mobile': !!activeId }">
      <header class="msg-list-head">
        <h1 class="h-page">{{ $t('messaging.title') }}</h1>
        <!--
          Publishing your own key had no entry point at all: it happened
          only as a side effect of starting an encrypted conversation, and
          you could only start one with somebody who already had a key.
          Nobody could be first. This is the way in.
        -->
        <button
          type="button"
          class="msg-new"
          :aria-label="hasIdentity
            ? $t('messaging.crypto.rotateTitle')
            : $t('messaging.crypto.enableTitle')"
          :title="hasIdentity
            ? $t('messaging.crypto.rotateTitle')
            : $t('messaging.crypto.enableTitle')"
          @click="rotateOpen = true"
        >
          <Icon
            :name="hasIdentity ? 'ph:lock-key' : 'ph:lock-simple-open'"
            class="w-4 h-4"
          />
        </button>
        <button type="button" class="msg-new" @click="startOpen = true">
          <Icon name="ph:plus" class="w-4 h-4" />
          <span class="sr-only">{{ $t('messaging.newConversation') }}</span>
        </button>
      </header>

      <!-- Quick access: the room is a destination, not a conversation,
           so it sits above the list rather than in it. One entry today —
           the instance has exactly one public room. -->
      <NuxtLink v-if="canRoom" to="/chat" class="msg-quick">
        <span class="msg-quick-tile" aria-hidden="true">
          <Icon name="ph:chats-circle-bold" />
        </span>
        <span class="msg-quick-text">
          <span class="msg-quick-name">{{ $t('room.title') }}</span>
          <span class="msg-quick-sub">{{ $t('room.subtitle') }}</span>
        </span>
      </NuxtLink>

      <!-- Search across every conversation. Plaintext only, and the
           result says so rather than letting "nothing found" stand for
           "nothing I am able to look at".

           A <label> rather than a bare div: the whole box is then the
           input's hit area, so clicking the magnifier or the padding
           puts the caret in the field instead of doing nothing. -->
      <label class="msg-search">
        <Icon name="ph:magnifying-glass" class="msg-search-icon" aria-hidden="true" />
        <input
          v-model="searchQuery"
          type="search"
          class="msg-search-input"
          :placeholder="$t('messaging.search.placeholder')"
          :aria-label="$t('messaging.search.placeholder')"
          @input="scheduleSearch"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="msg-search-clear"
          :aria-label="$t('messaging.search.clear')"
          @click="clearSearch"
        >
          <Icon name="ph:x-bold" />
        </button>
      </label>

      <!--
        Two tabs, not two stacked lists.

        Stacked, the request queue pushed the inbox down the page every
        time somebody new wrote — the list you read every day moved
        because of the list you read once a week. As tabs each keeps its
        own place, and the count on Requests says whether it is worth
        opening.
      -->

      <div v-if="searching" class="msg-section">
        <p class="msg-hint">{{ $t('messaging.search.searching') }}</p>
      </div>
      <!-- One character is below the route's minimum, so it searches for
           nothing — but the list was hidden the moment the box was not
           empty, and the results block only appeared at two. A single
           keystroke emptied the page: no rows, no results, no reason. -->
      <div v-else-if="searchQuery.trim().length === 1" class="msg-section">
        <p class="msg-hint">{{ $t('messaging.search.tooShort') }}</p>
      </div>
      <div v-else-if="searchQuery.trim().length >= 2" class="msg-section">
        <p v-if="!searchResults.length" class="msg-hint">
          {{ $t('messaging.search.none') }}
        </p>
        <p v-if="searchSkipped" class="msg-hint msg-hint--warn">
          {{ $t('messaging.search.skipped') }}
        </p>
        <button
          v-for="hit in searchResults"
          :key="hit.id"
          type="button"
          class="msg-row"
          @click="openFromSearch(hit)"
        >
          <span class="msg-row-tile" aria-hidden="true">
            {{ (hit.author?.username?.[0] ?? '?').toUpperCase() }}
          </span>
          <span class="msg-row-main">
            <span class="msg-row-top">
              <span class="msg-row-name">{{ hit.author?.username ?? $t('messaging.deletedMember') }}</span>
              <time class="msg-row-time" :datetime="hit.createdAt">
                {{ shortAgo(hit.createdAt) }}
              </time>
            </span>
            <span class="msg-row-preview">{{ hit.body }}</span>
          </span>
        </button>
      </div>

      <div v-else class="msg-tabs" role="tablist" :aria-label="$t('messaging.title')">
        <button
          type="button"
          role="tab"
          class="msg-tab"
          :class="{ 'msg-tab--on': view === 'live' && tab === 'inbox' }"
          :aria-selected="view === 'live' && tab === 'inbox'"
          @click="showLive('inbox')"
        >
          {{ $t('messaging.inbox') }}
        </button>
        <button
          type="button"
          role="tab"
          class="msg-tab"
          :class="{ 'msg-tab--on': view === 'live' && tab === 'requests' }"
          :aria-selected="view === 'live' && tab === 'requests'"
          @click="showLive('requests')"
        >
          {{ $t('messaging.requests') }}
          <span v-if="requests.length" class="msg-tab-count">{{ requests.length }}</span>
        </button>
        <!-- Archived is a separate VIEW, not a filter over the same list:
             filing something away is meant to remove it from sight, and a
             list that still carries it with a marker has not done that. -->
        <button
          type="button"
          role="tab"
          class="msg-tab"
          :class="{ 'msg-tab--on': view === 'archived' }"
          :aria-selected="view === 'archived'"
          @click="showArchived()"
        >
          {{ $t('messaging.archived') }}
        </button>
      </div>

      <div v-if="!searchQuery.trim()" class="msg-section">
        <p v-if="tab === 'requests'" class="msg-hint">
          {{ $t('messaging.requestsHint') }}
        </p>
        <p v-if="!shown.length" class="msg-hint">
          {{ tab === 'requests' ? $t('messaging.emptyRequests') : $t('messaging.empty') }}
        </p>
        <button
          v-for="conv in shown"
          :key="conv.id"
          type="button"
          class="msg-row"
          :class="{ 'msg-row--on': conv.id === activeId }"
          @click="open(conv)"
        >
          <!-- An initial, not a photo: there are no avatars on this
               instance, and a coloured disc derived from the name still
               gives the eye something to lock onto when scanning. -->
          <span class="msg-row-tile" aria-hidden="true">{{ initialOf(conv) }}</span>
          <span class="msg-row-main">
            <span class="msg-row-top">
              <span class="msg-row-name">{{ nameOf(conv) }}</span>
              <time
                v-if="conv.lastMessageAt"
                class="msg-row-time"
                :datetime="conv.lastMessageAt"
              >{{ shortAgo(conv.lastMessageAt) }}</time>
            </span>
            <span class="msg-row-preview">
              <Icon v-if="conv.encrypted" name="ph:lock-simple" class="msg-row-lock" />
              {{ previewOf(conv) }}
            </span>
          </span>
          <span
            v-if="conv.unreadCount"
            class="msg-badge"
            :aria-label="conv.unreadCount === 1 ? $t('messaging.unreadOne') : $t('messaging.unreadMany', { count: conv.unreadCount })"
          >{{ conv.unreadCount > 99 ? '99+' : conv.unreadCount }}</span>
        </button>
      </div>

      <!-- The block dialog promises "you can undo this from your block
           list", so the list has to exist somewhere reachable. It is not
           a conversation, so it is not a tab: it sits at the foot of the
           pane, quiet until you look for it. -->
      <footer class="msg-list-foot">
        <button type="button" class="msg-foot-link" @click="openBlocks">
          <Icon name="ph:prohibit" />
          {{ $t('messaging.blocks.link') }}
          <span v-if="blocks.length" class="msg-foot-count">{{ blocks.length }}</span>
        </button>
      </footer>
    </aside>

    <section class="msg-thread" :class="{ 'msg-hide-mobile': !activeId }">
      <template v-if="active">
        <header class="msg-thread-head">
          <!-- Through `closeThread`, not a bare assignment: leaving by the
               back arrow has to file the draft first, exactly like
               opening another conversation does. -->
          <button type="button" class="msg-back" @click="closeThread">
            <Icon name="ph:arrow-left" class="w-4 h-4" />
            <span class="sr-only">{{ $t('common.back') }}</span>
          </button>
            <!-- The correspondent's name is the obvious place to ask
                 "who is this"; an erased account has no profile left to
                 point at, so it stays plain text. -->
            <NuxtLink
              v-if="active.with?.id"
              :to="`/users/${active.with.id}`"
              class="msg-thread-name msg-author-link truncate"
            >{{ nameOf(active) }}</NuxtLink>
            <span v-else class="msg-thread-name truncate">{{ nameOf(active) }}</span>
            <MessagingThreadMenu
              :peer="active.with?.username ?? null"
              :archived="activeArchived"
              :muted-until="active.mutedUntil ?? null"
              @archive="toggleArchive"
              @mute="(h) => setMute(h)"
              @block="blockOpen = true"
            />
          <span
            v-if="!connected"
            class="msg-tag"
            :title="$t('messaging.offlineHint')"
          >
            <Icon name="ph:cloud-slash" class="w-3 h-3" />
            {{ $t('messaging.offline') }}
          </span>
          <span v-if="active.encrypted" class="msg-tag">
            <Icon name="ph:lock-simple" class="w-3 h-3" />
            {{ $t('messaging.encrypted') }}
          </span>
        </header>

        <!-- `role="log"` plus a polite live region: a screen reader
             announces an arriving message without stealing the caret from
             somebody mid-sentence in the composer. -->
        <div ref="scrollerRef" class="msg-scroller" role="log" aria-live="polite">
          <button
            v-if="nextBefore"
            type="button"
            class="msg-older"
            :disabled="loadingOlder"
            @click="loadOlder"
          >
            {{ $t('messaging.olderMessages') }}
          </button>

          <p v-if="!messages.length" class="msg-hint">{{ $t('messaging.emptyThread') }}</p>

          <article
            v-for="msg in messages"
            :id="`msg-${msg.id}`"
            :key="msg.id"
            class="msg-bubble-row"
            :class="msg.mine ? 'msg-mine' : 'msg-theirs'"
          >
            <div
              class="msg-bubble"
              :class="[
                msg.mine
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'bg-bg-secondary text-text-primary',
                msg.failed ? 'border-error' : 'border-border',
              ]"
            >
              <p v-if="!msg.mine" class="msg-author eyebrow">
                <NuxtLink
                  v-if="msg.author?.id"
                  :to="`/users/${msg.author.id}`"
                  class="msg-author-link"
                >{{ authorOf(msg) }}</NuxtLink>
                <span v-else>{{ authorOf(msg) }}</span>
                <MessagingAuthorBadge :badge="msg.author?.badge" />
              </p>

              <!-- The quote carries a preview, never the message: a reply
                   that embedded the full text would let a deleted message
                   survive inside every answer to it. -->
              <button
                v-if="msg.replyTo"
                type="button"
                class="msg-quote"
                :disabled="msg.replyTo.gone"
                @click="jumpTo(msg.replyTo.id)"
              >
                <Icon name="ph:arrow-bend-up-left" class="msg-quote-icon" />
                <span v-if="msg.replyTo.gone" class="msg-quote-gone">
                  {{ $t('messaging.replyGone') }}
                </span>
                <span v-else class="msg-quote-text">
                  <b>{{ msg.replyTo.author ?? $t('messaging.deletedMember') }}</b>
                  {{ msg.replyTo.preview }}
                </span>
              </button>

              <p v-if="msg.body === null && msg.cipher" class="msg-body msg-unreadable">
                {{ $t('messaging.crypto.unreadable') }}
              </p>
              <p v-else class="msg-body">{{ msg.body }}</p>
              <!-- Resolved by the reader, so the card shows the torrent
                   as it is now rather than as the sender saw it. -->
              <MessagingTorrentCard
                v-for="hash in torrentHashesIn(msg.body)"
                :key="hash"
                :hash="hash"
              />
              <p class="msg-meta">
                <time :datetime="msg.createdAt">{{ shortTime(msg.createdAt) }}</time>
                <!--
                  In an encrypted thread, a line the server can read.

                  A staff broadcast is written straight into whichever
                  conversation the pair already has — there is one per
                  pair — and it cannot be end-to-end encrypted: the
                  sender never holds thousands of recipients' keys. So it
                  arrives in clear inside a thread wearing a padlock.
                  Marked rather than hidden: the badge on the thread is a
                  promise, and any line that does not keep it has to say
                  so where it is read.
                -->
                <span
                  v-if="active?.encrypted && msg.body !== null && !msg.cipher"
                  class="msg-clear"
                  :title="$t('messaging.crypto.notSealedHint')"
                >
                  · <Icon name="ph:lock-simple-open" />
                  {{ $t('messaging.crypto.notSealed') }}
                </span>
                <!-- Said out loud. An edit that leaves no mark lets
                     somebody rewrite what they said after being answered. -->
                <span v-if="msg.editedAt" class="msg-edited">
                  · {{ $t('messaging.edited') }}
                </span>
                <template v-if="msg.failed">
                  · <span class="text-error">{{ $t('messaging.sendFailed') }}</span>
                  <button type="button" class="msg-retry" @click="retry(msg)">
                    {{ $t('messaging.retry') }}
                  </button>
                </template>
              </p>


              <!-- A floating toolbar, clear of the bubble's top edge.
                   Revealed on hover on a pointer device and ALWAYS shown
                   where there is no hover — an action that only exists on
                   hover does not exist on a phone.

                   Gone entirely on a filed-away thread: reply, edit,
                   withdraw and react all write, and the server refuses
                   every one of them from an archived seat. Leaving the
                   buttons would offer four controls that answer 409. -->
              <div v-if="!activeArchived" class="msg-actions">
                <MessagingReactionPicker
                  v-if="!msg.deleted && !String(msg.id).startsWith('pending-')"
                  :mine="msg.myReactions ?? []"
                  @toggle="(k) => react(msg, k)"
                />
                <button
                  type="button"
                  class="msg-action"
                  :aria-label="$t('messaging.reply')"
                  :title="$t('messaging.reply')"
                  @click="startReply(msg)"
                >
                  <Icon name="ph:arrow-bend-up-left" />
                </button>
                <button
                  v-if="msg.mine && !msg.deleted"
                  type="button"
                  class="msg-action"
                  :aria-label="$t('messaging.edit')"
                  :title="$t('messaging.edit')"
                  @click="beginEdit(msg)"
                >
                  <Icon name="ph:pencil-simple" />
                </button>
                <!-- A report is about ONE message, so the flag is on the
                     message rather than in the conversation menu, which
                     would have had nothing to point at. -->
                <button
                  v-if="!msg.mine && !msg.deleted"
                  type="button"
                  class="msg-action"
                  :aria-label="$t('messaging.menu.report')"
                  :title="$t('messaging.menu.report')"
                  @click="reportTarget = msg"
                >
                  <Icon name="ph:flag" />
                </button>
                <!-- The route has always described this case — "everybody
                     else needs a seat, and may only withdraw what they
                     wrote" — and nothing called it. The room had the
                     button; the private surface did not. -->
                <button
                  v-if="(msg.mine || isStaff) && !msg.deleted"
                  type="button"
                  class="msg-action msg-action--danger"
                  :aria-label="$t('messaging.remove')"
                  :title="$t('messaging.remove')"
                  @click="removeMessage(msg)"
                >
                  <Icon name="ph:trash" />
                </button>
              </div>
            </div>

            <!-- Outside the bubble, deliberately.
                 Inside, the reaction row inflated the bubble every time
                 somebody reacted, and the action buttons sat ON the last
                 line of text — unreadable and unclickable at the same
                 time. Out here they are their own row, the bubble keeps
                 its shape, and neither ever covers a word. -->
            <MessagingReactions
              :counts="msg.reactions ?? {}"
              :mine="msg.myReactions ?? []"
              @toggle="(k) => react(msg, k)"
            />

          </article>
        </div>

        <!--
          Checked before the crypto panel, which would otherwise offer to
          generate a key for a conversation no key can ever open again.
          The reason is stated rather than left as an unexplained blank.
        -->
        <!--
          Filed away, and read-only until it is taken back out.

          Archiving used to remove a conversation from the list and
          change nothing else: the composer was right there, so a thread
          could be answered from inside the archive and stay archived —
          which is not a shelf, it is a hiding place. Frozen, with the
          one control that undoes it, so there is no dead end.

          Checked first: an archived conversation is archived whatever
          else is true of it.
        -->
        <div v-if="activeArchived" class="msg-locked">
          <p class="msg-locked-title">
            <Icon name="ph:archive" class="w-4 h-4" />
            {{ $t('messaging.archivedTitle') }}
          </p>
          <p class="msg-locked-body">{{ $t('messaging.archivedBody') }}</p>
          <button type="button" class="btn btn-sm" @click="toggleArchive">
            {{ $t('messaging.menu.unarchive') }}
          </button>
        </div>
        <div v-else-if="erasedThread" class="msg-locked">
          <p class="msg-locked-title">
            <Icon name="ph:lock-key" class="w-4 h-4" />
            {{ $t('messaging.deletedMember') }}
          </p>
          <p class="msg-locked-body">{{ $t('messaging.erasedConversation') }}</p>
        </div>
        <!-- The correspondent published something this browser cannot
             use as a key. Separated from the two states above because
             the advice is the opposite: nothing done HERE fixes it, so
             offering a button that replaces my own key would destroy my
             other conversations for no gain. -->
        <div
          v-else-if="active.encrypted && cryptoState === 'peerKeyBroken'"
          class="msg-locked"
        >
          <p class="msg-locked-title">
            <Icon name="ph:lock-key" class="w-4 h-4" />
            {{ $t('messaging.crypto.peerKeyBrokenTitle') }}
          </p>
          <p class="msg-locked-body">{{ $t('messaging.crypto.peerKeyBrokenBody') }}</p>
        </div>
        <div
          v-else-if="active.encrypted && cryptoState !== 'ready'"
          class="msg-locked"
        >
          <p class="msg-locked-title">
            <Icon name="ph:lock-key" class="w-4 h-4" />
            {{ cryptoState === 'foreign'
              ? $t('messaging.crypto.lockedTitle')
              : $t('messaging.crypto.noKeyYet') }}
          </p>
          <p class="msg-locked-body">
            {{ cryptoState === 'foreign'
              ? $t('messaging.crypto.lockedBody')
              : $t('messaging.crypto.hint') }}
          </p>
          <button type="button" class="btn btn-sm" @click="rotateOpen = true">
            {{ cryptoState === 'foreign'
              ? $t('messaging.crypto.useThisDevice')
              : $t('messaging.crypto.generate') }}
          </button>
        </div>
        <form
          v-else-if="!erasedThread && (!active.encrypted || cryptoState === 'ready')"
          class="msg-composer"
          @submit.prevent="send"
        >
          <!-- What the composer is about to do, above the field rather
               than inside it: a placeholder that says "replying to…"
               disappears the moment you start typing, which is exactly
               when you want to still be able to check it. -->
          <div v-if="replyTo || editing" class="msg-context">
            <Icon
              :name="editing ? 'ph:pencil-simple' : 'ph:arrow-bend-up-left'"
              class="msg-context-icon"
            />
            <span class="msg-context-text">
              <template v-if="editing">{{ $t('messaging.editing') }}</template>
              <template v-else>
                {{ $t('messaging.replyingTo', { name: authorOf(replyTo!) }) }}
                — {{ (replyTo!.body ?? '').slice(0, 60) }}
              </template>
            </span>
            <button
              type="button"
              class="msg-context-clear"
              :aria-label="$t('common.cancel')"
              @click="clearContext"
            >
              <Icon name="ph:x" />
            </button>
          </div>

          <p v-if="sendError" class="msg-send-error">{{ sendError }}</p>

          <!--
            The banner above, the controls below.

            The composer used to be one flex ROW, so the banner became a
            sibling of the textarea and took its width — the field it was
            describing was squeezed to nothing. Two rows, and the banner
            sits where a banner belongs.
          -->
          <!-- Replying to a request accepts it — that is the design, and
               it was silent about it: an Accept button and a composer side
               by side, with no hint that using the second does the first. -->
          <p v-if="active.state === 'pending'" class="msg-pending-hint">
            {{ $t('messaging.replyAccepts') }}
          </p>

          <div class="msg-composer-row">
          <button
            v-if="active.state === 'pending'"
            type="button"
            class="msg-accept"
            @click="accept"
          >
            {{ $t('messaging.accept') }}
          </button>
          <textarea
            v-model="draft"
            rows="1"
            :placeholder="$t('messaging.placeholder')"
            :aria-label="$t('messaging.placeholder')"
            class="msg-input bg-bg-secondary border border-border text-text-primary placeholder:text-text-muted focus:border-accent"
            @keydown.enter.exact.prevent="send"
          />
          <button type="submit" class="msg-send" :disabled="!draft.trim()">
            <Icon
              :name="editing ? 'ph:check' : 'ph:paper-plane-tilt'"
              class="w-4 h-4"
            />
            <span class="sr-only">
              {{ editing ? $t('messaging.saveEdit') : $t('messaging.send') }}
            </span>
          </button>
          </div>
        </form>
      </template>
      <p v-else class="msg-hint msg-placeholder">{{ $t('messaging.pick') }}</p>
    </section>

    <Modal
      v-model="startOpen"
      :title="$t('messaging.newConversation')"
      @update:model-value="(open: boolean) => open && resetStartForm()"
    >
      <form class="flex flex-col gap-3" @submit.prevent="startConversation">
        <label class="eyebrow" for="msg-recipient">{{ $t('messaging.recipient') }}</label>
        <input
          id="msg-recipient"
          v-model="startWith"
          class="input"
          autocomplete="off"
          spellcheck="false"
          @blur="checkPeerKey"
            @input="schedulePeerKeyCheck"
        />
        <p v-if="peerKeyChecked && !peerHasKey" class="msg-hint">
          {{ $t('messaging.crypto.unavailable', { name: startWith.trim() }) }}
        </p>
        <label v-if="peerHasKey" class="flex items-start gap-2 text-sm">
          <input v-model="startEncrypted" type="checkbox" class="mt-1" />
          <span>
            <strong>{{ $t('messaging.crypto.label') }}</strong>
            <span class="block msg-hint">{{ $t('messaging.crypto.hint') }}</span>
          </span>
        </label>
        <p v-if="startError" class="text-sm text-error">{{ startError }}</p>
        <button type="submit" class="btn btn-primary self-end" :disabled="!startWith.trim()">
          {{ $t('messaging.start') }}
        </button>
      </form>
    </Modal>

    <!-- Destructive, and shaped like it: a separate dialog, the count of
         what it will destroy, and a checkbox. Not a word to retype — that
         is friction which makes people click faster, not think longer. -->
    <!--
      One dialog for the key, whichever act it is.

      Creating the first one destroys nothing, so it asks for no
      acknowledgement and warns about nothing. Replacing one does, and
      keeps both. Two dialogs would say the same thing twice and drift.
    -->
    <Modal
      v-model="rotateOpen"
      :title="hasIdentity
        ? $t('messaging.crypto.rotateTitle')
        : $t('messaging.crypto.enableTitle')"
    >
      <div class="flex flex-col gap-3">
        <p class="text-sm">
          {{ hasIdentity
            ? $t('messaging.crypto.rotateWarning')
            : $t('messaging.crypto.enableBody') }}
        </p>
        <label v-if="hasIdentity" class="flex items-start gap-2 text-sm">
          <input v-model="rotateAcknowledged" type="checkbox" class="mt-1" />
          <span>{{ $t('messaging.crypto.rotateConfirm') }}</span>
        </label>
        <p v-if="rotateError" class="text-sm text-error">{{ rotateError }}</p>
        <button
          type="button"
          class="btn btn-sm self-end"
          :disabled="rotateBusy || (hasIdentity && !rotateAcknowledged)"
          @click="doRotate"
        >
          <Icon v-if="rotateBusy" name="ph:circle-notch" class="animate-spin" />
          {{ hasIdentity
            ? $t('messaging.crypto.rotateAction')
            : $t('messaging.crypto.enableAction') }}
        </button>
      </div>
    </Modal>

    <!--
      Blocking is symmetric and silent, so the dialog has to be the place
      it is said out loud: what it does to both sides, that the other one
      is not told, and where to undo it. A confirmation that only says
      "are you sure?" moves the decision without informing it.
    -->
    <Modal v-model="blockOpen" :title="$t('messaging.blockTitle', { name: peerName })">
      <div class="flex flex-col gap-3">
        <p class="text-sm">{{ $t('messaging.blockBody') }}</p>
        <p v-if="blockError" class="msg-hint msg-hint--warn">{{ blockError }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-sm" @click="blockOpen = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-sm msg-btn-danger"
            :disabled="blockBusy"
            @click="doBlock"
          >
            <Icon v-if="blockBusy" name="ph:circle-notch" class="animate-spin" />
            {{ $t('messaging.blockConfirm') }}
          </button>
        </div>
      </div>
    </Modal>

    <!-- Everyone this member refuses, and the one control that matters:
         stop refusing them. Empty is the normal state, and it says so
         rather than showing a bare frame. -->
    <Modal v-model="blocksOpen" :title="$t('messaging.blocks.title')">
      <div class="flex flex-col gap-3">
        <p class="msg-hint">{{ $t('messaging.blocks.hint') }}</p>
        <p v-if="blocksLoading" class="msg-hint">{{ $t('common.loading') }}</p>
        <p v-else-if="!blocks.length" class="msg-hint">
          {{ $t('messaging.blocks.empty') }}
        </p>
        <ul v-else class="msg-blocks">
          <li v-for="b in blocks" :key="b.id" class="msg-blocks-row">
            <!-- The disc and the name go to the profile, the same way
                 they do in a thread and in the room. Blocking somebody
                 does not stop them having a page, and checking who they
                 were is exactly what this list is opened for. -->
            <NuxtLink :to="`/users/${b.id}`" class="msg-blocks-who">
              <span class="msg-row-tile" aria-hidden="true">
                {{ (b.displayName || b.username).slice(0, 1).toUpperCase() }}
              </span>
              <span class="msg-blocks-main">
                <span class="msg-blocks-name">{{ b.displayName || b.username }}</span>
                <time class="msg-blocks-since" :datetime="b.createdAt">
                  {{ $t('messaging.blocks.since', { when: shortAgo(b.createdAt) }) }}
                </time>
              </span>
            </NuxtLink>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="unblocking === b.username"
              @click="unblock(b.username)"
            >
              <Icon
                v-if="unblocking === b.username"
                name="ph:circle-notch"
                class="animate-spin"
              />
              {{ $t('messaging.blocks.lift') }}
            </button>
          </li>
        </ul>
      </div>
    </Modal>

    <!-- Reporting a message. The slip teleports to the body, so where it
         sits in this tree is organisational only. -->
    <ReportModal
      v-if="reportTarget"
      :is-open="!!reportTarget"
      target-type="message"
      :target-id="reportTarget.id"
      :target-label="reportLabel"
      :caveat="reportCaveat"
      @close="reportTarget = null"
      @submitted="onReported"
    />
  </div>
</template>

<script setup lang="ts">
import type { AuthorBadgeValue } from '~/components/messaging/AuthorBadge.vue';
/**
 * Private messages — the P1 surface.
 *
 * No live delivery yet: the thread is what the server had when the page
 * asked. That is deliberate rather than unfinished, and it is why sending
 * is optimistic — the message appears immediately with a failure state
 * and a retry, so the absence of a socket is not felt as latency.
 *
 * The encrypted case is visible but inert here: a conversation can be
 * opened encrypted (the flag is immutable, so it has to be settable at
 * creation) while the key exchange itself lands in a later step. Showing
 * it locked is more honest than hiding conversations that exist.
 */
interface Conversation {
  id: string;
  encrypted: boolean;
  unreadCount: number;
  lastMessageAt?: string | null;
  /** Until when notifications are silenced, or null. */
  mutedUntil?: string | null;
  /** Last line, or null when there is none the server can show. */
  preview?: string | null;
  state?: 'active' | 'pending';
  with: { id: string; username: string; displayName: string | null } | null;
}

interface ReplyRef {
  id: string;
  /** Retention or a deletion took the quoted message. */
  gone?: boolean;
  author?: string | null;
  preview?: string | null;
}

interface ThreadMessage {
  id: string;
  body: string | null;
  cipher: string | null;
  /** The AES-GCM nonce that goes with `cipher`. Null on a plain line. */
  iv: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt?: string | null;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    /** The single highest-priority public badge, or null. */
    badge?: AuthorBadgeValue | null;
  } | null;
  reactions?: Record<string, number>;
  myReactions?: string[];
  replyTo?: ReplyRef | null;
  mine?: boolean;
  failed?: boolean;
}

const { t } = useI18n();
const { user } = useUserSession();
const route = useRoute();
const router = useRouter();

/** Which half of the list is on screen. Tabs, not two stacked lists. */
const tab = ref<'inbox' | 'requests'>('inbox');
/** Which list is being fetched at all. Archived is its own view. */
const view = ref<'live' | 'archived'>('live');

const searchQuery = ref('');
const searching = ref(false);
const searchSkipped = ref(false);
interface SearchHit {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  author: { id: string | null; username: string } | null;
}
const searchResults = ref<SearchHit[]>([]);

const blockOpen = ref(false);
/** The message a report is being filed against. */
const reportTarget = ref<ThreadMessage | null>(null);

const inbox = ref<Conversation[]>([]);
const requests = ref<Conversation[]>([]);
/** The shelf. Kept apart so the tab counts stay about the live lists. */
const archived = ref<Conversation[]>([]);
const activeId = ref<string | null>(null);
const messages = ref<ThreadMessage[]>([]);
const nextBefore = ref<string | null>(null);
const loadingOlder = ref(false);
const draft = ref('');
/** The message the composer is answering, if any. */
const replyTo = ref<ThreadMessage | null>(null);
/** The message the composer is rewriting, if any. Mutually exclusive. */
const editing = ref<ThreadMessage | null>(null);
const scrollerRef = ref<HTMLElement | null>(null);

const shown = computed(() => {
  if (view.value === 'archived') return archived.value;
  return tab.value === 'requests' ? requests.value : inbox.value;
});

/** Whether the open conversation is on the shelf. */
const activeArchived = computed(
  () => !!activeId.value && archived.value.some((c) => c.id === activeId.value)
);

/** Anywhere it might be: the two live lists, or the shelf. */
function conversationById(id: string | null): Conversation | null {
  if (!id) return null;
  return (
    inbox.value.find((c) => c.id === id) ??
    requests.value.find((c) => c.id === id) ??
    archived.value.find((c) => c.id === id) ??
    null
  );
}

const canRoom = computed(
  () => !!(user.value as { canRoom?: boolean } | null)?.canRoom
);

/** First letter of the correspondent, for the row's disc. */
function initialOf(conv: Conversation): string {
  const name = conv.with?.displayName || conv.with?.username;
  return (name?.[0] ?? '?').toUpperCase();
}

/**
 * The last line of the conversation.
 *
 * Three distinct absences, kept distinct: an encrypted thread the server
 * cannot preview, a thread whose last message was removed, and a thread
 * with nothing in it. Collapsing them into one blank line would make the
 * list lie about two of the three.
 */
function previewOf(conv: Conversation): string {
  if (conv.encrypted) return t('messaging.encryptedPreview');
  return conv.preview ?? t('messaging.noPreview');
}

/**
 * Compact relative time for the list — "3 min", "2 h", "5 j".
 *
 * Not a full sentence: the row already carries a name, a preview and
 * possibly a badge, and "il y a 3 minutes" spends a third of the width
 * saying something the position in the list mostly already said.
 */
function shortAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return t('messaging.ago.now');
  if (seconds < 3600) return t('messaging.ago.minutes', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('messaging.ago.hours', { n: Math.floor(seconds / 3600) });
  if (seconds < 604800) return t('messaging.ago.days', { n: Math.floor(seconds / 86400) });
  return new Date(iso).toLocaleDateString();
}

const startOpen = ref(false);
/**
 * Forget the previous recipient's answer when the dialog reopens.
 *
 * `peerHasKey` decides whether the encryption checkbox exists, and
 * `startEncrypted` whether it is ticked. Kept from the last time, the box
 * appeared already ticked before a name had been typed — and the lookup
 * is debounced 350 ms while Enter never blurs the field, so a fast typist
 * could create an ENCRYPTED conversation with somebody who has no key.
 * The flag is immutable: that thread can never be opened by either side.
 */
function resetStartForm() {
  startWith.value = '';
  startError.value = '';
  startEncrypted.value = false;
  peerHasKey.value = false;
  peerKeyChecked.value = false;
}
const startWith = ref('');
const startError = ref('');
/**
 * A refusal from the composer, shown above it.
 *
 * `startError` lives in the new-conversation dialog, so writing there
 * from `send()` would have set a message nobody could see — the same
 * silence the guard above already produced.
 */
const sendError = ref('');
/** How many sends are in flight. See the echo guard in `onMessages`. */
const sending = ref(0);
const startEncrypted = ref(false);
const peerHasKey = ref(false);
const peerKeyChecked = ref(false);
const rotateOpen = ref(false);
const rotateAcknowledged = ref(false);
const rotateBusy = ref(false);
const rotateError = ref('');
/** Whether THIS browser holds a key. Decides which act the dialog offers. */
const hasIdentity = ref(false);

const convCrypto = useConversationCrypto();
const cryptoState = computed(() => convCrypto.state.value);

// An encrypted conversation whose correspondent no longer exists. Erasure
// destroys their published key and every message in the thread, so this is
// terminal — not a device that has not caught up yet, which is what the
// crypto panel is for.
const erasedThread = computed(
  () => !!active.value && active.value.encrypted && !active.value.with
);

/**
 * Whether the other member has published a key.
 *
 * An encrypted conversation can only be started with somebody who has,
 * and that is a real limit of one-key-per-account rather than a detail to
 * hide: the checkbox simply does not appear, and the dialog says why.
 */
/**
 * Look the recipient up while they type, not only when the field loses
 * focus. Typing a name and pressing Enter never blurs it, so the
 * encryption checkbox stayed hidden and the option looked absent.
 */
let peerKeyTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePeerKeyCheck() {
  if (peerKeyTimer) clearTimeout(peerKeyTimer);
  peerKeyTimer = setTimeout(() => void checkPeerKey(), 350);
}

/**
 * Look the recipient up.
 *
 * The previous answer is kept while a new one is in flight. Clearing it
 * first made the "no key" hint appear and vanish on every blur — a
 * flicker under the field, because blur and the debounced input check
 * both fired and each reset the state before asking again.
 *
 * The result is also matched against the name that was current when the
 * request went out: two lookups can land out of order, and the slower
 * one would otherwise answer for a name nobody typed any more.
 */
let peerKeyRequest = 0;
async function checkPeerKey() {
  if (peerKeyTimer) {
    clearTimeout(peerKeyTimer);
    peerKeyTimer = null;
  }
  const name = startWith.value.trim();
  if (!name) {
    peerKeyChecked.value = false;
    peerHasKey.value = false;
    startEncrypted.value = false;
    return;
  }
  const ticket = ++peerKeyRequest;
  let available = false;
  try {
    const res = await $fetch<{ available: boolean }>(
      `/api/messaging/keys/${encodeURIComponent(name)}`
    );
    available = res.available;
  } catch {
    available = false;
  }
  if (ticket !== peerKeyRequest || startWith.value.trim() !== name) return;
  peerHasKey.value = available;
  peerKeyChecked.value = true;
  if (!available) startEncrypted.value = false;
}

/**
 * Create or replace this browser's key.
 *
 * Wrapped, because it was not: a throw anywhere in here left the dialog
 * open with the button clicked and nothing else — which is exactly what
 * "I click Replace my key and nothing happens" looks like from outside.
 * The failure is on screen now instead of only in the console.
 */
async function doRotate() {
  rotateError.value = '';
  rotateBusy.value = true;
  try {
    await convCrypto.rotate(navigator.userAgent.slice(0, 60));
    rotateOpen.value = false;
    rotateAcknowledged.value = false;
    await refreshIdentity();
    // Everything the previous key sealed is now unreadable. Reloading is
    // what makes the thread say so, rather than leaving stale plaintext on
    // screen from before the rotation.
    await loadList();
    if (activeId.value) await loadThread();
  } catch (err) {
    rotateError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      (err as Error)?.message ??
      t('messaging.crypto.rotateFailed');
  } finally {
    rotateBusy.value = false;
  }
}

/** What the browser holds, read on arrival and after every rotation. */
async function refreshIdentity() {
  hasIdentity.value = !!(await convCrypto.ensureIdentity());
}

const active = computed(() => conversationById(activeId.value));

function nameOf(conv: Conversation) {
  // A deleted account leaves no name behind: `authorId` went null on
  // deletion, and rendering the absence is the erasure story rather than a
  // remembered username.
  if (!conv.with) return t('messaging.deletedMember');
  return conv.with.displayName || conv.with.username;
}

function authorOf(msg: ThreadMessage) {
  if (!msg.author) return t('messaging.deletedMember');
  // A streamed frame carries the author's id but not their name — the
  // relay copies bytes and does not join. For anyone but me that is the
  // conversation's other side, which the list already names.
  return (
    msg.author.displayName ||
    msg.author.username ||
    (active.value ? nameOf(active.value) : t('messaging.deletedMember'))
  );
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The first load goes through `useFetch`, not `$fetch`.
 *
 * A bare `$fetch` at the top of a page runs on the server during SSR,
 * where it carries no cookie — so it answered 401 and the whole page
 * rendered as an error. `useFetch` forwards the request's own headers,
 * which is why every other authenticated page here uses it. Later reloads
 * happen in the browser, where the cookie rides along on its own.
 */
const { data: listData, refresh: refreshList } = await useFetch<{
  inbox: Conversation[];
  requests: Conversation[];
}>('/api/messaging/conversations');

watchEffect(() => {
  inbox.value = (listData.value?.inbox ?? []).map((c) => ({
    ...c,
    state: 'active' as const,
  }));
  requests.value = (listData.value?.requests ?? []).map((c) => ({
    ...c,
    state: 'pending' as const,
  }));
});

/**
 * The archived view keeps its own list rather than overwriting the live
 * ones.
 *
 * It used to replace `inbox`/`requests`, which meant the count on the
 * Requests tab silently became the count of ARCHIVED requests — usually
 * zero — so opening the archive looked like the queue had emptied. The
 * badge is about the inbox; it has to keep saying so from every tab.
 *
 * One list, not two: the archive is a shelf, and splitting a shelf into
 * "inbox" and "requests" is a distinction that only matters where
 * something is waiting for an answer.
 */
async function loadList() {
  if (view.value === 'archived') {
    const data = await $fetch<{ inbox: Conversation[]; requests: Conversation[] }>(
      '/api/messaging/conversations',
      { query: { archived: 'true' } }
    );
    archived.value = [
      ...(data.inbox ?? []).map((c) => ({ ...c, state: 'active' as const })),
      ...(data.requests ?? []).map((c) => ({ ...c, state: 'pending' as const })),
    ].sort((a, b) =>
      String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? ''))
    );
    return;
  }
  await refreshList();
}

/** Back to the live lists, on the tab asked for. */
async function showLive(which: 'inbox' | 'requests') {
  tab.value = which;
  if (view.value === 'live') return;
  view.value = 'live';
  activeId.value = null;
  void router.replace({ query: { ...route.query, v: undefined, c: undefined } });
  await loadList();
}

async function showArchived() {
  if (view.value === 'archived') return;
  view.value = 'archived';
  tab.value = 'inbox';
  activeId.value = null;
  // In the URL like the open conversation is, so a reload does not drop
  // the reader back into the inbox they had just left.
  void router.replace({ query: { ...route.query, v: 'archived', c: undefined } });
  await loadList();
}

/**
 * File the conversation away, or take it back out.
 *
 * Per member: archiving removes it from YOUR list and touches nothing on
 * the other side. The alternative is not filing, it is deleting in
 * somebody else's name.
 */
async function toggleArchive() {
  const id = activeId.value;
  if (!id) return;
  const archiving = !activeArchived.value;
  try {
    await $fetch(`/api/messaging/conversations/${id}/archive`, {
      method: archiving ? 'POST' : 'DELETE',
    });
    if (archiving) {
      // It has left the list on screen, so the pane closes rather than
      // showing a conversation the list no longer contains. The shelf is
      // dropped rather than appended to: it is refetched every time it
      // is opened, and a half-updated cache is what decides whether the
      // composer is frozen.
      activeId.value = null;
      archived.value = [];
      await loadList();
    } else {
      // Coming back out, the view follows the thread the same way
      // accepting a request does. Staying on Archived left the reader
      // looking at an empty list, which reads as "it vanished".
      archived.value = archived.value.filter((c) => c.id !== id);
      view.value = 'live';
      tab.value = 'inbox';
      void router.replace({ query: { ...route.query, v: undefined } });
      await loadList();
      activeId.value = id;
    }
    say(archiving
      ? t('messaging.menu.archivedDone')
      : t('messaging.menu.unarchivedDone'));
  } catch (err) {
    // Through the toast, not `sendError`: that one renders inside the
    // composer, and the composer is exactly what is NOT on screen when a
    // thread is filed away, locked by crypto, or belongs to an erased
    // member. A refusal posted there is a refusal nobody sees.
    say(
      (err as { data?: { message?: string } })?.data?.message ??
        t('messaging.menu.failed'),
      'warn'
    );
  }
}

/** Silence the notifications, not the counter. Zero hours lifts it. */
async function setMute(hours: number) {
  const id = activeId.value;
  if (!id) return;
  try {
    const res = await $fetch<{ mutedUntil: string | null }>(
      `/api/messaging/conversations/${id}/mute`,
      { method: 'POST', body: { hours } }
    );
    const row = conversationById(id);
    if (row) row.mutedUntil = res.mutedUntil;
    say(hours > 0
      ? t('messaging.menu.mutedDone')
      : t('messaging.menu.unmutedDone'));
  } catch (err) {
    say(
      (err as { data?: { message?: string } })?.data?.message ??
        t('messaging.menu.failed'),
      'warn'
    );
  }
}

/**
 * Block the correspondent. Symmetric and silent by design: a refusal that
 * announces itself is an invitation to try again from another account.
 */
const blockBusy = ref(false);
const blockError = ref('');
/** Who the block dialog is about, readable after the thread is closed. */
const peerName = computed(() =>
  active.value ? nameOf(active.value) : ''
);

async function doBlock() {
  const name = active.value?.with?.username;
  if (!name) return;
  blockBusy.value = true;
  blockError.value = '';
  try {
    await $fetch('/api/messaging/blocks', {
      method: 'POST',
      body: { username: name },
    });
    blockOpen.value = false;
    activeId.value = null;
    await loadList();
    // The count at the foot is now one higher. Refetched rather than
    // incremented: the server is the one that knows whether it took.
    await loadBlocks();
    say(t('messaging.menu.blockedDone', { name }));
  } catch (err) {
    // Inside its own dialog, not on the thread behind it — the thread is
    // about to close, so an error posted there would vanish with it.
    blockError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      t('messaging.menu.failed');
  } finally {
    blockBusy.value = false;
  }
}

// ── Blocked members ──────────────────────────────────────────────────
interface BlockedMember {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
}
const blocksOpen = ref(false);
const blocks = ref<BlockedMember[]>([]);
const blocksLoading = ref(false);
const unblocking = ref<string | null>(null);

async function loadBlocks() {
  blocksLoading.value = true;
  try {
    const data = await $fetch<{ blocks: BlockedMember[] }>('/api/messaging/blocks');
    blocks.value = data.blocks ?? [];
  } catch {
    blocks.value = [];
  } finally {
    blocksLoading.value = false;
  }
}

async function openBlocks() {
  blocksOpen.value = true;
  await loadBlocks();
}

/*
 * Fetched once on arrival, not only when the dialog opens, so the foot of
 * the list can carry the count. A block you set months ago and forgot is
 * exactly the one worth being reminded of, and a link with no number
 * gives no reason to ever open it.
 */
onMounted(loadBlocks);

/**
 * Lift a block. The shared conversation comes back as a request rather
 * than an active thread — unblocking is not the same as agreeing to talk
 * again — so the list is reloaded to show it where it actually landed.
 */
async function unblock(username: string) {
  unblocking.value = username;
  try {
    await $fetch(`/api/messaging/blocks/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    });
    blocks.value = blocks.value.filter((b) => b.username !== username);
    await loadList();
    say(t('messaging.blocks.lifted', { name: username }));
  } catch (err) {
    say(
      (err as { data?: { message?: string } })?.data?.message ??
        t('messaging.menu.failed'),
      'warn'
    );
  } finally {
    unblocking.value = null;
  }
}

/**
 * What the report slip shows in its target row: the line being reported,
 * as the reporter reads it. The label never leaves the browser — only
 * the reason and the details are posted — so showing decrypted text here
 * hands nothing to the server.
 */
const reportLabel = computed(() => {
  const msg = reportTarget.value;
  if (!msg) return '';
  return (msg.body ?? '').slice(0, 80);
});

/**
 * And the part the reporter cannot guess: in an encrypted conversation
 * the server holds ciphertext and no key, so the staff will open this
 * report and see nothing. Whatever they are meant to act on has to be
 * typed into the details box — said here, while the box is still open.
 */
const reportCaveat = computed(() =>
  reportTarget.value?.cipher ? t('messaging.report.encrypted') : undefined
);

/*
 * The slip raises its own global toast on success, so this only has to
 * close it. A second confirmation of the same act is noise.
 */
function onReported() {
  reportTarget.value = null;
}

/** Leave the thread, keeping what was typed in it. */
function closeThread() {
  stashDraft();
  activeId.value = null;
}

/** A short-lived confirmation. Silent success reads as nothing happened. */
const notice = ref('');
const noticeKind = ref<'ok' | 'warn'>('ok');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Say it, and say which of the two things it is.
 *
 * The timer is restarted rather than stacked: two confirmations a second
 * apart used to share the first one's four seconds, so the second was cut
 * short. And it is set here rather than in a watcher, because a watcher
 * does not fire when the same sentence is said twice — unblocking two
 * people in a row showed one confirmation.
 */
function say(text: string, kind: 'ok' | 'warn' = 'ok') {
  noticeKind.value = kind;
  notice.value = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ''), 4000);
}

// ── Search ───────────────────────────────────────────────────────────
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchTicket = 0;

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
}

function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchQuery.value = '';
  searchResults.value = [];
  searchSkipped.value = false;
  searching.value = false;
}

async function runSearch() {
  const q = searchQuery.value.trim();
  // The route asks for two characters. Below that this would be a request
  // per keystroke returning most of the inbox.
  if (q.length < 2) {
    searchResults.value = [];
    searchSkipped.value = false;
    searching.value = false;
    return;
  }
  const ticket = ++searchTicket;
  searching.value = true;
  try {
    const res = await $fetch<{ results: SearchHit[]; skippedEncrypted: boolean }>(
      '/api/messaging/search',
      { query: { q } }
    );
    if (ticket !== searchTicket) return;
    searchResults.value = res.results ?? [];
    searchSkipped.value = !!res.skippedEncrypted;
  } catch {
    if (ticket !== searchTicket) return;
    searchResults.value = [];
    searchSkipped.value = false;
  } finally {
    if (ticket === searchTicket) searching.value = false;
  }
}

/**
 * Jump from a hit to the conversation that holds it.
 *
 * Search deliberately reaches into archived conversations — filing
 * something away is not a reason to stop being able to find it — so the
 * hit may name a thread that is in neither live list. Switching the view
 * is the whole point of the jump; without it the result was a row that
 * looked clickable and did nothing.
 */
async function openFromSearch(hit: SearchHit) {
  let conv = conversationById(hit.conversationId);
  if (!conv) {
    // Look on the shelf without moving there yet. Switching first meant
    // that a hit which could not be resolved at all — a conversation past
    // the list route's 200-row cap — left the reader in an archive they
    // never asked for, with `?v=archived` in the URL.
    const wasView = view.value;
    view.value = 'archived';
    tab.value = 'inbox';
    await loadList();
    conv = conversationById(hit.conversationId);
    if (!conv) {
      view.value = wasView;
      await loadList();
      return;
    }
    void router.replace({ query: { ...route.query, v: 'archived' } });
  } else if (view.value === 'live') {
    tab.value = conv.state === 'pending' ? 'requests' : 'inbox';
  }
  clearSearch();
  await open(conv);
}

// ── Live delivery ────────────────────────────────────────────────────
//
// Everything above works without this. That is not an accident: the relay
// is a separate process, and a page that only functioned while a socket
// was open would have no answer for the socket being shut.

const { connected, needsReload } = useMessagingStream({
  onMessages: async (incoming) => {
  for (const msg of incoming) {
    if (msg.conversationId === activeId.value) {
      if (messages.value.some((m) => m.id === msg.id)) continue;
      // A message I just sent comes back through my own channel too — I am
      // a participant — and the optimistic row does not carry the server's
      // id until the POST resolves. The echo can win that race, and then
      // the message appears twice: once as I typed it, once as ciphertext
      // I have to wait for a reload to read. My own messages are already
      // on screen, so an echo arriving mid-send is simply dropped.
      if (msg.authorId === user.value?.id && sending.value > 0) continue;

      // Decrypted here, not only in `loadThread`. Without this every
      // message arriving live in an encrypted conversation rendered as
      // unreadable until the page was reloaded — mine and my
      // correspondent's alike.
      const body =
        msg.cipher && msg.iv
          ? await convCrypto.decrypt({ cipher: msg.cipher, iv: msg.iv })
          : msg.body;

      messages.value = [
        ...messages.value,
        {
          id: msg.id,
          body,
          cipher: msg.cipher,
          // The nonce travels with the ciphertext. Dropped here, a row
          // that arrived live could never be decrypted a second time —
          // `loadThread` keys its re-decrypt on `cipher && iv`.
          iv: msg.iv ?? null,
          deleted: false,
          createdAt: msg.createdAt,
          author: msg.authorId
            ? { id: msg.authorId, username: '', displayName: null }
            : null,
          mine: msg.authorId === user.value?.id,
        },
      ];
      void nextTick(scrollToEnd);
      // It has just come off the shelf, server-side. Without this the
      // thread you are reading keeps its "filed away, read-only" panel
      // while the server would accept a reply, and the row stays under
      // Archived until a reload.
      if (archived.value.some((c) => c.id === msg.conversationId)) {
        archived.value = archived.value.filter((c) => c.id !== msg.conversationId);
        view.value = 'live';
        tab.value = 'inbox';
        void router.replace({ query: { ...route.query, v: undefined } });
        void refreshList();
      }
      continue;
    }
    // For any other conversation, the counter is the notification. Nudging
    // it locally avoids a round trip per arriving message — the list is
    // reconciled on the next real load anyway.
    const row = conversationById(msg.conversationId);
    if (!row) {
      void refreshList(); // one we did not know about yet
      if (view.value === 'archived') void loadList();
    } else if (archived.value.some((c) => c.id === row.id)) {
      // It was on the shelf, and the server has just taken it off:
      // something arriving is exactly what un-archiving is for. Drop it
      // here and let the live list pick it up where it now belongs.
      archived.value = archived.value.filter((c) => c.id !== row.id);
      void refreshList();
    } else {
      row.unreadCount += 1;
    }
    }
  },
  // Reactions and edits are not messages: they carry no unread, do not
  // scroll the thread, and belong to a row that is already on screen.
  // Routing them through `onMessages` would make each one look like an
  // arrival.
  onFrame: (frame) => {
    if (frame.conversationId !== activeId.value) return;
    if (frame.type === 'reaction') {
      const row = messages.value.find((m) => m.id === frame.messageId);
      // The reactor applied it optimistically already; the echo would
      // count it a second time.
      if (row && frame.userId !== user.value?.id) {
        applyReactionDelta(row, frame.key, frame.delta);
      }
      return;
    }
    if (frame.type === 'edit') {
      const row = messages.value.find((m) => m.id === frame.messageId);
      if (row) {
        row.body = frame.body;
        row.cipher = frame.cipher;
        row.editedAt = frame.editedAt;
      }
    }
  },
});

// Past the catch-up cap the view is cheaper to rebuild than to patch.
watch(needsReload, async (needed) => {
  if (!needed) return;
  await loadList();
  if (activeId.value) await loadThread();
});

onMounted(refreshIdentity);
onMounted(loadDrafts);

/**
 * Come back to where the URL says the reader was: the view, then the
 * conversation.
 *
 * A stale id — blocked, or belonging to somebody else's session — is
 * simply not in either list, and opens nothing rather than a thread with
 * no header and no way back. An archived one IS found, because the
 * archived view is fetched before giving up: a link to a filed
 * conversation that silently opens nothing is indistinguishable from a
 * broken one.
 */
onMounted(async () => {
  const wanted = typeof route.query.c === 'string' ? route.query.c : null;

  if (route.query.v === 'archived') {
    view.value = 'archived';
    tab.value = 'inbox';
    await loadList();
  }
  // The live lists are fetched with `useFetch` awaited in setup, so they
  // are already here — no waiting, and no promise to invent.
  if (wanted && !conversationById(wanted) && view.value === 'live') {
    view.value = 'archived';
    tab.value = 'inbox';
    await loadList();
  }

  // Where it actually is decides the view, not what the URL remembered.
  // A message arriving takes a conversation off the shelf, so a link
  // saved yesterday can name a thread that is no longer filed away —
  // and opening it under the archived view would show it frozen and
  // sitting in a list that does not contain it.
  const filed = !!wanted && archived.value.some((c) => c.id === wanted);
  const conv = wanted ? conversationById(wanted) : null;
  if (view.value === 'archived' && wanted && !filed) {
    view.value = 'live';
    void router.replace({ query: { ...route.query, v: undefined } });
    await loadList();
  }

  if (!conv) {
    // A stale id — blocked, or from somebody else's session. Opens
    // nothing rather than a thread with no header and no way back.
    if (!wanted) return;
    void router.replace({ query: { ...route.query, c: undefined } });
    return;
  }
  if (view.value === 'live') {
    tab.value = conv.state === 'pending' ? 'requests' : 'inbox';
  }
  await open(conv);
});

/*
 * And out of the URL when the pane closes — by the back button, by
 * archiving, by blocking. Left behind, `?c=` reopens on reload a thread
 * the reader had just closed, or sends them into the archive to find a
 * conversation they filed away.
 */
watch(activeId, (id) => {
  if (id || !route.query.c) return;
  void router.replace({ query: { ...route.query, c: undefined } });
});

// Send whatever is in the box to its conversation before the tab goes.
onBeforeUnmount(stashDraft);

async function open(conv: Conversation) {
  // The draft belongs to the conversation it was written in. Kept in one
  // map rather than a single ref: with a single ref, half a message to
  // one member followed you into the next thread and was sent to
  // somebody else.
  stashDraft();
  clearContext();

  activeId.value = conv.id;
  draft.value = drafts.value[conv.id] ?? '';
  messages.value = [];
  nextBefore.value = null;

  // In the URL, so a reload comes back to the thread that was open
  // rather than to an empty pane — and so a conversation can be linked
  // to at all.
  void router.replace({ query: { ...route.query, c: conv.id } });

  await loadThread();
  // Not while it is still a request. Opening one used to post a read
  // receipt to somebody you have not accepted — the exact thing the
  // first-contact queue exists to withhold, and what Signal spells out
  // to the recipient: they do not know you have seen it until you
  // accept. Accepting, or replying, marks it read.
  if (conv.state !== 'pending') markRead(conv);
}

/**
 * Drafts, per conversation, surviving a reload.
 *
 * `localStorage` because a draft is a per-device convenience: it belongs
 * to the browser somebody was typing in, not to the account. Wrapped
 * because a private window or blocked site data makes the accessor
 * itself throw.
 */
const DRAFTS_KEY = 'trackarr:message-drafts';
const drafts = ref<Record<string, string>>({});

function loadDrafts() {
  try {
    drafts.value = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}');
  } catch {
    drafts.value = {};
  }
}

function persistDrafts() {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.value));
  } catch {
    // Nothing to do and nothing worth saying: the draft simply will not
    // outlive the tab.
  }
}

/** Park the current draft under the conversation it was written in. */
function stashDraft() {
  const id = activeId.value;
  if (!id) return;
  // An edit in progress is not a draft. `beginEdit` puts the existing
  // message body into the composer; stashing it here filed that body
  // under the conversation, and reopening the thread pre-filled the box
  // with text that Send would post a SECOND time.
  if (editing.value) return;
  const text = draft.value.trim();
  if (text) drafts.value[id] = draft.value;
  else delete drafts.value[id];
  persistDrafts();
}

// Typing is frequent and writing to localStorage on every keystroke is
// wasteful; once a second is imperceptible and survives a reload.
let draftTimer: ReturnType<typeof setTimeout> | null = null;
watch(draft, () => {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(stashDraft, 1000);
});

/**
 * Marking read is grouped, never one call per message seen.
 *
 * At ten thousand people online that difference is the whole write budget
 * of the feature — reading would cost more than sending. At most one call
 * every five seconds per conversation, plus one when the tab loses focus,
 * which is the moment somebody stops reading and the one worth catching.
 */
const READ_DEBOUNCE_MS = 5_000;
let lastMarked = 0;
let markTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * One timer, so a pending mark has to be flushed before it is replaced.
 *
 * It used to be cancelled outright: opening A, B and C inside the debounce
 * window zeroed B's badge locally and never told the server, so B came
 * back unread on the next reload. The debounce exists to stop a burst of
 * requests, not to drop the middle one.
 */
let pendingRead: (() => Promise<void>) | null = null;

function markRead(conv: Conversation, immediate = false) {
  conv.unreadCount = 0;
  const id = conv.id;
  const send = async () => {
    lastMarked = Date.now();
    pendingRead = null;
    await $fetch(`/api/messaging/conversations/${id}/read`, {
      method: 'POST',
    }).catch(() => undefined);
  };
  clearTimeout(markTimer);
  // Whatever was waiting goes out now rather than being thrown away.
  if (pendingRead) void pendingRead();
  if (immediate || Date.now() - lastMarked > READ_DEBOUNCE_MS) {
    void send();
    return;
  }
  pendingRead = send;
  markTimer = setTimeout(send, READ_DEBOUNCE_MS);
}

if (import.meta.client) {
  const onHidden = () => {
    if (document.visibilityState === 'hidden' && active.value) {
      markRead(active.value, true);
    }
  };
  onMounted(() => document.addEventListener('visibilitychange', onHidden));
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onHidden);
    clearTimeout(markTimer);
  });
}

async function loadThread(before?: string) {
  const data = await $fetch<{ messages: ThreadMessage[]; nextBefore: string | null }>(
    `/api/messaging/conversations/${activeId.value}/messages`,
    { query: before ? { before } : undefined }
  );
  // The API answers newest-first for the cursor to work; the thread reads
  // oldest-first.
  let page = [...data.messages].reverse().map((m) => ({
    ...m,
    mine: m.author?.id === user.value?.id,
  }));

  if (active.value?.encrypted) {
    // No probe any more. Testing "can this browser read the thread" by
    // decrypting its newest ciphertext is right on a second device and
    // wrong straight after a deliberate rotation: the old messages can
    // never open again, so the state stayed `foreign` for ever and the
    // one action offered to escape it did not. The composable compares
    // published keys instead; unreadable history is rendered per
    // message, which is where it belongs.

    if (!before) {
      const peer = active.value.with?.username
        ? await $fetch<{ available: boolean; publicKey?: string }>(
            `/api/messaging/keys/${encodeURIComponent(active.value.with.username)}`
          ).catch(() => ({ available: false }) as const)
        : ({ available: false } as const);

      await convCrypto.prepare({
        encrypted: true,
        conversationId: activeId.value!,
        peerPublicKey: 'publicKey' in peer ? peer.publicKey : null,
      });
    }

    page = await Promise.all(
      page.map(async (m) =>
        m.cipher && m.iv
          ? {
              ...m,
              body: await convCrypto.decrypt({ cipher: m.cipher, iv: m.iv }),
            }
          : m
      )
    );
  }

  messages.value = before ? [...page, ...messages.value] : page;
  nextBefore.value = data.nextBefore;
  if (!before) await nextTick(scrollToEnd);
}

async function loadOlder() {
  if (!nextBefore.value || loadingOlder.value) return;
  loadingOlder.value = true;
  try {
    await loadThread(nextBefore.value);
  } finally {
    loadingOlder.value = false;
  }
}

function scrollToEnd() {
  const el = scrollerRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function send() {
  if (editing.value) return submitEdit();
  const body = draft.value.trim();
  if (!body || !activeId.value) return;

  /*
   * This used to read `|| active.value?.encrypted` and return.
   *
   * A leftover from before the composer could seal anything: it refused
   * every encrypted conversation, silently, with a bare `return` — you
   * typed, pressed send, and nothing happened, with nothing in the
   * console to say why. `deliver()` has sealed the payload since
   * encryption landed, so the guard was not protecting anything.
   *
   * What is worth refusing is sending without a usable key, which would
   * seal to nothing the correspondent can open. The composer is only
   * rendered once the state is `ready`, so this is belt and braces —
   * and it says so instead of returning quietly.
   */
  if (active.value?.encrypted && cryptoState.value !== 'ready') {
    sendError.value = t('messaging.crypto.notReady');
    return;
  }
  sendError.value = '';
  draft.value = '';
  // Sent is not drafted. Left behind, the text came back the next time
  // the conversation was opened, next to the message it had become.
  if (activeId.value) {
    delete drafts.value[activeId.value];
    persistDrafts();
  }
  const answering = replyTo.value;
  replyTo.value = null;

  // Optimistic: the row appears now and carries its own failure state, so
  // a slow round trip reads as sent rather than as the page hanging.
  const pending: ThreadMessage = {
    id: `pending-${Date.now()}`,
    body,
    cipher: null,
    iv: null,
    deleted: false,
    createdAt: new Date().toISOString(),
    author: user.value
      ? { id: user.value.id, username: user.value.username, displayName: user.value.displayName }
      : null,
    mine: true,
    replyTo: answering
      ? {
          id: answering.id,
          author: answering.author?.username ?? null,
          preview: (answering.body ?? '').slice(0, 140),
        }
      : null,
  };
  messages.value = [...messages.value, pending];
  await nextTick(scrollToEnd);
  await deliver(pending);
}

async function deliver(pending: ThreadMessage) {
  // Pinned at the start, never re-read.
  //
  // Sealing an encrypted message is an `await`, and `activeId` can change
  // during it: the URL was built from `activeId.value` AFTER the seal, so
  // switching threads mid-send posted one conversation's ciphertext into
  // another. The failure path had the mirror bug — it looked the message
  // up in `messages.value`, which `open()` had already replaced, so a
  // send that failed after a switch left no trace at all.
  const conversationId = activeId.value;
  const thread = messages.value;
  if (!conversationId) return;
  sending.value += 1;
  try {
    // Sealed here, never on the server — which is the whole point: the
    // API stores bytes it cannot read, and the row it writes carries no
    // plaintext at all.
    const payload = active.value?.encrypted
      ? await convCrypto.encrypt(pending.body ?? '')
      : { body: pending.body };

    const res = await $fetch<{ id: string; createdAt: string }>(
      `/api/messaging/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: { ...payload, replyToId: pending.replyTo?.id },
      }
    );
    const row = thread.find((m) => m.id === pending.id);
    if (row) {
      row.id = res.id;
      row.createdAt = res.createdAt;
      row.failed = false;
      // The ciphertext too, not only the id.
      //
      // The optimistic row is built from what was typed: a body, and no
      // cipher — which is exactly the shape of a line the server CAN
      // read, so the thread marked every message you sent as "not
      // encrypted" until a reload replaced it with the real row. The row
      // now says what was actually stored.
      if ('cipher' in payload) {
        row.cipher = payload.cipher;
        row.iv = payload.iv;
      }
    }
    if (active.value?.state === 'pending') {
      // Replying accepts, so the conversation has just moved to the
      // inbox. Follow it, the way `accept()` does — otherwise the reader
      // is left on a Requests tab that has gone empty underneath them.
      await loadList();
      tab.value = 'inbox';
    }
  } catch {
    const row = thread.find((m) => m.id === pending.id);
    if (row) row.failed = true;
  } finally {
    sending.value -= 1;
  }
}

function retry(msg: ThreadMessage) {
  msg.failed = false;
  void deliver(msg);
}

const isStaff = computed(
  () =>
    !!(user.value as { isAdmin?: boolean; isModerator?: boolean } | null)
      ?.isAdmin ||
    !!(user.value as { isModerator?: boolean } | null)?.isModerator
);

/**
 * Withdraw a message. The row survives, blanked — the thread stays
 * coherent and a report still has something to point at.
 */
async function removeMessage(msg: ThreadMessage) {
  const previousBody = msg.body;
  const previousCipher = msg.cipher;
  msg.deleted = true;
  msg.body = null;
  msg.cipher = null;
  try {
    await $fetch(
      `/api/messaging/conversations/${activeId.value}/messages/${msg.id}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    msg.deleted = false;
    msg.body = previousBody;
    msg.cipher = previousCipher;
    // The toast, not `sendError`: withdrawing is reachable from threads
    // that have no composer to show it in.
    say(
      (err as { data?: { message?: string } })?.data?.message ??
        t('messaging.removeFailed'),
      'warn'
    );
  }
}

/** Toggle one reaction on one message. */
function react(msg: ThreadMessage, key: string) {
  void toggleReaction(
    `/api/messaging/conversations/${activeId.value}/messages/${msg.id}/reactions`,
    msg,
    key
  );
}

function startReply(msg: ThreadMessage) {
  // Mutually exclusive with an edit: the composer can only be doing one
  // of the two, and leaving both set would send the edit as a reply.
  editing.value = null;
  replyTo.value = msg;
  // The point of clicking reply is to type. Landing the caret saves a
  // second click and tells the user the banner is about the field below.
  void nextTick(() => {
    document.querySelector<HTMLTextAreaElement>('.msg-input')?.focus();
  });
}

function beginEdit(msg: ThreadMessage) {
  replyTo.value = null;
  editing.value = msg;
  draft.value = msg.body ?? '';
  void nextTick(() => {
    const el = document.querySelector<HTMLTextAreaElement>('.msg-input');
    el?.focus();
    // Caret at the end, not selecting everything: an edit is usually a
    // small correction, and a full selection makes the next keystroke
    // delete the message.
    el?.setSelectionRange(el.value.length, el.value.length);
  });
}

function clearContext() {
  // Leaving an edit puts the draft back where it was, rather than keeping
  // the half-rewritten text in a box that now sends a NEW message.
  if (editing.value) draft.value = '';
  editing.value = null;
  replyTo.value = null;
}

/** Scroll a quoted message into view and mark it, briefly. */
function jumpTo(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('msg-flash');
  setTimeout(() => el.classList.remove('msg-flash'), 1200);
}

async function submitEdit() {
  const target = editing.value;
  const body = draft.value.trim();
  if (!target || !body) return;
  const previous = target.body;
  const previousEditedAt = target.editedAt ?? null;
  // Optimistic, like the send: the correction shows immediately and is
  // put back if the server refuses it.
  target.body = body;
  target.editedAt = new Date().toISOString();
  draft.value = '';
  editing.value = null;
  try {
    // Sealed here for an encrypted conversation, exactly as a new message
    // is. Without it the edit button had to be hidden there — the route
    // accepts a correction it would never receive, and the one surface
    // that could send it refused to.
    const payload = active.value?.encrypted
      ? await convCrypto.encrypt(body)
      : { body };
    await $fetch(
      `/api/messaging/conversations/${activeId.value}/messages/${target.id}`,
      { method: 'PATCH', body: payload }
    );
  } catch (err) {
    target.body = previous;
    // Back to what it was, which is not necessarily "never edited": a
    // message edited yesterday kept its mark, and a failed edit today
    // used to erase it.
    target.editedAt = previousEditedAt;
    sendError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      t('messaging.editFailed');
  }
}

async function accept() {
  const id = activeId.value;
  if (!id) return;
  try {
    await $fetch(`/api/messaging/conversations/${id}/accept`, { method: 'POST' });
  } catch (err) {
    // It had none: a refusal was an unhandled rejection and the button
    // simply did nothing.
    say(
      (err as { data?: { message?: string } })?.data?.message ??
        t('messaging.menu.failed'),
      'warn'
    );
    return;
  }
  await loadList();
  // The conversation has moved to the inbox, so the view follows it.
  // Reloading the list alone left the reader on the Requests tab looking
  // at a list the thread was no longer in, with no way to tell whether
  // anything had happened.
  tab.value = 'inbox';
  activeId.value = id;
}

async function startConversation() {
  startError.value = '';
  try {
    // Generated now, because now is when the member has read what it
    // means and ticked the box — never on a page load, which on a second
    // device would silently break their other conversations.
    if (startEncrypted.value && peerHasKey.value) {
      if (!(await convCrypto.ensureIdentity())) {
        await convCrypto.generateAndPublish(navigator.userAgent.slice(0, 60));
      }
    }
    const res = await $fetch<{ id: string }>('/api/messaging/conversations', {
      method: 'POST',
      body: {
        username: startWith.value.trim(),
        encrypted: startEncrypted.value && peerHasKey.value,
      },
    });
    startOpen.value = false;
    startWith.value = '';
    // A brand-new conversation is never on the shelf, so the archived
    // view could not contain it: `loadList()` there fetched the archive
    // and found nothing, and the dialog closed onto an unchanged list
    // with no thread and no error.
    view.value = 'live';
    tab.value = 'inbox';
    void router.replace({ query: { ...route.query, v: undefined } });
    await loadList();
    const conv = conversationById(res.id);
    if (conv) await open(conv);
  } catch (err) {
    startError.value =
      (err as { data?: { message?: string } })?.data?.message ?? String(err);
  }
}

</script>

<style scoped>
/* Mobile-first, and it has to stay that way: a media query adds no
   specificity, so between two rules of equal weight the last one wins.
   Below md the two panes are one column and `.msg-hide-mobile` picks
   which of them is on screen; above md both are always shown, so the
   class has nothing left to hide. */
.msg-shell {
  /* Anchors the confirmation line above both panes. */
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 60vh;
}

.msg-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.msg-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.msg-new,
.msg-back,
.msg-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 44px on a phone: the floor Apple states and Material rounds up. */
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.msg-section {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.msg-section-title {
  padding: 0 0.25rem 0.25rem;
}

.msg-hint {
  padding: 0.5rem 0.25rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

/* ── Quick access ─────────────────────────────────────────────────── */
.msg-quick {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem;
  margin: 0 0.5rem 0.25rem;
  border-radius: var(--radius-md);
  color: rgb(var(--fg-default));
  text-decoration: none;
  transition: background var(--dur-2) ease;
}
.msg-quick:hover { background: rgb(var(--fg-default) / 0.06); }
.msg-quick-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  border-radius: var(--radius-md);
  background: rgb(var(--accent-warm) / 0.16);
  color: rgb(var(--accent-warm));
  font-size: 1.05rem;
}
.msg-quick-text { display: flex; flex-direction: column; min-width: 0; }
.msg-quick-name { font-size: 0.875rem; font-weight: 600; }
.msg-quick-sub {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
}

/* ── Tabs ─────────────────────────────────────────────────────────── */
.msg-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  margin: 0.25rem 0.5rem 0.5rem;
  border-radius: var(--radius-md);
  background: rgb(var(--fg-default) / 0.05);
}
.msg-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  /* 44px: this is the control that switches the whole list. */
  min-height: 2.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-2) ease, color var(--dur-2) ease;
}
.msg-tab:hover { color: rgb(var(--fg-default)); }
.msg-tab--on {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-strong));
}
.msg-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.25rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--accent-warm));
  color: rgb(var(--bg-base));
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 800;
}

/* ── Rows ─────────────────────────────────────────────────────────── */
.msg-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  /* Two lines of content, so the row is taller than it was — and past
     the 44px touch minimum without needing padding to get there. */
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: rgb(var(--fg-default));
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-2) ease;
}
.msg-row:hover { background: rgb(var(--fg-default) / 0.05); }
.msg-row--on { background: rgb(var(--fg-default) / 0.09); }

.msg-row-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-default) / 0.1);
  color: rgb(var(--fg-default));
  font-size: 0.8rem;
  font-weight: 700;
}

.msg-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.msg-row-top {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.msg-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 600;
}
.msg-row-time {
  flex: none;
  /* Tabular figures: without them the column jitters as the numbers
     change width, on a row that is already busy. */
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.65rem;
  color: rgb(var(--fg-muted));
}
.msg-row-preview {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}

.msg-row-lock {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .msg-quick,
  .msg-tab,
  .msg-row { transition: none; }
}

.msg-badge {
  flex-shrink: 0;
  min-width: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 9999px;
  /* Carried in CSS now: the row used to get its colour from a Tailwind
     `bg-accent` utility in the template, which the rewrite dropped —
     leaving a badge with a foreground colour and no ground. */
  background: rgb(var(--accent-warm));
  color: rgb(var(--bg-base));
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1.25rem;
  text-align: center;
}

.msg-thread {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
}

/* Declared AFTER `.msg-list` and `.msg-thread`, which both set `display`.
   A scoped selector carries `[data-v-…]`, so all three weigh the same and
   source order is what decides — put this first and it silently loses,
   which is how both panes ended up on screen at once on a phone. */
.msg-hide-mobile {
  display: none;
}

.msg-thread-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid rgb(var(--line-default));
}

.msg-thread-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}

.msg-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}

.msg-scroller {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  overflow-y: auto;
  max-height: 60vh;
  /* Extra room at the top. The hover toolbar sits ABOVE its bubble, and
     `overflow-y: auto` clips whatever leaves the box — so on the first
     message it was cut in half by the header. The padding gives it
     somewhere to be. */
  padding: 1.5rem 0.75rem 0.75rem;
}

.msg-older {
  align-self: center;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}

/* Sender differentiation carries on alignment as well as colour, never on
   colour alone — the same rule the rest of this app follows for state.
 *
 * A COLUMN, not a row. The bubble now has a sibling under it (the
 * reaction strip), and in a row that sibling sat beside the bubble
 * instead of below it. Alignment therefore moves from `justify-content`
 * to `align-items`: on a column the two axes swap, and leaving
 * `justify-content` would have aligned nothing horizontally at all. */
.msg-bubble-row {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.msg-mine {
  align-items: flex-end;
}

.msg-theirs {
  align-items: flex-start;
}

.msg-bubble {
  /* Anchors the floating toolbar. The toolbar is a child but escapes the
     box upward with a negative offset, so it stays glued to the bubble
     whichever side the bubble is on — anchored to the ROW instead, it
     would float at the far edge of the thread. */
  position: relative;
  max-width: min(85%, 34rem);
  padding: 0.5rem 0.6875rem;
  border-width: 1px;
  border-style: solid;
  border-radius: var(--radius-md);
}

.msg-author-link {
  color: inherit;
  text-decoration: none;
}
.msg-author-link:hover { text-decoration: underline; }

.msg-author {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.125rem;
}

.msg-body {
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg-meta {
  margin-top: 0.25rem;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}

.msg-retry {
  margin-left: 0.375rem;
  text-decoration: underline;
  cursor: pointer;
}

.msg-unreadable {
  font-style: italic;
  color: rgb(var(--fg-subtle));
}

.msg-locked {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid rgb(var(--line-default));
}

.msg-locked-title {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-weight: 600;
}

.msg-locked-body {
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

.msg-placeholder {
  padding: 1rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

/* Over both panes, and over the dialogs too — unblocking is confirmed
   from inside one. `notifications: 60` on the app's z-index ladder. */
.msg-notice {
  position: fixed;
  top: 1rem;
  left: 50%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  max-width: min(90%, 28rem);
  padding: 0.45rem 0.85rem;
  transform: translateX(-50%);
  border: 1px solid rgb(var(--online) / 0.4);
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-elevated));
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
  color: rgb(var(--fg-default));
  font-size: 0.78rem;
  pointer-events: none;
}
.msg-notice--warn { border-color: rgb(var(--warning) / 0.5); }
.msg-notice-enter-active,
.msg-notice-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.msg-notice-enter-from,
.msg-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, -0.4rem);
}

/* A column: the reply/edit banner stacks ABOVE the controls. It used to
   be a row, which made the banner a sibling of the textarea and left the
   field it was describing with almost no width. */
.msg-composer {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border-top: 1px solid rgb(var(--line-default));
}
.msg-pending-hint {
  padding: 0.25rem 0.1rem;
  color: rgb(var(--fg-muted));
  font-size: 0.72rem;
}
.msg-send-error {
  padding: 0.25rem 0.1rem;
  color: rgb(var(--danger));
  font-size: 0.72rem;
}
.msg-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.msg-accept {
  padding: 0.6875rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  cursor: pointer;
}

.msg-input {
  flex: 1;
  min-width: 0;
  resize: none;
  padding: 0.6875rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  line-height: 1.4;
}

@media (min-width: 768px) {
  .msg-shell {
    flex-direction: row;
    gap: 1.5rem;
  }

  .msg-list {
    width: 18rem;
    flex-shrink: 0;
  }

  /* Both panes are on screen from here up, so the mobile toggle has to
     stop hiding either of them. */
  .msg-hide-mobile {
    display: flex;
  }

  .msg-row,
  .msg-input,
  .msg-accept {
    padding-top: 0.4375rem;
    padding-bottom: 0.4375rem;
  }

  .msg-new,
  .msg-back,
  .msg-send {
    width: 2.25rem;
    height: 2.25rem;
  }

  .msg-back {
    display: none;
  }
}
/* ── Quote, edit, reactions ───────────────────────────────────────── */
.msg-quote {
  display: flex;
  align-items: flex-start;
  gap: 0.3rem;
  width: 100%;
  margin-bottom: 0.3rem;
  padding: 0.25rem 0.4rem;
  border: 0;
  /* A rail rather than a box: the quote has to read as subordinate to
     the message, and a full border makes it compete with it. */
  border-left: 2px solid rgb(var(--accent-warm) / 0.6);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: rgb(var(--fg-default) / 0.05);
  color: rgb(var(--fg-muted));
  font-size: 0.7rem;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.msg-quote:disabled { cursor: default; opacity: 0.7; }
.msg-quote-icon { flex: none; margin-top: 0.1rem; }
.msg-quote-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.msg-quote-text b { color: rgb(var(--fg-default)); font-weight: 700; }
.msg-quote-gone { font-style: italic; }
.msg-edited { color: rgb(var(--fg-muted)); font-style: italic; }

.msg-actions {
  position: absolute;
  /* Anchored to the bubble's top EDGE, not offset by a guessed number of
     rems. A fixed negative `top` has to guess the toolbar's own height,
     and guessing short leaves it sitting on the first line of the
     message — unreadable and unclickable at once. `bottom: 100%` puts it
     entirely above whatever height it turns out to be; the small
     negative margin pulls it back to overlap the border only. */
  bottom: 100%;
  margin-bottom: -0.5rem;
  right: 0.25rem;
  display: flex;
  gap: 0.15rem;
  padding: 0.15rem;
  /* Its own surface. Floating over the thread background is fine;
     floating over words with no surface is what made it unreadable. */
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-pill);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.28);
  opacity: 0;
  transition: opacity var(--dur-2) ease;
  z-index: 2;
}
.msg-bubble-row:hover .msg-actions,
.msg-actions:focus-within { opacity: 1; }

/* No hover, no discovery. On a touch screen the toolbar is simply
   there — `hover-vs-tap`: an action that exists only on hover does not
   exist on a phone. */
@media (hover: none) {
  .msg-actions { opacity: 1; }
}

.msg-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 28px visual, 44px hit area via the padding on .msg-actions plus
     this — small enough not to dominate a one-line message. */
  width: 1.75rem;
  height: 1.75rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.9rem;
  cursor: pointer;
  transition: color var(--dur-2) ease, background var(--dur-2) ease;
}
.msg-action:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.1);
}
/* Destructive, and coloured like it — and last in the row, so it is not
   the button next to the one you meant. */
.msg-action--danger:hover {
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.12);
}
@media (prefers-reduced-motion: reduce) {
  .msg-action { transition: none; }
}

.msg-context {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.3rem 0.5rem;
  margin-bottom: 0.35rem;
  border-left: 2px solid rgb(var(--accent-warm));
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: rgb(var(--fg-default) / 0.06);
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
}
.msg-context-icon { flex: none; }
.msg-context-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-context-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border: 0;
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.msg-context-clear:hover { color: rgb(var(--fg-strong)); }

/* Marks the message a quote jumped to. Long enough to find it, short
   enough not to linger as decoration. */
.msg-flash .msg-bubble {
  animation: msg-flash 1.2s ease-out;
}
@keyframes msg-flash {
  0%, 40% { background: rgb(var(--accent-warm) / 0.22); }
  100% { background: inherit; }
}
@media (prefers-reduced-motion: reduce) {
  .msg-actions { transition: none; }
  .msg-flash .msg-bubble { animation: none; }
}
/* ── The foot of the list: blocks ─────────────────────────────────── */
.msg-list-foot {
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: 1px solid rgb(var(--line));
}
.msg-foot-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  min-height: 2.25rem;
  padding: 0 0.5rem;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.78rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.msg-foot-link:hover {
  background: rgb(var(--fg-default) / 0.06);
  color: rgb(var(--fg-default));
}
.msg-foot-count {
  margin-left: auto;
  padding: 0 0.4rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-default) / 0.1);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}

.msg-blocks {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 18rem;
  overflow-y: auto;
}
.msg-blocks-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.25rem;
}
.msg-blocks-who {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  min-width: 0;
  padding: 0.2rem;
  margin: -0.2rem;
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
  transition: background var(--dur-2) ease;
}
.msg-blocks-who:hover { background: rgb(var(--fg-default) / 0.06); }
.msg-blocks-who:hover .msg-blocks-name { text-decoration: underline; }
.msg-blocks-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.msg-blocks-name {
  font-size: 0.85rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-blocks-since {
  color: rgb(var(--fg-muted));
  font-size: 0.72rem;
}

/* Destructive, and coloured like it — the only red button on the page. */
.msg-btn-danger {
  border-color: rgb(var(--danger) / 0.5);
  color: rgb(var(--danger));
}
.msg-btn-danger:hover:not(:disabled) {
  background: rgb(var(--danger) / 0.12);
  border-color: rgb(var(--danger));
}
.msg-clear {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: rgb(var(--warning));
}
/* ── Search ───────────────────────────────────────────────────────────
   It shipped with no rules whatsoever: a bare browser input with the
   magnifier stacked above it and the UA's own search decorations. The
   field lines up with the tabs below — same margin, same radius, same
   height — because two controls at the top of a column that do not share
   an edge read as two accidents. */
.msg-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0.5rem;
  padding: 0 0.6rem;
  min-height: 2.25rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--fg-default) / 0.05);
  color: rgb(var(--fg-muted));
  cursor: text;
  transition: border-color var(--dur-2) ease, background var(--dur-2) ease;
}
.msg-search:focus-within {
  border-color: rgb(var(--accent));
  background: rgb(var(--bg-elevated));
}
.msg-search-icon {
  flex: none;
  font-size: 0.9rem;
  color: rgb(var(--fg-muted));
}
.msg-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--fg-default));
  /* 16px: anything smaller makes iOS zoom the page on focus. */
  font-size: 1rem;
  line-height: 1.2;
}
@media (min-width: 768px) {
  .msg-search-input { font-size: 0.8125rem; }
}
.msg-search-input:focus { outline: none; }
.msg-search-input::placeholder { color: rgb(var(--fg-muted)); }
/* WebKit draws its own cancel button and magnifier inside type="search";
   both fight the ones above. */
.msg-search-input::-webkit-search-cancel-button,
.msg-search-input::-webkit-search-decoration {
  appearance: none;
}
.msg-search-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.7rem;
  cursor: pointer;
  transition: background var(--dur-2) ease, color var(--dur-2) ease;
}
.msg-search-clear:hover {
  background: rgb(var(--fg-default) / 0.1);
  color: rgb(var(--fg-default));
}
</style>