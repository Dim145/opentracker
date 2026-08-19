# Import depuis trackers tiers (cross-seed) — recherche & décision

**Date :** 2026-08-17 · **Statut :** en pause, non implémenté · **Méthode :** définitions d'indexeurs Jackett/Prowlarr, code amont UNIT3D, spec Torznab, croisés avec le code du repo (`fichier:ligne`).

Sites étudiés : [c411.org](https://c411.org), [tr4ker.net](https://tr4ker.net), [yggreborn.org](https://www.yggreborn.org), [gemini-tracker.org](https://gemini-tracker.org).

---

## Objectif visé

**Faciliter le cross-seed**, pas cloner un catalogue. Le scénario :

1. L'utilisateur seede déjà un contenu récupéré sur un tracker tiers.
2. Il l'importe chez nous : on récupère la fiche, le `.torrent` et les métadonnées.
3. On **réécrit l'announce** vers notre tracker et on **conserve le champ `source`** du dict `info` s'il existe, donc **l'infohash ne change pas**.
4. Il ajoute notre announce à son torrent déjà en seed. Son swarm rejoint le nôtre sans re-vérification.

Décisions déjà arrêtées par le mainteneur :

- L'import **ne crée volontairement pas de seed** — c'est l'utilisateur qui apporte les données. Ce n'est pas un défaut.
- On veut **notre swarm**, pas celui du tracker distant. Aucun mirroring d'announce.
- On garde `source` **pour préserver l'infohash** (voir plus bas pourquoi c'est le bon arbitrage).
- Le `.torrent` est **toujours réécrit** avant stockage.

---

## Le point technique qui a débloqué le sujet

Une première analyse concluait à tort que réécrire l'announce cassait l'import. **C'est faux, et c'est important de ne pas refaire l'erreur :**

> L'infohash est le SHA-1 du **dictionnaire `info` seul** ([BEP 3](https://www.bittorrent.org/beps/bep_0003.html)). `announce` et `announce-list` sont des clés **frères** de `info`, en dehors. Réécrire le tracker ne touche donc jamais à l'infohash.

Le repo en fait déjà la démonstration : `apps/api/routes/api/torrents/[hash]/download.get.ts:104` injecte la passkey dans l'URL d'announce à chaque téléchargement, sans que l'infohash bouge d'un bit.

Corollaire sur `source` : beaucoup de trackers privés glissent un `source` dans le dict `info` pour rendre *leur* infohash unique. Comme il est **dans** `info`, y toucher change l'infohash.

- **Le garder** → même infohash que le site d'origine → le client qui seede déjà peut ajouter notre announce **sans re-vérifier**. C'est ce qu'on veut pour le cross-seed.
- **Le remplacer** → nouvel infohash → re-vérification complète côté client avant de pouvoir seeder.

---

## Ce que chaque site expose

Les quatre ont une **API officielle avec clé par utilisateur**. Aucun scraping nécessaire pour le cœur du besoin.

| Site | Logiciel | Endpoint | Auth | Où trouver la clé |
|---|---|---|---|---|
| C411 | custom | `GET /api/torznab` | `apikey` en query | `/user/integrations` |
| TR4KER | custom | `GET /api/torznab/all` | `apikey` en query | `/mon-compte/parametres` → « Clé API » |
| YggReborn | custom | `GET https://api.yggreborn.org/api` | `apikey` = passkey | doc officielle sur `/guide-api` |
| G3MINI TR4CK3R | **UNIT3D 9.2.0** | `GET /api/torrents/filter` | `Authorization: Bearer` | My Settings → onglet « API Key » |

Débits connus : C411 **15 req/min**, YggReborn ~2 s entre requêtes. Non documenté pour les deux autres.

### Champs disponibles

| Besoin | C411 · TR4KER · Ygg (Torznab XML) | G3MINI (UNIT3D JSON) |
|---|---|---|
| Nom | `title` | `name` |
| **Description** | **absente de la norme** | `description` |
| NFO / MediaInfo | absent | `media_info`, `bd_info` |
| Fichier `.torrent` | `enclosure/@url` | `download_link` |
| Taille | `size` | `size` |
| Liste des fichiers | via le `.torrent` | `files[]` (nom + taille) |
| Catégorie | `category` — **ID Newznab standard** | `category_id` + `category` (libellé), **propres au site** |
| IMDb / TMDb / TVDb | `imdbid`, `tmdbid` | `imdb_id`, `tmdb_id`, `tvdb_id`, `mal_id`, `igdb_id` |
| Affiche / genres | absents | `meta.poster`, `meta.genres` |
| Résolution / type | déductible du titre | `resolution`, `type`, `distributor` |
| Seeders / leechers | oui | oui |
| Uploadeur | absent | `uploader` |
| Freeleech | `downloadvolumefactor` | `freeleech` |

