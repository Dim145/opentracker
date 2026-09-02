package hub

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/relay/internal/config"
)

// Un faux qui retient la DERNIÈRE commande vue par canal.
type recordingSub struct {
	mu   sync.Mutex
	last map[string]string // canal -> "sub" | "unsub"
}

func newRecordingSub() *recordingSub {
	return &recordingSub{last: map[string]string{}}
}

// La latence est le POINT du faux.
//
// La fenêtre de course est l'intervalle entre la décision (sous `mu`) et la
// commande Redis. Un faux instantané la referme presque, et le test passait
// alors même que l'ordonnancement était retiré — un test vert pour de
// mauvaises raisons. Un vrai aller-retour Redis dure des dizaines de
// microsecondes ; on en simule autant.
func (r *recordingSub) note(kind string, channels []string) {
	time.Sleep(50 * time.Microsecond)
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range channels {
		r.last[c] = kind
	}
}

func (r *recordingSub) Subscribe(_ context.Context, channels ...string) error {
	r.note("sub", channels)
	return nil
}

func (r *recordingSub) Unsubscribe(_ context.Context, channels ...string) error {
	r.note("unsub", channels)
	return nil
}

func (r *recordingSub) Channel(_ ...redis.ChannelOption) <-chan *redis.Message {
	return make(chan *redis.Message)
}

func (r *recordingSub) Close() error { return nil }

func (r *recordingSub) lastFor(channel string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.last[channel]
}

// L'abonnement Redis doit toujours refléter l'état de la map.
//
// `Subscribe` et `Unsubscribe` partaient hors du verrou : le dernier lecteur
// s'en allait (la clé quittait `h.conns`), un nouveau arrivait (la clé
// revenait, le canal passait dans `fresh`), puis les deux commandes Redis
// partaient dans l'ordre INVERSE. go-redis n'a pas de compteur de références,
// donc le canal restait présent dans la map et désabonné côté Redis — et
// comme la clé existait, aucun `Add` ultérieur ne le réabonnait. Mort
// silencieux, jusqu'au départ de tous les lecteurs.
//
// L'invariant que ce test défend : à la fin, si le canal est dans `h.conns`,
// la dernière commande vue doit être `sub` ; s'il n'y est plus, `unsub`.
func TestSubscribeAndUnsubscribeNeverInvert(t *testing.T) {
	const channel = "messaging:room:general"
	const rounds = 300

	for attempt := 0; attempt < 20; attempt++ {
		rec := newRecordingSub()
		live := &config.Live{}
		d := config.Defaults()
		d.MaxConnections = rounds * 2
		live.Set(d)
		h := &Hub{
			live:  live,
			conns: make(map[string]map[*Conn]struct{}),
			sub:   rec,
		}

		var wg sync.WaitGroup
		for i := 0; i < rounds; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				c, ok := h.Add(context.Background(), channel)
				if !ok {
					return
				}
				h.Remove(c)
			}()
		}
		// Une connexion SURVIT à la tempête, et c'est le point du test.
		//
		// Si l'on retirait tout, l'état final serait « absent + unsub » quoi
		// qu'il arrive : la panne recherchée — canal PRÉSENT dans la map et
		// DÉSABONNÉ côté Redis — ne peut pas s'observer là. En gardant un
		// lecteur, un `Unsubscribe` resté en vol qui atterrit après le
		// `Subscribe` final produit exactement cet état collant.
		final, ok := h.Add(context.Background(), channel)
		if !ok {
			t.Fatalf("tentative %d : plafond atteint, le test ne mesure rien", attempt)
		}
		wg.Wait()
		// Laisser retomber ce qui est encore en vol.
		time.Sleep(20 * time.Millisecond)

		h.mu.RLock()
		_, present := h.conns[channel]
		h.mu.RUnlock()

		if !present {
			t.Fatalf("tentative %d : le canal a disparu alors qu'un lecteur reste", attempt)
		}
		if got := rec.lastFor(channel); got != "sub" {
			t.Fatalf(
				"tentative %d : un lecteur est présent mais la dernière commande Redis est %q — le canal est désabonné pour de bon, et aucun Add ultérieur ne le réabonnera",
				attempt, got,
			)
		}
		h.Remove(final)
	}
}
