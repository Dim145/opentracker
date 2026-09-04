#!/usr/bin/env bash
#
# Verse les torrents d'un `pg_dump` d'exploitation dans la pile e2e gardée.
#
#   bash tests/e2e/import-dump.sh /chemin/vers/dump.sql
#
# Pourquoi ce script existe : un catalogue fabriqué à la main ne ressemble pas
# à un vrai. `demoTorrents.mjs` dépose dix releases dont chaque champ a été
# choisi pour éclairer un bout d'interface — donc chaque champ est propre, de la
# bonne longueur, et rempli. Un vrai catalogue porte des descriptions de 3 Kio
# avec des images mortes dedans, des NFO de 50 Kio, des identifiants TMDb saisis
# par URL (`tv/34114` et non `34114`), des titres à rallonge et des champs
# vides. Ce sont ces cas-là qui cassent une mise en page, et on ne les invente
# pas.
#
# Ce qui est importé : `torrents` et ce qui y pend — catégories, étiquettes,
# liaisons, commentaires, instantané d'essaim, favoris, fils de modération,
# obligations de seed.
#
# Ce qui n'est PAS importé : la table `users`. Elle porte `auth_verifier`,
# `passkey`, `totp_secret` et `panic_password_hash` — des secrets de l'instance
# d'origine, qui n'ont rien à faire dans une pile jetable. Les identifiants
# d'auteur et de propriétaire sont donc REMAPPÉS sur les comptes du harnais,
# dont les mots de passe sont faux et publics.
#
# Le dump peut venir d'une version ANTÉRIEURE du schéma : les colonnes sont
# lues dans son propre `COPY`, comparées à celles de la base qui tourne, et
# l'import s'arrête net si une colonne du dump a disparu depuis. Les colonnes
# AJOUTÉES depuis n'ont pas d'importance — elles ont toutes un défaut ou sont
# nullables, sinon la migration qui les a créées n'aurait pas pu tourner.
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: bash tests/e2e/import-dump.sh <dump.sql>" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f $HERE/docker-compose.yml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

CID="$($COMPOSE ps -q postgres)"
[ -n "$CID" ] || { echo "la pile e2e ne tourne pas — bash tests/e2e/run.sh --keep" >&2; exit 1; }

say "extraction des blocs COPY"
# Un bloc VIDE (`FROM stdin;` suivi immédiatement de `\.`) piège une capture
# non gourmande : elle s'étend jusqu'au `\.` suivant et ramasse la table
# d'après. D'où le découpage ligne à ligne plutôt qu'une expression régulière
# sur tout le fichier.
python3 - "$DUMP" "$WORK" <<'PY'
import sys, pathlib
dump, work = sys.argv[1], pathlib.Path(sys.argv[2])
WANT = ['categories', 'tags', 'torrents', 'torrent_tags', 'torrent_comments',
        'torrent_stats', 'torrent_favorites', 'torrent_moderation_messages',
        'hnr_tracking']
cols, counts = {}, {}
current = None
out = None
for line in pathlib.Path(dump).open(encoding='utf8', errors='replace'):
    if current is None:
        if line.startswith('COPY public.'):
            name = line[len('COPY public.'):].split(' ', 1)[0]
            if name in WANT:
                current = name
                cols[name] = [c.strip() for c in line[line.index('(') + 1:line.index(')')].split(',')]
                out = (work / f'{name}.tsv').open('w', encoding='utf8')
                counts[name] = 0
        continue
    if line.rstrip('\n') == '\\.':
        out.close(); current = None; out = None
        continue
    out.write(line); counts[current] += 1
if out: out.close()
# Le `\n` final n'est pas cosmétique : `while read` laisse tomber une dernière
# ligne sans fin de ligne, et `pg_dump` émet les tables dans l'ordre
# alphabétique — donc la ligne perdue était `torrents`, la seule qui compte
# vraiment. Le contrôle affichait huit tables sur neuf et avait l'air complet.
(work / 'columns.txt').write_text(
    ''.join(f'{k}\t{",".join(v)}\n' for k, v in cols.items())
)
missing = [t for t in WANT if t not in cols]
for t in WANT:
    print(f'  {t:32} {counts.get(t, 0):>6} lignes' + ('  (absente du dump)' if t in missing else ''))
PY

say "contrôle des colonnes contre la base qui tourne"
while IFS=$'\t' read -r table dumpcols; do
  [ -n "$table" ] || continue
  # `< /dev/null` : sans lui, `docker compose exec -T` lit STDIN — c'est-à-dire
  # le reste de `columns.txt` — et la boucle s'arrête après la première table.
  # Elle affichait « categories : ok » et rien d'autre, ce qui ressemble à un
  # contrôle qui passe.
  live=$($COMPOSE exec -T postgres psql -U tracker -d trackarr -tA -c \
    "select string_agg(column_name, ',') from information_schema.columns where table_name='$table';" \
    < /dev/null | tr -d '\r')
  missing=""
  IFS=',' read -ra want <<< "$dumpcols"
  for c in "${want[@]}"; do
    case ",$live," in *",$c,"*) ;; *) missing="$missing $c" ;; esac
  done
  if [ -n "$missing" ]; then
    echo "  $table : colonnes du dump disparues depuis —$missing" >&2
    echo "  L'import s'arrête : ces données n'ont plus de place où aller." >&2
    exit 1
  fi
  echo "  $table : ok"
done < "$WORK/columns.txt"

say "copie dans le conteneur"
# Une table absente du dump doit donner un fichier VIDE, pas un fichier
# manquant : `COPY` d'un fichier absent echoue, `COPY` d'un fichier vide charge
# zero ligne, et c'est exactement ce qu'on veut dire.
for t in categories tags torrents torrent_tags torrent_comments torrent_stats \
         torrent_favorites torrent_moderation_messages hnr_tracking; do
  [ -f "$WORK/$t.tsv" ] || : > "$WORK/$t.tsv"
done
docker exec "$CID" sh -c 'rm -rf /tmp/imp && mkdir -p /tmp/imp'
for f in "$WORK"/*.tsv; do docker cp "$f" "$CID:/tmp/imp/$(basename "$f")"; done
# Les montages de Docker Desktop servent parfois un fichier tronqué sans le
# dire. `docker cp` n'est pas un montage, mais le contrôle coûte une seconde et
# un import à moitié copié est indétectable ensuite.
for f in "$WORK"/*.tsv; do
  b="$(basename "$f")"
  a=$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)
  c=$(docker exec "$CID" md5sum "/tmp/imp/$b" | cut -d' ' -f1)
  [ "$a" = "$c" ] || { echo "  $b : md5 différent après copie ($a vs $c)" >&2; exit 1; }
done
echo "  md5 identiques"

docker cp "$HERE/import-dump.sql" "$CID:/tmp/imp/import.sql"

say "import"
docker exec "$CID" psql -U tracker -d trackarr -v ON_ERROR_STOP=1 -f /tmp/imp/import.sql

say "terminé — donnez-leur un essaim avec : node tests/e2e/demoSwarm.mjs"
