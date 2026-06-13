# Fédération — cohérence des données : analyse & recommandations

**Date :** 2026-06-13 · **Méthode :** 4 agents de cartographie sur le code réel (api + tracker + db + web), preuves `fichier:ligne`.

## Modèle de conception (confirmé par le code)

trackarr fédère **uniquement des métadonnées + du social**, entre **instances souveraines**. C'est explicite dans le README : *« no SSO, economies stay isolated »*, *« ratio/HnR stay local »*. Concrètement :

- **L'économie est strictement locale** (trafic, ratio, bonus_points, events) — vérifié de bout en bout.
- **Les bans sont strictement locaux** — aucune propagation S2S.
- Le catalogue distant vit dans une table **séparée** `remote_torrents` (jamais fusionnée dans `torrents`), avec des liens de download qui **renvoient vers l'instance d'origine**.

La plupart de tes 6 questions tombent donc dans « correct par conception ». Mais l'analyse a fait ressortir **3 défauts concrets** et **2 manques d'UX/dédup** qui méritent décision.

---

## Scénario 1 — Freeleech / silverleech / events & comptabilisation du trafic

**Comportement actuel (sain par conception).** Le multiplicateur d'event et le crédit de trafic sont **toujours co-localisés sur la même instance** : le tracker Go applique le multiplicateur depuis *son propre* snapshot Redis `bonus:active` (`apps/tracker/internal/bonus/bonus.go:148`, appliqué dans `handler.go:514-522`), puis crédite `users.uploaded/downloaded` **par passkey** (`handler.go:541`, `users.sql.go:39-44`). Or une passkey n'existe que sur l'instance qui l'a émise.

Point clé : pour un torrent fédéré (miroir catalogue), **un utilisateur de l'instance Y ne peut pas l'announce comme un download crédité chez Y** — il n'a ni le `.torrent`, ni de passkey Y pour ce contenu (`catalog.get.ts:126-131` : « a federated peer never gets our `.torrent` bytes, only a link »). Il télécharge sur l'instance d'origine X, avec un compte X, et announce **au tracker de X** → c'est le freeleech **de X** qui s'applique, sur le crédit **de X**.

> **Verdict : aucun problème.** Le freeleech d'une instance ne peut pas affecter la comptabilité d'une autre. Multiplicateur et crédit sont indissociablement locaux.

**Faut-il partager les events ?**

| Option | Pour | Contre | Reco |
|---|---|---|---|
| **Garder local** (actuel) | Aligné avec « economies isolated » ; zéro risque de double-comptage ; chaque opérateur maîtrise sa politique | Un event « réseau » coordonné n'existe pas | ✅ **Garder** |
| Annoncer l'event d'un pair (info only) | Affichage « X est en freeleech » sur le catalogue distant | Purement cosmétique ; n'affecte pas le crédit (qui reste sur X) | Optionnel, faible valeur |
| Freeleech partagé qui crédite cross-instance | — | Exigerait identité/ratio partagés (SSO) — contraire au design ; ouvre double-comptage | ❌ **À éviter** |

---

## Scénario 2 — Une instance bannit un utilisateur

