package stats

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/tracker/internal/queries"
)

// recorder note ce que l'accumulateur a réellement demandé à Postgres.
//
// Il enregistre les APPELS et non seulement les totaux : la moitié des pannes
// que ces tests visent — le versement d'un bloc, la double écriture — ne se
// voient que dans le découpage des appels, pas dans la somme.
type recorder struct {
	mu     sync.Mutex
	batch  [][]queries.BatchIncrementUserStatsParams
	single []queries.IncrementUserStatsParams
	fail   error
}

func (r *recorder) IncrementUserStats(_ context.Context, p queries.IncrementUserStatsParams) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail != nil {
		return r.fail
	}
	r.single = append(r.single, p)
	return nil
}

func (r *recorder) BatchIncrementUserStats(_ context.Context, p queries.BatchIncrementUserStatsParams) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail != nil {
		return r.fail
	}
	r.batch = append(r.batch, []queries.BatchIncrementUserStatsParams{p})
	return nil
}

// totals additionne ce qui a été porté au compte de chaque membre, tous appels
// confondus.
func (r *recorder) totals() map[string][2]int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string][2]int64{}
	for _, call := range r.batch {
		p := call[0]
		for i, id := range p.Ids {
			t := out[id]
			t[0] += p.Ups[i]
			t[1] += p.Downs[i]
			out[id] = t
		}
	}
	for _, p := range r.single {
		t := out[p.ID]
		t[0] += p.Uploaded
		t[1] += p.Downloaded
		out[p.ID] = t
	}
	return out
}

func (r *recorder) callSizes() []int {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]int, 0, len(r.batch))
	for _, call := range r.batch {
		out = append(out, len(call[0].Ids))
	}
	return out
}

func (r *recorder) setFail(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fail = err
}

// newTestAcc monte un accumulateur qui regroupe, avec une fenêtre assez longue
// pour que sa boucle ne verse jamais d'elle-même : les tests versent
// explicitement, sans dépendre d'un minuteur.
//
// Une fenêtre à ZÉRO ne conviendrait pas — c'est une demande de désactivation,
// et l'accumulateur écrirait alors directement.
func newTestAcc(t *testing.T, chunk int) (*Accumulator, *recorder, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rec := &recorder{}
	a := New(client, rec, "ot:", time.Hour, chunk)
	t.Cleanup(a.Stop)
	if !a.Batching() {
		t.Fatal("l'accumulateur devrait regrouper")
	}
	return a, rec, mr
}

