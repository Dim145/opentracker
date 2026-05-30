# Fédération Trackarr — Étude de faisabilité & architecture

> Statut : **proposition de conception** (RFC). Aucun code applicatif n'est encore écrit.
> Concrétise la ligne `Future (v1.x+) — Federation, inter-tracker communication` de la [roadmap](../guide/roadmap.md).
> Cadrage validé : fédération **complète** (catalogue + social + comptes/réputation + swarm), **allow-list contrôlée par l'owner**, **protocole maison Trackarr↔Trackarr**.

---

## 1. TL;DR

Oui, c'est faisable, et le codebase est **bien positionné** : identifiants UUID v4 (pas de collision inter-instances), identité de contenu déjà solide (`info_hash` + `content_signature` + IDs média), table `settings` clé-valeur pour les toggles owner, et des briques de sécurité serveur-à-serveur déjà présentes (`safeFetch` anti-SSRF, `ADMIN_API_KEY`, rate-limit Redis distribué).

La proposition tient en **5 phases** livrables indépendamment, par risque croissant :

| Phase | Axe | Risque | Touche le tracker Go ? |
|---|---|---|---|
| **0** | Socle de confiance (handshake + allow-list + transport signé) | Faible | Non |
| **1** | Catalogue / métadonnées (découverte fédérée) | Faible | Non |
| **2** | Social (commentaires, forum, follows fédérés) | Moyen | Non |
| **3** | Comptes / réputation (identité & ratio portables) | Élevé | Non |
| **4** | Swarm / pairs (cross-announce) | **Très élevé** | **Oui** |

Le découpage permet de livrer de la valeur dès la Phase 1 sans jamais s'engager sur les phases risquées. La Phase 4 (partage de swarm) est en **tension directe avec la nature « privée » du tracker** et fait l'objet d'un avertissement dédié (§7.4).

---

## 2. Objectif & périmètre

Permettre à plusieurs instances Trackarr **indépendantes** de communiquer et de partager leurs données, l'activation et le choix des partenaires étant **décidés par l'owner** de chaque instance.

**Principe fondateur — souveraineté de l'instance.** La fédération n'est jamais subie : chaque instance reste maîtresse de (a) si elle fédère, (b) avec qui, (c) ce qu'elle partage, (d) ce qu'elle accepte. Le lien est **bidirectionnel et à double consentement** (les deux owners doivent accepter).

---

## 3. État des lieux du codebase

### 3.1 Ce qui aide (déjà en place)

| Atout | Où | Pourquoi ça compte |
|---|---|---|
| **UUID v4 partout** | `packages/db/src/schema.ts` | Pas de collision d'ID entre instances — l'obstacle n°1 est déjà levé. |
| **Identité de contenu** | `info_hash` (unique), `content_signature` (SHA-256 des fichiers, déjà calculée pour le cross-seed), IDs média (`imdb_id`/`tmdb_id`/`tvdb_id`/`igdb_id`/`openlibrary_id`) | Reconnaître « le même contenu » d'une instance à l'autre, dédupliquer, fusionner les releases. |
| **Toggles owner** | table `settings` (clé-valeur + invalidation cross-réplica via Redis pub/sub), middleware `admin.ts` | Un `federation_enabled` réservé à l'admin s'y branche sans redéploiement. |
| **HTTP sortant durci** | `apps/api/utils/safeFetch.ts` | Anti-SSRF, revalide chaque redirection — indispensable pour des appels vers des hôtes tiers. |
| **Auth machine-to-machine** | `apps/api/utils/auth.ts` (`ADMIN_API_KEY`), constant-time compare | Base pour l'auth serveur-à-serveur. |
| **Rate-limit distribué** | `apps/api/utils/rateLimit.ts` (Redis sliding windows + pénalités) | Protège les futurs endpoints S2S exposés. |
| **Surfaces machine déjà exposées** | Torznab (`/api/torznab`), RSS (`/api/rss`) | Précédent de sérialisation de catalogue lisible par machine. |
| **Plugin cron de référence** | `apps/api/plugins/bonus-collector.ts` (lock cross-réplica + last-tick persisté) | Patron exact pour le worker de synchronisation fédérée. |
| **Fan-out notifications** | `apps/api/utils/notify.ts` | Réutilisable pour notifier l'owner d'une demande de fédération entrante. |

