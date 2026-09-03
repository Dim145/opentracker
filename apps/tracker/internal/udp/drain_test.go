package udp

import (
	"context"
	"io"
	"log/slog"
	"net"
	"sync"
	"testing"
	"time"
)

// newDrainServer monte un serveur UDP réduit au strict nécessaire pour
// éprouver `Close` : une vraie socket, le sémaphore d'admission, et un
// traitement que le test contrôle.
//
// Pas de `New()` : celui-ci exige un `*server.Server` (Postgres) et un
// `*peers.Store` (Redis), dont le drain n'a rien à faire. C'est la raison
// d'être du champ `handle`.
func newDrainServer(t *testing.T, handle func(context.Context, *[]byte, int, *net.UDPAddr)) *Server {
	t.Helper()
	addr, err := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &Server{
		conn:      conn,
		addr:      conn.LocalAddr().(*net.UDPAddr),
		logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		workerSem: make(chan struct{}, 16),
		handle:    handle,
	}
	s.bufPool = sync.Pool{New: func() any { b := make([]byte, maxUDPPacket); return &b }}
	return s
}

func send(t *testing.T, to *net.UDPAddr, payload []byte) {
	t.Helper()
	c, err := net.DialUDP("udp", nil, to)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()
	if _, err := c.Write(payload); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// TestCloseWaitsForInFlightDatagrams.
//
// `main.go` affirmait « UDP has no in-flight connections to drain » : vrai du
// protocole, faux de l'implémentation. Chaque datagramme part dans sa propre
// goroutine, et `Close` ne fermait que la socket — le processus sortait en
// abandonnant les écritures Postgres en cours. Une annonce en vol perdait son
// crédit, silencieusement, à chaque redémarrage.
//
// Le test bloque le traitement, appelle `Close`, et vérifie qu'il n'a PAS
// rendu la main tant que le traitement n'est pas fini.
func TestCloseWaitsForInFlightDatagrams(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})

	// Déclaré avant l'affectation : la fermeture capture la VARIABLE, qui est
	// renseignée avant que le premier datagramme n'arrive.
	var s *Server
	s = newDrainServer(t, func(_ context.Context, bufp *[]byte, _ int, _ *net.UDPAddr) {
		defer s.bufPool.Put(bufp)
		close(started)
		<-release
		close(finished)
	})

	go func() { _ = s.Serve(context.Background()) }()
	send(t, s.Addr(), []byte("un datagramme quelconque"))

	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("le traitement n'a jamais démarré — le test ne prouverait rien")
	}

	closed := make(chan struct{})
	go func() { _ = s.Close(); close(closed) }()

	// `Close` doit être RETENU par le traitement en cours.
	select {
	case <-closed:
		t.Fatal("Close a rendu la main alors qu'un datagramme était encore en traitement")
	case <-time.After(300 * time.Millisecond):
	}

	close(release)
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("le traitement ne s'est jamais terminé")
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("Close ne rend pas la main après la fin du traitement")
	}
}

// TestCloseReturnsPromptlyWhenIdle est le contrôle négatif.
//
// Sans lui, le test précédent serait satisfait par un `Close` qui attend
// toujours cinq secondes — le comportement serait « lent » plutôt que
// « correct », et personne ne le verrait.
func TestCloseReturnsPromptlyWhenIdle(t *testing.T) {
	s := newDrainServer(t, func(_ context.Context, bufp *[]byte, _ int, _ *net.UDPAddr) {})
	go func() { _ = s.Serve(context.Background()) }()
	// Laisse la boucle de lecture s'installer.
	time.Sleep(50 * time.Millisecond)

	start := time.Now()
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Close a mis %v sans rien à attendre — il ne devrait pas patienter", elapsed)
	}
}

// TestCloseGivesUpAfterTheDrainTimeout : une base bloquée ne doit pas
// suspendre l'arrêt indéfiniment. Le plafond partage le délai de grâce du
// conteneur avec le drain HTTP, le versement des crédits et les tâches de
// fond ; le dépasser ferait couper le processus au SIGKILL, ce qui est pire.
func TestCloseGivesUpAfterTheDrainTimeout(t *testing.T) {
	if udpDrainTimeout > 10*time.Second {
		t.Fatalf("udpDrainTimeout = %v : trop long pour le budget d'arrêt documenté", udpDrainTimeout)
	}
	s := newDrainServer(t, nil)
	// Une goroutine fantôme qui ne finit jamais : exactement ce que le
	// plafond existe pour abandonner.
	s.inflight.Add(1)
	start := time.Now()
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed < udpDrainTimeout {
		t.Fatalf("Close a rendu la main en %v, avant son propre plafond de %v", elapsed, udpDrainTimeout)
	}
	if elapsed > udpDrainTimeout+2*time.Second {
		t.Fatalf("Close a mis %v, bien au-delà de son plafond de %v", elapsed, udpDrainTimeout)
	}
	s.inflight.Done()
}