// TestCoalescesRepeatedCredits est la raison d'être du paquet : un membre qui
// seede plusieurs torrents met à jour SA PROPRE ligne à chaque annonce, et
// c'est cette répétition que le regroupement doit supprimer.
//
// Le test échoue si `Add` écrit directement : on verrait quatre écritures
// séparées au lieu d'une, et `callSizes` ne vaudrait pas [2].
func TestCoalescesRepeatedCredits(t *testing.T) {
	ctx := context.Background()
	a, rec, _ := newTestAcc(t, 10)

	for _, d := range []struct {
		id       string
		up, down int64
	}{
		{"alice", 100, 10},
		{"alice", 200, 20},
		{"alice", 300, 30},
		{"bob", 7, 3},
	} {
		if err := a.Add(ctx, d.id, d.up, d.down); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	if len(rec.callSizes()) != 0 {
		t.Fatalf("rien ne devait partir vers Postgres avant le versement, vu %v", rec.callSizes())
	}

	n, err := a.Flush(ctx)
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if n != 2 {
		t.Fatalf("deux membres crédités attendus, vu %d", n)
	}
	if got := rec.callSizes(); len(got) != 1 || got[0] != 2 {
		t.Fatalf("un seul appel de deux membres attendu, vu %v", got)
	}
	want := map[string][2]int64{"alice": {600, 60}, "bob": {7, 3}}
	for id, w := range want {
		if got := rec.totals()[id]; got != w {
			t.Fatalf("%s : %v attendu, vu %v", id, w, got)
		}
	}
}

// TestFlushIsChunked verrouille la décision qui inverse tout le résultat.
//
// Un versement d'un seul bloc empêche l'élagage HOT de recycler la place en
// page et écrit PLUS de WAL que les écritures unitaires qu'il remplace. La
// mesure est dans l'en-tête du paquet ; ce test est ce qui empêche quelqu'un
// de « simplifier » le découpage sans la relire.
func TestFlushIsChunked(t *testing.T) {
	ctx := context.Background()
	a, rec, _ := newTestAcc(t, 10)

	const members = 25
	for i := range members {
		id := string(rune('a'+i/26)) + string(rune('a'+i%26))
		if err := a.Add(ctx, id, int64(i+1), int64(i+1)); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	if _, err := a.Flush(ctx); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	sizes := rec.callSizes()
	if len(sizes) != 3 {
		t.Fatalf("25 membres par tranches de 10 = 3 appels, vu %d : %v", len(sizes), sizes)
	}
	for _, s := range sizes {
		if s > 10 {
			t.Fatalf("une tranche dépasse la taille demandée : %v", sizes)
		}
	}
	if total := len(rec.totals()); total != members {
		t.Fatalf("%d membres crédités attendus, vu %d", members, total)
	}
}

// TestPostgresFailureLosesNothing : l'ancien chemin perdait le crédit en
// silence dès qu'un `UPDATE` échouait — un `slog.Warn`, aucune reprise.
// Retirer une tranche de Redis avant de l'écrire ne doit pas reproduire ça.
//
// Le test échoue si `restore` disparaît : le second versement ne verrait plus
// rien à écrire et les totaux seraient vides.
func TestPostgresFailureLosesNothing(t *testing.T) {
	ctx := context.Background()
	a, rec, _ := newTestAcc(t, 10)

	if err := a.Add(ctx, "alice", 1000, 100); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := a.Add(ctx, "bob", 2000, 200); err != nil {
		t.Fatalf("Add: %v", err)
	}

	rec.setFail(errors.New("postgres est parti"))
	if _, err := a.Flush(ctx); err == nil {
		t.Fatal("le versement devait signaler l'échec de Postgres")
	}
	if len(rec.totals()) != 0 {
		t.Fatalf("rien ne devait être porté au compte, vu %v", rec.totals())
	}
	if a.Dropped() != 0 {
		t.Fatalf("les deltas étaient réinjectables, aucun ne devait être compté perdu (vu %d)", a.Dropped())
	}

	// Postgres revient : le versement suivant doit porter les MÊMES totaux,
	// une seule fois.
	rec.setFail(nil)
	if _, err := a.Flush(ctx); err != nil {
		t.Fatalf("second Flush: %v", err)
	}
	want := map[string][2]int64{"alice": {1000, 100}, "bob": {2000, 200}}
	for id, w := range want {
		if got := rec.totals()[id]; got != w {
			t.Fatalf("%s : %v attendu après reprise, vu %v", id, w, got)
		}
	}
}

// TestConcurrentFlushNeverDoubleCredits.
//
// Deux instances derrière un répartiteur versent depuis le MÊME accumulateur.
// Si le retrait n'était pas atomique — un HGETALL suivi d'un HDEL après
// l'écriture, par exemple — les deux liraient la même valeur et la porteraient
// chacune au compte : le membre serait crédité deux fois.
//
// Le test attaque `flushChunk` directement plutôt que `Flush`, parce que le
// verrou de versement ferait sortir le second appel avant même d'atteindre le
// retrait — et masquerait exactement ce qu'on veut éprouver.
func TestConcurrentFlushNeverDoubleCredits(t *testing.T) {
	ctx := context.Background()
	a, rec, _ := newTestAcc(t, 10)

	const members = 40
	ids := make([]string, 0, members)
	for i := range members {
		id := string(rune('a'+i/26)) + string(rune('a'+i%26))
		ids = append(ids, id)
		if err := a.Add(ctx, id, 1000, 100); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for start := 0; start < len(ids); start += 10 {
				_, _ = a.flushChunk(ctx, ids[start:min(start+10, len(ids))])
			}
		}()
	}
	wg.Wait()

	totals := rec.totals()
	if len(totals) != members {
		t.Fatalf("%d membres attendus, vu %d", members, len(totals))
	}
	for id, got := range totals {
		if got != [2]int64{1000, 100} {
			t.Fatalf("%s crédité %v — le delta a été porté plus d'une fois", id, got)
		}
	}
}

// TestStopFlushesWhatIsPending : sans ce dernier versement, chaque
// redéploiement perdrait une fenêtre entière de crédits, pour tous les membres
// à la fois — silencieusement.
func TestStopFlushesWhatIsPending(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rec := &recorder{}
	// Une fenêtre longue : seul l'arrêt peut verser dans le temps du test.
	a := New(client, rec, "ot:", time.Hour, 10)

	if err := a.Add(ctx, "alice", 4242, 42); err != nil {
		t.Fatalf("Add: %v", err)
	}
	a.Stop()

	if got := rec.totals()["alice"]; got != [2]int64{4242, 42} {
		t.Fatalf("l'arrêt devait verser le delta en attente, vu %v", got)
	}
}

// TestWithoutRedisWritesThrough : sans Redis, l'accumulateur doit se comporter
// exactement comme le chemin d'origine. C'est ce qui rend son introduction
// transparente pour les tests du serveur, qui n'en ont pas.
func TestWithoutRedisWritesThrough(t *testing.T) {
	ctx := context.Background()
	rec := &recorder{}
	a := New(nil, rec, "ot:", time.Hour, 10)

	if err := a.Add(ctx, "alice", 10, 1); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := a.Add(ctx, "alice", 20, 2); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if len(rec.single) != 2 {
		t.Fatalf("deux écritures directes attendues, vu %d", len(rec.single))
	}
	if got := rec.totals()["alice"]; got != [2]int64{30, 3} {
		t.Fatalf("totaux %v", got)
	}
	// Ni panique ni blocage sur un accumulateur sans boucle.
	a.Stop()
}

// TestDisabledIntervalWritesThrough : `TRACKER_STATS_FLUSH_INTERVAL=0` doit
// rendre au chemin son écriture par annonce, AVEC un Redis présent.
//
// Ce test existe parce que sa panne est passée à travers tout le reste. La
// première version ne regardait que `rdb == nil` : avec Redis branché et une
// fenêtre à zéro, `Add` accumulait toujours, aucune boucle ne versait, et les
// deltas s'empilaient indéfiniment dans Redis. La porte de sortie n'ouvrait
// sur rien. `TestWithoutRedisWritesThrough` ne pouvait pas le voir — il coupe
// Redis, pas la fenêtre — et seule la pile compilée l'a montré.
func TestDisabledIntervalWritesThrough(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	rec := &recorder{}
	a := New(client, rec, "ot:", 0, 10)

	if a.Batching() {
		t.Fatal("une fenêtre nulle doit désactiver le regroupement")
	}
	if err := a.Add(ctx, "alice", 100, 10); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if len(rec.single) != 1 {
		t.Fatalf("écriture directe attendue, vu %d écriture(s) unitaire(s)", len(rec.single))
	}
	if mr.Exists("ot:trk:stats:up") {
		t.Fatal("rien ne doit s'accumuler dans Redis quand le regroupement est coupé")
	}
}

// TestZeroDeltaIsNotWritten : le chemin d'annonce n'appelle `Add` que sur un
// delta non nul, mais un compteur à zéro laissé dans Redis ferait écrire une
// ligne pour ne rien y ajouter, à chaque versement, indéfiniment.
func TestZeroDeltaIsNotWritten(t *testing.T) {
	ctx := context.Background()
	a, rec, _ := newTestAcc(t, 10)

	if err := a.Add(ctx, "alice", 0, 0); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := a.Flush(ctx); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(rec.callSizes()) != 0 || len(rec.single) != 0 {
		t.Fatalf("aucune écriture attendue, vu %v / %d", rec.callSizes(), len(rec.single))
	}
}

// TestUploadOnlyCreditIsFlushed : un seedeur pur n'a qu'un delta d'upload, donc
// son identifiant n'existe que dans UN des deux compteurs. Ne balayer qu'un
// seul d'entre eux laisserait un membre sur deux sans crédit.
func TestUploadOnlyCreditIsFlushed(t *testing.T) {
	ctx := context.Background()
	a, rec, _ := newTestAcc(t, 10)

	if err := a.Add(ctx, "seeder", 5000, 0); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := a.Add(ctx, "leecher", 0, 9000); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := a.Flush(ctx); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if got := rec.totals()["seeder"]; got != [2]int64{5000, 0} {
		t.Fatalf("seedeur : %v", got)
	}
	if got := rec.totals()["leecher"]; got != [2]int64{0, 9000} {
		t.Fatalf("leecheur : %v", got)
	}
}
