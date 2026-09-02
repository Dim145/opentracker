package peers

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

// Le plafond compte les ENTRÉES, pas les écritures.
//
// `storeBounded` incrémentait à chaque `Store`, y compris pour une clé déjà
// présente, et `invalidateCounts` — appelé à chaque annonce — supprimait sans
// décrémenter. Le compteur dérivait donc vers 50 000 en comptant du TRAFIC :
// sur un tracker à mille annonces par seconde, le vidage total des deux caches
// revenait toutes les quelques minutes, et chacun provoque une rafale de
// `HGETALL` sur tous les essaims vivants.
func TestStoreBoundedCountsEntriesNotWrites(t *testing.T) {
	var m sync.Map
	var n atomic.Int64

	// Une seule clé, réécrite bien au-delà du plafond.
	for i := 0; i < maxSwarmCache*3; i++ {
		storeBounded(&m, &n, "un-seul-essaim", i)
	}
	if got := n.Load(); got != 1 {
		t.Fatalf("une clé réécrite %d fois donne un compteur de %d, attendu 1", maxSwarmCache*3, got)
	}
	if _, ok := m.Load("un-seul-essaim"); !ok {
		t.Fatal("la clé a disparu : le plafond s'est déclenché sur du trafic")
	}

	// Poser puis retirer, en boucle : le compteur doit revenir à zéro.
	for i := 0; i < maxSwarmCache*2; i++ {
		k := fmt.Sprintf("essaim-%d", i)
		storeBounded(&m, &n, k, i)
		deleteCounted(&m, &n, k)
	}
	if got := n.Load(); got != 1 {
		t.Fatalf("après autant de poses que de retraits, le compteur vaut %d, attendu 1 (la clé initiale)", got)
	}
}

// Le plafond agit quand il doit : autant de clés DISTINCTES que la borne.
func TestStoreBoundedStillEvictsOnRealGrowth(t *testing.T) {
	var m sync.Map
	var n atomic.Int64

	for i := 0; i <= maxSwarmCache; i++ {
		storeBounded(&m, &n, fmt.Sprintf("essaim-%d", i), i)
	}
	if got := n.Load(); got != 1 {
		t.Fatalf("le vidage n'a pas eu lieu : compteur %d après %d clés distinctes", got, maxSwarmCache+1)
	}
	count := 0
	m.Range(func(_, _ any) bool { count++; return true })
	if count != 1 {
		t.Fatalf("après vidage, %d entrées restent, attendu 1", count)
	}
}
