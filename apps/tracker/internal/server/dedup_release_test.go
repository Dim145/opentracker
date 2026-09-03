package server

import (
	"context"
	"testing"
	"time"
)

// Une marque rendue laisse repasser tout de suite.
//
// `CheckAndMarkFor` pose la marque AVANT l'effet de bord qu'elle protège, et
// rien ne la retirait quand cet effet n'avait pas lieu. Pour le crédit de temps
// de seed la fenêtre est de 900 s : une écriture Postgres ratée n'était pas
// seulement perdue, elle interdisait toute reprise pendant un quart d'heure —
// le hit-and-run cessait de mesurer, en silence.
func TestReleaseLetsTheNextAttemptThrough(t *testing.T) {
	d := newDedup(nil, "ot:")
	defer d.Stop()

	ctx := context.Background()
	const key = "hash:user:seedtime"
	const window = 900 * time.Second

	if !d.CheckAndMarkFor(ctx, key, window) {
		t.Fatal("la première tentative doit passer")
	}
	if d.CheckAndMarkFor(ctx, key, window) {
		t.Fatal("la deuxième doit être refusée : c'est le rôle de la marque")
	}

	// L'écriture a échoué : on rend la place.
	d.Release(ctx, key)

	if !d.CheckAndMarkFor(ctx, key, window) {
		t.Fatal("après Release, la reprise doit passer — sinon la perte dure toute la fenêtre")
	}
	if d.CheckAndMarkFor(ctx, key, window) {
		t.Fatal("Release ne doit pas désarmer la marque pour de bon")
	}
}

// Rendre une marque qui n'existe pas ne casse rien, et n'en crée pas une.
func TestReleaseOfAnUnknownKeyIsHarmless(t *testing.T) {
	d := newDedup(nil, "ot:")
	defer d.Stop()

	ctx := context.Background()
	d.Release(ctx, "jamais-posee")
	if !d.CheckAndMarkFor(ctx, "jamais-posee", time.Minute) {
		t.Fatal("Release ne doit pas laisser d'état derrière lui")
	}
}
