// Package stats regroupe les crédits d'octets des annonces avant de les porter
// au compte des membres.
//
// # Le problème
//
// Chaque annonce créditée exécutait un `UPDATE users … WHERE id = $1` à elle
// seule. À l'échelle visée — 3 536 110 pairs actifs, intervalle d'annonce de
// 30 minutes — cela fait 1 964 transactions par seconde sur une table de
// quelques dizaines de milliers de lignes, chacune avec son aller-retour
// réseau, son enregistrement de commit et son fsync.
//
// Or un membre qui seede 70 torrents met à jour SA PROPRE ligne 70 fois par
// intervalle. Les additions sont commutatives : rien n'oblige à les porter une
// par une.
//
// # Ce que ça change, mesuré
//
// Cinq minutes de trafic à cette échelle, 50 000 membres, la vraie DDL de
// `users` et ses sept index, en régime permanent (VACUUM à la cadence de
// l'autovacuum, une transaction par annonce du côté témoin) :
//
//	chemin par annonce      113–125 Mo de WAL   100 % HOT   589 200 écritures
//	par lot, fenêtre 60 s    45,8 Mo de WAL     100 % HOT   226 315 écritures
//	par lot, fenêtre 300 s    7,3–7,6 Mo        100 % HOT    50 000 écritures
//
// Taille de table et d'index identiques dans les trois cas. À 60 secondes,
// c'est 2,7 fois moins de WAL et 26 fois moins de requêtes ; à 300 secondes,
// 15 fois moins de WAL et 118 fois moins de requêtes.
//
// # Pourquoi par TRANCHES, et non un versement d'un bloc
//
// C'est le piège de toute l'affaire, et il inverse le résultat. Une seule
// transaction qui met à jour 45 317 lignes empêche l'élagage HOT : les
// anciennes versions restent vivantes jusqu'au commit, aucune page ne peut
// recycler sa place, chaque ligne migre et réécrit les SEPT index. Mesuré,
// toujours à la même échelle :
//
//	un bloc de 45 317 lignes     50 Mo de WAL    19 % HOT   table 23 Mo
//	tranches de 200              28 Mo           85 % HOT   table 15 Mo
//	tranches de 10               20 Mo         99,8 % HOT   table 14 Mo
//	tranches de 5                19 Mo          100 % HOT   table 13 Mo
//
// Le versement d'un bloc écrit donc PLUS de WAL que les écritures unitaires
// qu'il remplace. En dessous de cinq, le coût des commits reprend le dessus.
// Le défaut est à dix ; c'est le creux de la courbe.
//
// Corollaire utile : une transaction qui ne verrouille que dix lignes pendant
// quelques microsecondes ne peut pas retarder la boutique, qui prend un
// `SELECT … FOR UPDATE` sur une ligne unique.
//
// # Durabilité
//
// L'accumulateur vit dans Redis, pas en mémoire : il survit donc à un
// redémarrage du tracker. En production Redis tourne en `appendonly yes`, ce
// qui borne une perte à la seconde d'AOF.
//
// L'ordre des opérations est délibéré. La tranche est retirée de Redis
// ATOMIQUEMENT (un script Lua), puis écrite dans Postgres ; si l'écriture
// échoue, les deltas sont RÉINJECTÉS et le versement suivant les reprendra.
// C'est strictement mieux que ce que faisait le chemin par annonce, où la
// moindre erreur Postgres perdait le crédit en silence, sans reprise.
//
// # Ce que ça coûte en fraîcheur
//
// `users.uploaded` et `users.downloaded` accusent jusqu'à une fenêtre de
// retard. Le seul point d'application du ratio de tout le dépôt est la porte
// de `ProcessAnnounce`, et elle lit déjà une valeur vieille de 60 secondes (le
// cache de passkey) — pour un contrôle qui ne se répète, par torrent, qu'à
// chaque intervalle d'annonce, soit 1 800 secondes. Une fenêtre de 60 secondes
// ajoute 3 % à une maille déjà grossière. Les autres lecteurs (le profil, les
// promotions de classe, les statistiques publiques) ne sont pas des gardes.
package stats

import (
	"context"
	"log/slog"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/tracker/internal/queries"
)