**Comportement actuel.** Strictement local : les 3 chemins qui posent `is_banned` (`admin/users/[id]/ban.post.ts`, `admin/reports/[id].put.ts`, l'unban de `banExpiry.ts`) **n'ont aucune référence fédération**. Aucune table/route S2S ne porte un ban. La couche S2S n'authentifie que **l'instance pair** (`inbound.ts:91-153`), jamais un utilisateur distant individuel.

**Conséquences réelles (à décider) :**
- **Empreinte fédérée persistante d'un banni** : les chemins sortants ne filtrent pas `isBanned`. Le catalogue (`catalog.get.ts:32-85`, expose `uploaderName`), la recherche (`search.get.ts:67-78`), les commentaires (`torrent-comments.get.ts`) et le forum (`forum.get.ts`) continuent de servir le contenu d'un utilisateur banni. → un banni garde torrents, commentaires, posts visibles chez les pairs.
- **Blanchiment de réputation** : le badge « identité vérifiée » + la réputation (ratio/volume) sont **re-fetchés en direct mais sans filtre de ban** (`user-reputation.get.ts`), et le lien est **vérifié une seule fois, jamais revalidé** (pas de colonne d'expiration sur `federated_identities`). Un tricheur banni sur X garde une réputation « saine » affichée sur Y indéfiniment.
- **Bonne nouvelle** : l'identité liée ne confère **aucune autorité d'action** sur Y (aucun code n'autorise une action via `federated_identities`) — ce n'est pas un bypass d'auth, juste un affichage trompeur.

| Option | Pour | Contre | Reco |
|---|---|---|---|
| **Ban purement local** (actuel) | Souveraineté ; pas de confiance transitive ; RGPD-friendly | Réputation blanchie ; contenu d'un banni continue de fédérer | Base correcte, **mais à compléter** |
| **Filtrer les bannis en sortie** | Le catalogue/recherche/commentaires d'un banni cessent de fédérer | Petit coût de jointure | ✅ **Recommandé** (faible risque) |
| **Réputation ban-aware + liveness** | Le badge/réputation reflète le ban d'origine ; revalidation périodique | Un peu de logique S2S | ✅ **Recommandé** (anti-blanchiment) |
| **Propagation de ban (modération fédérée)** | Un mauvais acteur banni partout | Confiance transitive forte ; risque de ban-cascade abusif ; complexe | ⚠️ Optionnel, **opt-in par pair** uniquement |

---

## Scénario 3 — Une IP est bannie

**Comportement actuel.** Aucune propagation fédération (`banned_ips` n'est référencé nulle part dans la fédération). L'enforcement local à l'announce **existe désormais** (`handler.go:295-297` → `IsIpBanned`, ajouté par le commit `9341564` / finding L8).

> **Verdict : pas un problème, et le partage est déconseillé.** Partager des bans d'IP entre opérateurs indépendants = partager des données réseau d'utilisateurs entre organisations distinctes (problème vie privée/RGPD), et une IP partagée (VPN/CGNAT) bannie ailleurs punirait des innocents chez toi.

| Option | Pour | Contre | Reco |
|---|---|---|---|
| **IP ban local** (actuel) | Vie privée ; pas de faux positifs importés | Pas de défense réseau mutualisée | ✅ **Garder** |
| Blocklist partagée opt-in | Défense anti-abus mutualisée | Vie privée ; faux positifs (NAT partagé) | ❌ Sauf besoin fort, opt-in explicite |

---

## Scénario 4 — Recherche multi-instances & API Torznab

**Comportement actuel.**
- **Deux modes de recherche fédérée** : *cache* (`browse.get.ts` lit la table locale `remote_torrents`, peuplée par le cron `catalogSync`) et *live* (`search-live.get.ts` fan-out signé vers chaque pair, agrégé en mémoire, non persisté). L'endpoint entrant `search.get.ts` sert *notre* `torrents` local aux pairs.
- **Torznab & RSS sont strictement LOCAUX** : `torznab/api/index.get.ts` et `rss/*` ne requêtent **que** `schema.torrents` (accepted+active). `remote_torrents` n'est référencé que dans 3 fichiers (catalogSync, browse, remote/[id]) — **zéro** dans torznab/rss.
- **Download d'un résultat fédéré** : **deep-link vers l'origine uniquement**. `remote_torrents` n'a **pas** de colonne `torrentData` — les octets `.torrent` n'existent pas localement ; l'UI n'offre qu'un lien « ouvrir sur la source » (`federated.vue:69-71`). Pas de proxy, pas de download local cassé.

> **Verdict : sain et volontaire.** Torznab local-only = **aucun risque** d'exposer aux *Arr des enclosures non-récupérables. C'est exactement le bon choix.

**Manques (à décider) :**
- **Pas de dédup fédéré↔fédéré** : si X et Y ont la même release, **2 lignes** s'affichent (cache et live). Le content-signature n'est utilisé que pour signaler le recouvrement *local* (`browse.get.ts:100-118`), jamais pour fusionner les copies entre pairs.
- **`remoteDownloadUrl` = donnée morte** : peuplée à chaque sync (`catalogSync.ts:248`) mais **jamais lue** par aucun consommateur.

| Question | Reco |
|---|---|
| Torznab doit-il inclure le fédéré ? | ❌ **Non** — un *Arr ne pourrait pas grabber (pas de passkey d'origine). Garder local-only. |
| Dédup des doublons fédérés | ✅ **Oui** — grouper par `contentSignature`/`infoHash` à travers les pairs, afficher 1 ligne + badges multi-origines |
| `remoteDownloadUrl` | Décider : l'**utiliser** (bouton « télécharger sur l'origine ») ou la **supprimer** (nettoyage) |

---

## Scénario 5 — Une catégorie existe sur une instance mais pas l'autre

**Comportement actuel (problématique).** Modèle **namespace séparé, sans mapping** : `catalogSync` stocke `categorySlug` + `categoryType` en **texte dénormalisé** sur `remote_torrents` (`schema.ts:2198-2199`, `catalogSync.ts:226-227`), **sans FK** vers `categories` locales et **sans résolution**. Le commentaire du schéma `schema.ts:2197` (« Mapped to a local category slug when possible ») décrit un mapping **qui n'existe pas dans le code**.

À l'affichage, sur l'instance Y :
- Le **nom/slug de la catégorie distante n'est jamais affiché** — l'UI ne montre qu'un **glyphe dérivé de `categoryType`** (`federated.vue` / `[id].vue` via `catIcon(categoryType)`), avec une icône fichier générique si `type` est null.
- **Aucun filtre par catégorie** dans le browse fédéré (`browse.get.ts:31-42` ne filtre que sur nom/infoHash/peer).
- 🔴 **La gate adulte n'a aucune contrepartie fédérée** : `remote_torrents` n'a pas de flag `isAdult`, la sortie X ne filtre pas l'adulte, et l'affichage Y ne vérifie pas `showAdultContent`. → **du contenu adulte d'une instance s'affiche chez tous les utilisateurs d'une autre, gate ignorée.** (vs le chemin local qui gate bien : `torrents/index.get.ts:49-55`.)

| Option | Pour | Contre | Reco |
|---|---|---|---|
| **Strings dénormalisés + UI améliorée** | Simple ; afficher le nom de catégorie distant en badge non-filtrable | Pas de filtrage/normalisation cross-instance | ✅ **Court terme** |
| **Mapping via id Newznab** (standard) | Catégories normalisées entre instances (prior art : Newznab/Prowlarr) ; filtrable | Exige une table de mapping + UI opérateur | ✅ **Moyen terme** |
| Mapping slug→slug manuel par pair | Contrôle fin | Fastidieux ; ne scale pas | ⚠️ Fallback |

> 🔴 **Indépendamment du choix de mapping : la gate adulte fédérée est un trou de politique de contenu à corriger** — fédérer un flag `isAdult` (déjà connu via `categories.type`/`isAdult` côté origine) et l'appliquer au browse/detail fédéré.

---

## Scénario 6 — Idem pour les tags

**Comportement actuel.** Tags distants stockés en **tableau de strings `jsonb`** sur `remote_torrents` (`schema.ts:2200`, `catalogSync.ts:231-233`), **jamais** résolus vers les `tags` locaux ni `torrent_tags`, **jamais** re-normalisés (le `releaseTags`/`slugifyTag` local est upload-only). Affichage : chips en lecture seule (`federated.vue:60` slice(0,3)). **Pas de filtre par tag.**

> **Verdict : problème mineur.** Les tags sont folksonomiques par nature ; un namespace de strings est acceptable. Mais deux pairs avec des orthographes différentes (`x265` vs `HEVC`) produisent des strings non-matchables.

| Option | Pour | Contre | Reco |
|---|---|---|---|
| **Strings libres en lecture seule** (actuel) | Simple ; tolérant | Pas de filtrage ; doublons orthographiques | ✅ **Garder**, + normaliser la casse/facettes au sync |
| Mapping vers tags locaux | Filtrable ; vocabulaire unifié | Perte d'info si pas de correspondance ; complexité | ⚠️ Seulement si le filtrage fédéré devient un besoin |

---

## Synthèse — posture de partage recommandée par fonctionnalité

| Donnée / fonction | Actuel | Recommandation |
|---|---|---|
| Trafic / ratio / bonus | Local | ✅ Garder local |
| Bonus events (freeleech…) | Local | ✅ Garder local (affichage info optionnel) |
| Ban utilisateur | Local, **sortie ban-blind** | Garder local **+ filtrer les bannis en sortie + réputation ban-aware/liveness** |
| Ban IP | Local | ✅ Garder local (partage déconseillé) |
| Torznab / RSS | Local-only | ✅ Garder local-only |
| Recherche fédérée | Cache + live, deep-link | ✅ OK **+ dédup cross-pair** |
| Catégories | Strings, **non affichées, gate adulte absente** | **Afficher le nom distant + fédérer `isAdult` (gate)** ; mapping Newznab à moyen terme |
| Tags | Strings opaques | Garder + normaliser au sync |

## Défauts concrets à corriger (indépendants des choix de design)

1. 🔴 **Gate adulte non fédérée** (S5) — contenu adulte affiché à tous sur le fédéré. *Fix :* fédérer `isAdult`, gate au browse/detail.
2. 🟠 **De-trust sans purge** (S2) — `suspend`/`block`/`revoke` via PATCH **ne purge pas** le cache et les chemins de service (`browse.get.ts:65-73`, `me/federated-follows.get.ts`, `remote/[id].get.ts`) **ne filtrent pas le statut du pair** → données d'un pair dé-fédéré servies comme « de confiance ». Contredit le commentaire schéma `schema.ts:2135` (« revoked → purged »). *Fix :* filtrer `peer.status='active'` au service, ou purger sur revoke.
3. 🟠 **Sortie ban-blind** (S2) — catalogue/recherche/commentaires/réputation d'un banni continuent de fédérer. *Fix :* filtre `isBanned` en sortie + revalidation des identités liées.
4. 🟡 **Pas de dédup fédéré↔fédéré** (S4) — doublons affichés. *Fix :* regrouper par content-signature/infoHash.
5. 🟡 **`remoteDownloadUrl` donnée morte** (S4) — à utiliser ou supprimer.

> Ces 5 points sont des **propositions** ; aucun n'est implémenté ici (cadrage « analyse + reco »). Les maquettes frontend (affichage catégorie/tag distants, dédup, gate adulte, badge de pair dé-fédéré) suivent.