Source du détail UNIT3D : [`TorrentResource.php`](https://github.com/HDInnovations/UNIT3D/blob/master/app/Http/Resources/TorrentResource.php) — c'est la liste exacte des champs rendus, pas une supposition.

---

## Le point de blocage

**Tout ce qui est nécessaire au cross-seed est accessible par API sur les quatre sites** : le `.torrent` (donc le dict `info`, donc `source` et l'infohash), le titre, la taille, la catégorie et les identifiants externes.

Ce qui manque, uniquement sur les trois sites Torznab : **la description rédigée et le NFO**.

Contournement partiel sans scraping : Torznab transporte `imdbid` / `tmdbid`, et le repo dispose déjà de `apps/api/routes/api/metadata/lookup.get.ts` (`GET /api/metadata/lookup?source=imdb|tmdb|tvdb|igdb&id=…`) qui rend affiche, synopsis et genres. On remplit donc la fiche sans toucher au HTML du site source — on perd seulement les notes de release manuscrites.

### Ce qui n'a pas été tranché, et comment le trancher

`<description>` **est** un élément RSS standard, lu par les parseurs Torznab (SearXNG le lit, par exemple). La [spec Torznab 1.3](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html) ne rend obligatoires que `size` et `category` et **ne dit rien du contenu de `description`**. La définition Jackett de C411 ne le lit pas — mais **Jackett n'extrait que ce dont Jackett a besoin**, donc ça ne prouve rien.

Autrement dit : C411 **peut** déjà renvoyer la description, personne n'a vérifié. Avec une clé valide, c'est une commande :

```bash
curl -s "https://c411.org/api/torznab?apikey=$KEY&t=search&limit=1" | xmllint --format - | head -60
```

Si `<description>` contient autre chose que le titre, le blocage tombe et le sujet peut repartir.

---

## Correspondance des catégories

Besoin exprimé : détection automatique **plus** possibilité de corriger à la main avant import.

**Côté Torznab, c'est une jointure et non une heuristique.** Torznab impose un espace de nommage partagé (2000 Movies, 5000 TV, 3000 Audio, 4000 PC, 1000 Console, 7000 Books) et le repo possède **déjà** la table qui associe nos catégories à ces IDs, puisqu'on les émet pour notre propre flux : `apps/api/routes/api/torznab/utils/categories.ts:9` (`NEWZNAB_CATEGORIES`) et le mapping qui suit (l.64+). La détection automatique consiste à lire cette table à l'envers. En complément, `t=caps` rend l'arbre complet du site distant avec ses libellés maison — c'est la matière de l'écran de mapping.

**Côté UNIT3D, il faut apprendre l'arbre.** `category_id` est propre au site ; seul le libellé `category` est lisible. Première synchro : énumérer les paires (id, libellé), proposer un rapprochement par libellé, laisser l'humain trancher. Une fois par site.

Forme retenue si le sujet reprend :

1. Table persistée `(source, remote_category_id) → category_id`, avec un drapeau auto/manuel. **Un choix manuel ne doit jamais être écrasé par une resynchro.**
2. Écran de mapping par source, arbre distant à gauche, nos catégories à droite, proposition pré-sélectionnée.
3. Catégorie non mappée → import **en attente et signalé**, jamais un « Divers » silencieux.
4. Prévisualisation de la fiche avant écriture, éditable — c'est le formulaire d'upload manuel pré-rempli.

---

## Ce que le repo apporte déjà

| Existant | Réutilisation |
|---|---|
| `apps/api/routes/api/torznab/` (+ `utils/categories.ts`, `utils/xml.ts`) | On **produit** déjà du Torznab : vocabulaire, catégories et sérialisation acquis. Il manque le sens lecture. Notre propre endpoint sert de banc d'essai avant d'avoir la moindre clé tierce. |
| `apps/api/utils/safeFetch.ts` | Sortie réseau gardée contre le SSRF, déjà couverte par des tests. |
| `apps/api/routes/api/metadata/lookup.get.ts` | Remplit affiche/synopsis/genres depuis un `imdbid`/`tmdbid`. |
| `apps/api/utils/federation/` + `remoteTorrents` (`packages/db/src/schema.ts:2191`) | Même forme : source distante → cache local → rendu. Attention, `remote_torrents` est un **miroir catalogue** qui renvoie vers l'instance d'origine — un import cross-seed écrit au contraire dans `torrents`, ce n'est pas la même table ni la même intention. |
| `apps/api/utils/channels/` | Patron d'adaptateur à copier (10 canaux derrière une interface commune). |

Deux adaptateurs suffisent pour les quatre sites : **Torznab (XML)** et **UNIT3D (JSON)**. Le second est le plus rentable — il marchera tel quel sur les dizaines d'autres trackers sous UNIT3D.

---

## Points d'implémentation à ne pas oublier

- **`torrents` n'a aucune colonne de provenance.** (`packages/db/src/schema.ts:844`+ : `infoHash` unique l.848, `torrentData` l.853, `uploaderId` l.854, `categoryId` l.855.) Le `source` vu à la ligne 263 appartient à `bonusEvents`, pas à `torrents` — piège de lecture. Un import devra ajouter la provenance.
- **`infoHash` est déjà `unique()`** (l.848) : c'est la contrainte de dédup naturelle. Prévoir la fusion, pas l'échec brut, quand le contenu existe déjà.
- **Ne jamais persister le `.torrent` d'origine tel quel** : il contient la passkey de celui qui l'a téléchargé, c'est-à-dire son identité sur le site source. Réécriture de l'announce **avant** toute écriture en base.
- **Les clés API sont des identités.** Chiffrement au repos, jamais dans les logs ni dans un export, jamais renvoyées au client après saisie. Stockage **par utilisateur**, rien de global à l'instance.
- **Passkey Ygg liée à l'IP** qui l'a générée. Un serveur qui change d'IP casse l'intégration sans message clair — le prévoir dans le diagnostic.
- **Cloudflare.** Les pages publiques de `yggreborn.org` et `gemini-tracker.org` ont renvoyé **403** depuis un poste de dev, et la demande d'indexeur G3MINI mentionne une erreur CF 525. Les sous-domaines d'API semblent épargnés — **à vérifier depuis l'IP du serveur avant d'écrire du code**.
- **Débit.** Une recherche qui fanoute sur quatre sources épuise vite les 15 req/min de C411 : cache par (source, requête) et file d'attente par utilisateur.
- **Règles des sites.** Utiliser l'API avec sa propre clé est prévu ; republier leur contenu ailleurs ne l'est généralement pas, et un infohash conservé se retrouve. Arbitrage assumé côté mainteneur, consigné ici pour que ce ne soit pas une découverte.

---

## Décision

**Sujet mis en pause au 2026-08-17.** Motif : hors G3MINI (UNIT3D), la description et le NFO ne sont pas accessibles par API, et le mainteneur ne veut pas de scraping HTML — a fortiori derrière Cloudflare.

Deux portes restent ouvertes pour reprendre :

1. **Vérifier `<description>` chez C411** avec la commande `curl` ci-dessus. Si le champ est réellement rempli, les trois sites Torznab redeviennent viables et le sujet repart.
2. **Ne faire que l'adaptateur UNIT3D.** G3MINI donne déjà l'import complet en un appel, et l'adaptateur est réutilisable sur tout l'écosystème UNIT3D. C'est le meilleur rapport travail/couverture si on veut avancer sans attendre.

---

## Sources

- [UNIT3D — `TorrentResource.php`](https://github.com/HDInnovations/UNIT3D/blob/master/app/Http/Resources/TorrentResource.php) — champs exacts rendus par l'API
- [UNIT3D — doc API torrents](https://hdinnovations.github.io/UNIT3D/torrent_api.html)
- Définitions Jackett : [c411](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/c411.yml) · [tr4ker](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/tr4ker.yml) · [yggreborn-api](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/yggreborn-api.yml) · [g3minitr4ck3r-api](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/g3minitr4ck3r-api.yml)
- [Jackett #16517](https://github.com/Jackett/Jackett/issues/16517) — demande G3MINI, révèle UNIT3D 9.2.0
- [Spécification Torznab 1.3](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html)
- [BEP 3](https://www.bittorrent.org/beps/bep_0003.html) — structure du `.torrent`, infohash = SHA-1 du dict `info`
- [api-ratio](https://github.com/sabuontop/api-ratio) — récupération de stats multi-trackers, si le sujet « importer ses propres données » revient