// takeScript retire d'un coup les deux compteurs d'une tranche de membres.
//
// L'atomicité est ce qui rend deux verseurs concurrents inoffensifs : le
// second ne peut pas relire ce que le premier a déjà pris, donc personne ne
// peut être crédité deux fois. Le verrou plus bas reste utile pour éviter le
// travail en double, mais la correction ne repose pas sur lui.
var takeScript = redis.NewScript(`
local out = {}
for i = 1, #ARGV do
  local f = ARGV[i]
  local u = redis.call('HGET', KEYS[1], f)
  local d = redis.call('HGET', KEYS[2], f)
  if u then redis.call('HDEL', KEYS[1], f) end
  if d then redis.call('HDEL', KEYS[2], f) end
  out[#out+1] = u or '0'
  out[#out+1] = d or '0'
end
return out
`)

// releaseLockScript ne libère le verrou que si nous le détenons ENCORE. Un
// `DEL` nu libérerait celui d'un autre verseur si le nôtre avait expiré.
var releaseLockScript = redis.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`)

// defaultChunk : le creux de la courbe mesurée (voir l'en-tête du paquet).
const defaultChunk = 10

// scanCount borne la taille d'une réponse HSCAN. Un HGETALL sur le compteur
// entier renverrait, à 356 000 membres, une dizaine de mégaoctets en un seul
// message et bloquerait Redis le temps de le produire.
const scanCount = 1000

// flushTimeout borne un versement complet. Au-delà, ce qui reste attendra le
// suivant — les deltas sont dans Redis, rien n'est perdu.
const flushTimeout = 30 * time.Second

// shutdownFlushTimeout borne le versement final, plus court que les autres.
//
// Il doit tenir dans le délai de grâce du conteneur, qu'il PARTAGE avec le
// drain des tâches de fond (`bgDrainTimeout`). Le raccourcir ne coûte rien :
// ce versement est une commodité, pas une garantie. Ce qu'il n'a pas eu le
// temps d'écrire reste dans les compteurs Redis, que la prochaine instance —
// ou celle-ci après redémarrage — reprendra à son premier réveil. Le seul
// effet d'un versement final tronqué est un retard, jamais une perte.
const shutdownFlushTimeout = 10 * time.Second

// writer est la part de `*queries.Queries` dont l'accumulateur a besoin.
//
// Étroite volontairement : une doublure de test l'implémente en deux méthodes,
// là où `queries.Querier` en demanderait une trentaine sans rapport. `db.Q` la
// satisfait sans rien déclarer.
type writer interface {
	IncrementUserStats(context.Context, queries.IncrementUserStatsParams) error
	BatchIncrementUserStats(context.Context, queries.BatchIncrementUserStatsParams) error
}

// Accumulator regroupe les deltas d'octets et les verse par tranches.
//
// Sans Redis, ou avec une fenêtre nulle, il écrit directement — une annonce à
// la fois, exactement le chemin d'origine. C'est ce qui le rend transparent
// pour les tests du serveur, qui n'ont pas de Redis, et ce qui donne à
// l'opérateur une porte de sortie qui sort vraiment.
type Accumulator struct {
	rdb   *redis.Client
	q     writer
	chunk int
	// enabled dit si `Add` accumule ou écrit tout de suite.
	//
	// Distinct de `rdb != nil` : une fenêtre à zéro sur un Redis présent est
	// une DEMANDE de désactivation, et la confondre avec « Redis absent »
	// laissait les deltas s'empiler dans Redis sans qu'aucune boucle ne les
	// verse jamais. L'échappatoire n'échappait pas — trouvé sur la pile
	// compilée, pas par les tests, parce que ceux-ci coupaient Redis au lieu
	// de couper la fenêtre.
	enabled bool

	upKey   string
	downKey string
	lockKey string
	// token identifie CE processus auprès du verrou de versement.
	token string

	// dropped compte les crédits qu'un versement n'a pas réussi à porter au
	// compte ET n'a pas réussi à réinjecter dans Redis — les seuls réellement
	// perdus. Monotone : ce qui compte est la pente, pas la valeur.
	dropped atomic.Uint64

	stopOnce sync.Once
	stop     chan struct{}
	done     chan struct{}
}

// New construit l'accumulateur. `interval` à zéro (ou un client Redis nil)
// désactive le regroupement et rend au chemin son écriture par annonce.
func New(
	rdb *redis.Client, q writer, keyPrefix string,
	interval time.Duration, chunk int,
) *Accumulator {
	if chunk <= 0 {
		chunk = defaultChunk
	}
	a := &Accumulator{
		rdb:     rdb,
		q:       q,
		chunk:   chunk,
		enabled: rdb != nil && interval > 0,
		upKey:   keyPrefix + "trk:stats:up",
		downKey: keyPrefix + "trk:stats:down",
		lockKey: keyPrefix + "trk:stats:flushlock",
		token:   strconv.FormatInt(time.Now().UnixNano(), 36),
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	if !a.enabled {
		close(a.done)
		if rdb != nil {
			// Le regroupement est coupé, mais une exécution précédente a pu
			// laisser des deltas dans les compteurs. Les abandonner serait
			// perdre du crédit déjà gagné : on les verse une fois, en fond.
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), flushTimeout)
				defer cancel()
				if n, err := a.Flush(ctx); err != nil {
					slog.Warn("stats: reliquat non versé au démarrage", "err", err)
				} else if n > 0 {
					slog.Info("stats: reliquat versé au démarrage", "membres", n)
				}
			}()
		}
		slog.Info("stats: regroupement désactivé, écriture par annonce")
		return a
	}
	slog.Info("stats: regroupement actif", "fenêtre", interval, "tranche", chunk)
	go a.loop(interval)
	return a
}

// Batching dit si les deltas transitent par l'accumulateur.
func (a *Accumulator) Batching() bool { return a.enabled }

// Add porte un delta au crédit d'un membre.
//
// Regroupement coupé — pas de Redis, ou fenêtre nulle — l'écriture part
// immédiatement. Une panne de Redis fait la même chose plutôt que de perdre le
// crédit.
func (a *Accumulator) Add(ctx context.Context, userID string, up, down int64) error {
	if up == 0 && down == 0 {
		return nil
	}
	if !a.enabled {
		return a.direct(ctx, userID, up, down)
	}
	pipe := a.rdb.Pipeline()
	if up != 0 {
		pipe.HIncrBy(ctx, a.upKey, userID, up)
	}
	if down != 0 {
		pipe.HIncrBy(ctx, a.downKey, userID, down)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		// Redis indisponible : plutôt que de perdre le crédit, on retombe sur
		// l'écriture directe. C'est le chemin lent, mais il est correct.
		slog.Warn("stats: accumulateur indisponible, écriture directe", "err", err)
		return a.direct(ctx, userID, up, down)
	}
	return nil
}

func (a *Accumulator) direct(ctx context.Context, userID string, up, down int64) error {
	return a.q.IncrementUserStats(ctx, queries.IncrementUserStatsParams{
		Uploaded: up, Downloaded: down, ID: userID,
	})
}

// Dropped renvoie le nombre de crédits définitivement perdus.
func (a *Accumulator) Dropped() uint64 { return a.dropped.Load() }

func (a *Accumulator) loop(interval time.Duration) {
	defer close(a.done)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			ctx, cancel := context.WithTimeout(context.Background(), flushTimeout)
			if _, err := a.Flush(ctx); err != nil {
				slog.Warn("stats: versement incomplet, les deltas restent en attente", "err", err)
			}
			cancel()
		case <-a.stop:
			return
		}
	}
}

// Stop arrête la boucle et verse une dernière fois.
//
// Sans ce dernier versement, un SIGTERM perdrait tout ce qui n'a pas encore
// été porté au compte — jusqu'à une fenêtre entière de crédits pour l'ensemble
// des membres, à chaque redéploiement.
func (a *Accumulator) Stop() {
	a.stopOnce.Do(func() {
		if !a.enabled {
			return
		}
		close(a.stop)
		<-a.done
		ctx, cancel := context.WithTimeout(context.Background(), shutdownFlushTimeout)
		defer cancel()
		if n, err := a.Flush(ctx); err != nil {
			slog.Warn("stats: dernier versement incomplet", "portés", n, "err", err)
		} else if n > 0 {
			slog.Info("stats: dernier versement", "membres", n)
		}
	})
}

// Flush porte à Postgres tout ce qui est accumulé, par tranches. Renvoie le
// nombre de membres crédités.
func (a *Accumulator) Flush(ctx context.Context) (int, error) {
	if a.rdb == nil {
		return 0, nil
	}
	// Le verrou n'est pas ce qui garantit la correction — le retrait atomique
	// s'en charge — mais il évite que deux instances balaient les mêmes
	// dizaines de milliers de champs pour se les disputer.
	ok, err := a.rdb.SetArgs(ctx, a.lockKey, a.token, redis.SetArgs{
		Mode: "NX", TTL: flushTimeout,
	}).Result()
	if err != nil && err != redis.Nil {
		return 0, err
	}
	if ok != "OK" {
		return 0, nil
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = releaseLockScript.Run(c, a.rdb, []string{a.lockKey}, a.token).Err()
	}()

	ids, err := a.pendingIDs(ctx)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}

	var written int
	var firstErr error
	for start := 0; start < len(ids); start += a.chunk {
		end := min(start+a.chunk, len(ids))
		n, err := a.flushChunk(ctx, ids[start:end])
		written += n
		if err != nil && firstErr == nil {
			firstErr = err
		}
		if ctx.Err() != nil {
			break
		}
	}
	return written, firstErr
}

// pendingIDs relève les membres qui ont un delta en attente, triés.
//
// Le tri sert à ce que deux versements concurrents, s'ils se recouvraient,
// prennent leurs verrous de ligne dans le même ordre.
func (a *Accumulator) pendingIDs(ctx context.Context) ([]string, error) {
	seen := make(map[string]struct{})
	for _, key := range []string{a.upKey, a.downKey} {
		var cursor uint64
		for {
			fields, next, err := a.rdb.HScan(ctx, key, cursor, "", scanCount).Result()
			if err != nil {
				return nil, err
			}
			// HSCAN renvoie champ, valeur, champ, valeur…
			for i := 0; i < len(fields); i += 2 {
				seen[fields[i]] = struct{}{}
			}
			cursor = next
			if cursor == 0 {
				break
			}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids, nil
}

// flushChunk retire une tranche puis l'écrit. En cas d'échec Postgres, les
// deltas retirés sont réinjectés pour être repris au versement suivant.
func (a *Accumulator) flushChunk(ctx context.Context, ids []string) (int, error) {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	raw, err := takeScript.Run(ctx, a.rdb, []string{a.upKey, a.downKey}, args...).StringSlice()
	if err != nil {
		return 0, err
	}
	if len(raw) != 2*len(ids) {
		return 0, nil
	}

	keep := make([]string, 0, len(ids))
	ups := make([]int64, 0, len(ids))
	downs := make([]int64, 0, len(ids))
	for i, id := range ids {
		up, _ := strconv.ParseInt(raw[2*i], 10, 64)
		down, _ := strconv.ParseInt(raw[2*i+1], 10, 64)
		if up == 0 && down == 0 {
			continue
		}
		keep = append(keep, id)
		ups = append(ups, up)
		downs = append(downs, down)
	}
	if len(keep) == 0 {
		return 0, nil
	}

	if err := a.q.BatchIncrementUserStats(ctx, queries.BatchIncrementUserStatsParams{
		Ids: keep, Ups: ups, Downs: downs,
	}); err != nil {
		a.restore(keep, ups, downs)
		return 0, err
	}
	return len(keep), nil
}

// restore réinjecte des deltas qu'on avait retirés mais pas réussi à écrire.
//
// Son propre contexte, détaché : quand cette fonction est appelée, celui du
// versement est souvent déjà expiré — c'est précisément ce qui a fait échouer
// l'écriture. Le réutiliser perdrait le crédit pour de bon.
func (a *Accumulator) restore(ids []string, ups, downs []int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pipe := a.rdb.Pipeline()
	for i, id := range ids {
		if ups[i] != 0 {
			pipe.HIncrBy(ctx, a.upKey, id, ups[i])
		}
		if downs[i] != 0 {
			pipe.HIncrBy(ctx, a.downKey, id, downs[i])
		}
	}
	if _, err := pipe.Exec(ctx); err != nil {
		a.dropped.Add(uint64(len(ids)))
		// Le cumul, et pas seulement l'incident : c'est la PENTE qui dit si la
		// panne est un hoquet ou une hémorragie, et un incident isolé dans un
		// journal ne la montre pas.
		slog.Error("stats: crédits perdus — retirés de Redis, refusés par Postgres, non réinjectés",
			"membres", len(ids), "perdus_cumulés", a.dropped.Load(), "err", err)
	}
}