### 3.2 Ce qui manque (à construire)

- Aucune notion d'**origine/source** sur les entités (pas de `origin_instance`).
- Aucune **communication serveur-à-serveur**, ni endpoint **entrant** destiné à une autre machine (tout est sortant / pull-only).
- Pas d'**identité d'instance** ni d'**identité d'utilisateur globale** (`passkey` et `username` sont scoppés par instance).
- Pas de **signature de requêtes** asymétrique (seul un secret partagé `ADMIN_API_KEY` existe).

---

## 4. Principes directeurs

1. **Opt-in owner, par défaut OFF.** `federation_enabled = false` à l'installation.
2. **Allow-list explicite.** Aucune instance inconnue ne peut lire ou pousser quoi que ce soit. Pas de découverte automatique, pas de confiance transitive (« l'ami de mon ami » n'est pas mon ami).
3. **Double consentement.** Un lien n'est `active` que si les deux owners l'ont approuvé.
4. **Scopes granulaires et asymétriques.** Pour chaque pair, l'owner choisit séparément ce qu'il *partage avec* lui et ce qu'il *accepte de* lui, parmi `catalog` / `social` / `accounts` / `swarm`.
5. **Révocable et auditable à tout moment.** Couper un lien purge les données distantes mises en cache et invalide les clés.
6. **Le tracker (hot path) reste intact** jusqu'à la Phase 4. La fédération vit dans `apps/api`, jamais dans le chemin d'annonce critique.
7. **Respect de la vie privée by design.** On ne fédère jamais de PII brute : pas d'IP (déjà hashées), pas de verifier d'auth, pas d'e-mail. Cf. §8.

---

## 5. Architecture cible

### 5.1 Vue d'ensemble

La fédération est un **nouveau sous-système de `apps/api`** : un groupe de routes entrantes S2S, un groupe de routes admin, et un plugin cron de synchronisation. Le tracker Go n'est pas modifié avant la Phase 4.

```
   Instance A (tracker.a.com)                         Instance B (tracker.b.com)
   ┌──────────────────────────────┐                  ┌──────────────────────────────┐
   │ apps/api (Nitro)             │   HTTPS + sig    │ apps/api (Nitro)             │
   │  /api/federation/*      ◄────┼─── Ed25519 ──────┼──►  /api/federation/*        │
   │    handshake · sync · search │   (S2S, pairs    │     handshake · sync · search│
   │                              │    allow-list    │                              │
   │  /api/admin/federation/*     │    uniquement)   │  /api/admin/federation/*     │
   │    owner : toggle + pairs    │                  │    owner : toggle + pairs    │
   │                              │                  │                              │
   │  plugin: federation-sync     │                  │  plugin: federation-sync     │
   │    (cron pull, calqué sur    │                  │    (cron pull)               │
   │     bonus-collector)         │                  │                              │
   └───────────┬──────────────────┘                  └───────────┬──────────────────┘
               ▼                                                  ▼
   Postgres: federation_config (singleton)            Postgres (mêmes tables)
             federation_peers (allow-list)
             remote_torrents (cache catalogue)
             federation_sync_state (curseurs)
             remote_* (social, phase 2+)
   Redis:    verrous de sync, rate-limit S2S,
             cache de réponses distantes
```

Tout appel sortant passe par `safeFetch`. Tout appel entrant est signé, vérifié contre l'allow-list, et rate-limité.

### 5.2 Identité d'instance

Chaque instance génère **une paire de clés Ed25519** au premier démarrage de la fédération (stockée chiffrée, comme les secrets de canaux de notif). L'**`instance_id`** est l'empreinte de la clé publique (ex. `b32(sha256(pubkey))`). Cet `instance_id` + la clé publique constituent l'identité vérifiable de l'instance — pas de PKI ni d'autorité centrale.

### 5.3 Modèle de confiance & handshake (double opt-in)

```
 Owner A                Instance A                 Instance B               Owner B
   │  ajoute l'URL de B      │                          │                       │
   │  + scopes proposés      │                          │                       │
   ├────────────────────────►│                          │                       │
   │                         │  POST /api/federation/   │                       │
   │                         │   handshake  (signé A)   │                       │
   │                         ├─────────────────────────►│                       │
   │                         │                          │  crée peer(pending_in)│
   │                         │                          │  notifie l'owner      │
   │                         │                          ├──────────────────────►│
   │                         │                          │                       │ approuve
   │                         │                          │◄──────────────────────┤ + scopes
   │                         │  callback signé B         │                       │
   │                         │◄─────────────────────────┤                       │
   │  lien ACTIVE des 2 côtés│  (échange clés publiques)│                       │
```

- A → `POST https://B/api/federation/handshake`, **signé avec la clé privée de A**, contenant : `instance_id` de A, sa clé publique, son URL publique, son nom, les scopes proposés.
- B crée un `federation_peers` en `pending_in` et **notifie son owner** (`notify`).
- L'owner de B approuve dans `/admin/federation`, choisit ses scopes → B répond (callback signé) avec sa clé publique et ses scopes acceptés.
- Les deux côtés passent `active`. Chacun connaît désormais la clé publique de l'autre.

### 5.4 Protocole de transport S2S

Modèle **HTTP Signatures** (inspiré d'ActivityPub mais sans son vocabulaire) :

- Headers : `Date`, `Digest` (SHA-256 du corps), `Signature` (Ed25519 sur `(request-target) host date digest`), `X-Trackarr-Instance` (= `instance_id` émetteur, sert de `keyId`).
- Vérification côté récepteur : (1) l'`instance_id` est dans l'allow-list et `active` ; (2) la signature est valide pour sa clé publique connue ; (3) `Date` dans une fenêtre ±5 min (anti-rejeu) + cache de `Digest` récents.
- Enveloppe JSON commune : `{ v, instance_id, sent_at, type, payload }`.
- Transport : HTTPS uniquement, via `safeFetch` (anti-SSRF), timeouts courts, pagination obligatoire.

Ce choix évite tout secret partagé à synchroniser et rend chaque message **non-répudiable** et **révocable** (il suffit d'oublier la clé publique).

---

## 6. Schéma de base de données

Style Drizzle/`snake_case`, cohérent avec `packages/db/src/schema.ts`. Tables introduites par phase.

### Phase 0 — confiance & transport

```
federation_config         (singleton, id = 'singleton')
  enabled                 boolean   default false
  instance_name           text
  instance_public_url     text
  signing_private_key     text      -- Ed25519 privée, chiffrée (cf. notificationChannels)
  signing_public_key      text
  instance_id             text      -- empreinte de la clé publique
  share_catalog           boolean   default false   -- valeurs par défaut proposées aux nouveaux pairs
  share_social            boolean   default false
  share_accounts          boolean   default false
  share_swarm             boolean   default false
  created_at, updated_at  timestamp

federation_peers          (l'allow-list)
  id                      uuid pk
  base_url                text unique          -- https://tracker.exemple.com
  instance_id             text                 -- identité distante (empreinte clé pub)
  public_key              text                 -- clé pub Ed25519 du pair
  display_name            text
  status                  text   -- pending_out | pending_in | active | suspended | blocked | revoked
  shares_with_them        jsonb  -- { catalog, social, accounts, swarm } : ce qu'on LEUR envoie
  accepts_from_them       jsonb  -- { catalog, social, accounts, swarm } : ce qu'on accepte D'EUX
  last_handshake_at       timestamp
  last_seen_at            timestamp
  last_error              text
  created_by              uuid -> users.id
  created_at, updated_at  timestamp
  index(status), index(instance_id)

federation_sync_state     (curseur par pair × ressource)
  peer_id                 uuid -> federation_peers.id
  resource                text   -- catalog | social | ...
  cursor                  text   -- timestamp/opaque renvoyé par le pair
  last_run_at             timestamp
  last_status             text   -- ok | error | partial
  items_synced            integer
  pk(peer_id, resource)
```

### Phase 1 — catalogue (cache local du contenu distant)

```
remote_torrents
  id                      uuid pk              -- id local du miroir
  peer_id                 uuid -> federation_peers.id
  remote_id               text                 -- uuid du torrent chez le pair
  info_hash               text
  content_signature       text
  name                    text
  size                    bigint
  description             text
  category_slug           text                 -- mappée vers une catégorie locale si possible
  tags                    jsonb
  imdb_id, tmdb_id, ...   text
  seeders, leechers, completed  integer        -- stats distantes, best-effort
  uploader_name           text                 -- nom distant, JAMAIS d'id local
  remote_detail_url       text
  remote_download_url     text
  fetched_at, updated_at  timestamp
  unique(peer_id, remote_id)
  index(info_hash), index(content_signature), index(imdb_id), ...
```

> Le catalogue distant est un **cache en lecture seule**, jamais mélangé à la table `torrents` locale. Les vues fédérées font l'`UNION`/le merge à la lecture (badge « depuis instance X »), ce qui garde l'économie locale (ratio, HnR, modération) totalement étanche.

### Phases 2-4 (esquisse, détaillées plus bas)

- **Social** : `remote_comments`, `remote_forum_topics/posts`, ou une table polymorphe `remote_objects(peer_id, kind, remote_id, payload jsonb, ...)`.
- **Comptes/réputation** : `federated_identities(user_id, peer_id, remote_handle, verified_at)`, `remote_user_reputation(...)`.
- **Swarm** : pas de table — cross-announce au niveau tracker Go + Redis (cf. §7.4).

---

## 7. Les quatre axes en détail

### 7.1 Axe 1 — Catalogue / métadonnées *(socle, risque faible)*

**But.** Découvrir et rechercher le contenu des instances partenaires sans toucher aux swarms.

- **Synchronisation pull** : le plugin cron `federation-sync` interroge périodiquement `GET /api/federation/catalog?since=<cursor>` de chaque pair `active` qui nous partage `catalog`. Réponse paginée, signée. Upsert dans `remote_torrents`. (Optionnel ultérieur : push « live » des nouveautés via webhook signé pour réduire la latence.)
- **Dé-duplication** : un même contenu présent localement *et* à distance est rapproché par `info_hash` → sinon `content_signature` → sinon IDs média. L'UI affiche « aussi disponible sur 2 instances ».
- **Recherche fédérée** : les listings ajoutent un filtre `Local / Fédéré / Tout`. Deux modes : *cache* (rapide, lit `remote_torrents`) et *live* (fan-out `GET /api/federation/search?q=` vers les pairs, agrégé, borné en temps — réutilise le patron de fan-out concurrency-capped des follows).
- **Téléchargement — décision importante.** En Phase 1, le bouton « télécharger » d'un torrent distant **redirige vers l'instance d'origine** (l'utilisateur doit y avoir un compte). On **ne** sert **pas** le `.torrent` avec notre propre passkey : ça mélangerait les swarms et contournerait le modèle privé. La fusion réelle des swarms est le sujet (risqué) de la Phase 4.

**Vie privée** : on ne fédère que des métadonnées déjà « publiques » au sein de l'instance d'origine ; jamais le `torrent_data` binaire ni l'identité réelle de l'uploader (seulement un nom d'affichage).

### 7.2 Axe 2 — Social *(risque moyen)*

**But.** Commentaires, sujets de forum et follows visibles d'une instance à l'autre, façon fediverse léger.

- Réutilise le transport S2S et le modèle `remote_objects`. Un commentaire distant est rendu en lecture seule avec mention « @alice@tracker.b.com ».
- **Follows inter-instances** : un user local peut suivre un user distant ; les notifications `followed_user_upload` traversent via un message S2S signé `Announce`.
- **Modération** : tout objet distant est filtrable/bloquable localement ; un owner peut couper le scope `social` d'un pair sans couper `catalog`. Pas de modération distante imposée (souveraineté).
- **Anti-abus** : limite de débit par pair, taille de payload bornée, sanitization HTML identique à celle des entrées locales (le projet a déjà un viewer BBCode/description durci).

### 7.3 Axe 3 — Comptes / réputation *(risque élevé)*

**But.** Identité et/ou réputation (ratio, bonus, ancienneté) portables entre instances.

C'est l'axe le plus délicat car il touche à l'économie et à la sécurité des comptes. Trois options, du moins au plus intégré :

| Option | Description | Implication |
|---|---|---|
| **A. Identité liée (recommandé pour commencer)** | Un user prouve qu'il possède un compte sur le pair (challenge signé) et **lie** les deux identités. Affichage d'un badge « vérifié sur tracker.b.com ». | Aucune fusion d'économie. Sûr. Base pour la suite. |
| **B. Réputation importée (lecture seule)** | À la demande, on importe ratio/ancienneté/bonus du pair comme **signal d'affichage** (ex. fast-track d'invitation), sans modifier l'économie locale. | Risque de triche si un pair ment → réservé aux pairs de haute confiance ; valeurs marquées « source : tracker.b.com ». |
| **C. SSO / compte unique** | Login d'une instance vaut sur l'autre. | Très intrusif, sécurité lourde (révocation, panic mode, ZK-auth distribuée). **Hors périmètre raisonnable v1.** |

**Recommandation** : livrer **A**, exposer **B** comme option par-pair explicitement « confiance élevée », et **ne pas** faire **C** en v1. L'auth zero-knowledge actuelle (le serveur ne voit jamais le mot de passe) rend le SSO complexe — c'est une bonne chose pour la sécurité, mais ça ferme la porte à un SSO naïf.

### 7.4 Axe 4 — Swarm / pairs *(risque TRÈS élevé — avertissement)*

**But.** Mutualiser seeders/leechers entre instances pour accélérer les téléchargements.

⚠️ **Tension fondamentale.** Un tracker privé isole *délibérément* les swarms (`info.private=1`, découverte de pairs uniquement via le tracker). Fédérer les pairs revient à **percer cet isolement**. Conséquences à arbitrer explicitement avec l'owner :

- **Comptabilité ratio/HnR** : si un pair de B télécharge sur le swarm de A, *qui* comptabilise l'upload/download ? Le modèle de ratio et de Hit-and-Run doit être repensé (réconciliation cross-instance, ou « zone neutre » non comptabilisée).
- **Sécurité/anti-triche** : les heuristiques anti-cheat du tracker Go (vélocité, swarm vide, peer_id inconnu) supposent un swarm clos. Des pairs distants brouillent ces signaux.
- **Confidentialité** : exposer les pairs (même IP hashée) d'une instance à une autre élargit la surface.
- **Charge sur le hot path** : c'est la **seule** phase qui touche le tracker Go ; elle doit rester optionnelle et n'activer le cross-announce que pour des torrents explicitement marqués « fédérés » et des pairs au scope `swarm` mutuel.

**Approche prudente recommandée** : cross-announce **opt-in par torrent et par pair**, avec une zone de comptabilité dédiée (ou non-comptabilisée), derrière un flag tracker `TRACKER_FEDERATION_SWARM=false` par défaut. À traiter **en dernier**, après retour d'expérience des phases 1-3. Une alternative plus douce : se contenter d'**afficher** le nombre de seeders distants (déjà couvert par l'Axe 1) sans réellement fusionner les swarms — souvent 80 % de la valeur perçue pour 5 % du risque.

---

## 8. Sécurité, abus & vie privée

| Sujet | Mesure |
|---|---|
| **Auth S2S** | Signature Ed25519 par requête, `instance_id` = `keyId`, allow-list obligatoire, anti-rejeu (Date + cache de Digest). |
| **SSRF** | Tous les appels sortants via `safeFetch` (déjà durci : bloque IP privées/loopback/link-local/metadata, revalide les redirections). URL de pair validée au handshake. |
| **Rate-limit** | Réutilise `rateLimit.ts` : fenêtres par `instance_id` *et* par IP, pénalités progressives. Endpoints S2S plafonnés. |
| **Révocation** | Passer un pair à `blocked`/`revoked` : oublie sa clé publique (ses futures requêtes échouent à la vérification) et purge `remote_*`. |
| **Panic mode** | La fédération doit être **suspendue** quand la panic mode est active (pas d'exfiltration pendant un incident). Les clés de signature sont incluses dans le périmètre de chiffrement panic. |
| **Vie privée / RGPD** | On ne fédère jamais : IP brutes (déjà hashées localement, **non** partagées), e-mails, `auth_verifier`/`auth_salt`, `panic_password_hash`, `totp_secret`, codes de récupération. Seulement métadonnées de contenu + noms d'affichage publics. Le scope `accounts` requiert le **consentement explicite du user** concerné, pas seulement de l'owner. |
| **Empoisonnement de catalogue** | Données distantes marquées comme telles, jamais fusionnées dans `torrents`, filtrables/purgeables par pair ; un pair malveillant ne peut polluer que son propre namespace `remote_torrents`. |

---

## 9. Impact sur l'existant

- **Migrations** : additives uniquement (nouvelles tables). Aucune colonne retirée. Compatible avec le `drizzle-kit push --force` au boot de l'API.
- **Tracker Go** : **intact** en phases 0-3. Touché seulement en phase 4 (cross-announce, derrière flag off par défaut).
- **Perf** : la sync est un cron borné (patron `bonus-collector`), hors requête utilisateur. Les vues fédérées « live » sont plafonnées en temps et en fan-out.
- **Déploiement** : un nouveau secret (`FEDERATION_SIGNING_KEY` ou génération auto au premier run) ; le port/Caddy n'a pas besoin de changer (les routes S2S passent par `/api/federation/*` derrière le reverse-proxy existant). Documenter dans `doc/reference/env.md`.
- **Build statique (CSR)** : la page admin fédération suit le même chemin que les autres pages `/admin/*` ; pas d'impact sur le tracker `scratch`.

---

## 10. Phasage & estimation d'effort

| Phase | Contenu | Effort indicatif | Dépend de |
|---|---|---|---|
| **0 — Socle** | Clés Ed25519, `federation_config`/`federation_peers`, handshake double opt-in, transport signé, page admin (toggle + allow-list), notif owner | M | — |
| **1 — Catalogue** | `remote_torrents`, endpoints `catalog`/`search`, cron sync, dédup, UI listing fédéré + redirection de téléchargement | M–L | 0 |
| **2 — Social** | `remote_objects`, commentaires/forum/follows fédérés, modération par-scope | M | 0, 1 |
| **3 — Comptes** | Option A (identité liée) ; option B (réputation lecture seule, par-pair) | M–L | 0 |
| **4 — Swarm** | Cross-announce opt-in (tracker Go), réconciliation ratio/HnR, flag off par défaut | **L–XL** | 0, 1, retour d'expérience |

Recommandation : **0 → 1** d'abord (le socle + la découverte de catalogue couvrent l'essentiel de la valeur), puis 2 et 3 selon l'usage, et 4 seulement après décision explicite assumant les arbitrages du §7.4.

---

## 11. Risques & questions ouvertes

1. **Mapping des catégories/tags** entre instances aux taxonomies différentes : prévoir une table de correspondance ou un fallback « non classé ».
2. **Versionnement du protocole** : champ `v` dans l'enveloppe ; négociation de capacités au handshake (quelles phases chaque pair supporte).
3. **Cohérence des stats distantes** : seeders/leechers fédérés sont best-effort (TTL court) ; ne pas les présenter comme temps réel.
4. **Quotas de stockage** du cache `remote_torrents` (purge LRU/TTL par pair).
5. **Gouvernance** : que se passe-t-il si un pair de confiance est compromis ? → révocation rapide + purge ; envisager une « liste de défiance » partageable mais **non contraignante** (chaque owner reste souverain).
6. **Phase 4** : modèle de comptabilité ratio cross-instance — sujet de conception à part entière.

---

## 12. Maquettes

Maquettes haute-fidélité (HTML autonome, reproduisant le design system Trackarr) dans [`./mockups/`](./mockups/). Point d'entrée : **`mockups/index.html`** (ouvrir dans un navigateur).

- `index.html` — page d'accueil / navigation entre les maquettes.
- `admin-federation.html` — page `/admin/federation` : master toggle owner, identité vérifiable de l'instance, scopes partagés par défaut (catalogue · social · comptes · swarm), KPIs, allow-list des pairs (statuts, scopes, sync, ajout/handshake). **Le modal d'approbation d'une demande entrante est intégré** (bouton *Review* sur la demande en attente).
- `federated-catalog.html` — listing avec filtre Local/Fédéré/Tout, badge d'origine (« via … »), dédup inter-instances, téléchargement par redirection vers la source.
- `styles.css` — feuille de style partagée reproduisant les tokens du design system live.

---

*Document de conception — à valider avant toute implémentation.*
