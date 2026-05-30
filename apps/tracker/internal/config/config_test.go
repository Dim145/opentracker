package config

import (
	"testing"
	"time"
)

// withEnv runs f with the given env vars set; restores the previous
// values after. Keeps tests isolated from the developer's actual env.
func withEnv(t *testing.T, env map[string]string, f func()) {
	t.Helper()
	saved := make(map[string]string, len(env))
	for k, v := range env {
		saved[k] = getRawEnv(k)
		t.Setenv(k, v)
		_ = v // satisfy go vet
	}
	defer func() {
		for k, v := range saved {
			if v == "" {
				_ = unsetIfWritable(t, k)
				continue
			}
			t.Setenv(k, v)
		}
	}()
	f()
}

func getRawEnv(k string) string {
	// t.Setenv automatically restores on teardown; the helper above
	// is intentional indirection in case future tests need to peek.
	return "" // unused — t.Setenv handles restore
}

func unsetIfWritable(t *testing.T, k string) error {
	t.Helper()
	t.Setenv(k, "")
	return nil
}

// ----------------------------------------------------------------------------
// Load — required field rejection
// ----------------------------------------------------------------------------

func TestLoad_RequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for missing DATABASE_URL")
	}
}

func TestLoad_RequiresRedisURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for missing REDIS_URL")
	}
}

func TestLoad_RequiresIPHashSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("IP_HASH_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for missing IP_HASH_SECRET")
	}
}

// ----------------------------------------------------------------------------
// Load — defaults
// ----------------------------------------------------------------------------

func TestLoad_DefaultsApplied(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	// Leave all the optional vars unset.
	t.Setenv("TRACKER_HTTP_PORT", "")
	t.Setenv("TRACKER_UDP_PORT", "")
	t.Setenv("TRACKER_UDP_ENABLED", "")
	t.Setenv("REDIS_KEY_PREFIX", "")
	t.Setenv("TRACKER_DEBUG", "")
	t.Setenv("TRACKER_PEER_TTL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPPort != 8080 {
		t.Errorf("HTTPPort: got %d, want 8080", cfg.HTTPPort)
	}
	if cfg.UDPPort != 6969 {
		t.Errorf("UDPPort: got %d, want 6969", cfg.UDPPort)
	}
	if !cfg.UDPEnabled {
		t.Error("UDPEnabled: got false, want true (default)")
	}
	if cfg.RedisKeyPrefix != "ot:" {
		t.Errorf("RedisKeyPrefix: got %q, want %q", cfg.RedisKeyPrefix, "ot:")
	}
	if cfg.Debug {
		t.Error("Debug: got true, want false (default)")
	}
	if cfg.PeerTTL != defaultPeerTTL {
		t.Errorf("PeerTTL: got %v, want %v", cfg.PeerTTL, defaultPeerTTL)
	}
}

// ----------------------------------------------------------------------------
// Load — overrides
// ----------------------------------------------------------------------------

func TestLoad_PortOverrides(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	t.Setenv("TRACKER_HTTP_PORT", "9090")
	t.Setenv("TRACKER_UDP_PORT", "9999")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPPort != 9090 {
		t.Errorf("HTTPPort: got %d, want 9090", cfg.HTTPPort)
	}
	if cfg.UDPPort != 9999 {
		t.Errorf("UDPPort: got %d, want 9999", cfg.UDPPort)
	}
}

func TestLoad_UDPDisabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	t.Setenv("TRACKER_UDP_ENABLED", "false")

	cfg, _ := Load()
	if cfg.UDPEnabled {
		t.Error("UDPEnabled: got true, want false")
	}
}

func TestLoad_DebugEnabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	t.Setenv("TRACKER_DEBUG", "true")

	cfg, _ := Load()
	if !cfg.Debug {
		t.Error("Debug: got false, want true")
	}
}

// ----------------------------------------------------------------------------
// getEnvInt — invalid value falls back to default
// ----------------------------------------------------------------------------

func TestLoad_InvalidPortFallsBackToDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	t.Setenv("TRACKER_HTTP_PORT", "not-a-number")

	cfg, _ := Load()
	if cfg.HTTPPort != 8080 {
		t.Errorf("HTTPPort: got %d, want 8080 (fallback)", cfg.HTTPPort)
	}
}

// ----------------------------------------------------------------------------
// getEnvDuration
// ----------------------------------------------------------------------------

func TestGetEnvDuration_ValidParses(t *testing.T) {
	t.Setenv("X_TTL", "2h30m")
	got := getEnvDuration("X_TTL", 1*time.Hour)
	if got != 2*time.Hour+30*time.Minute {
		t.Fatalf("got %v, want 2h30m", got)
	}
}

func TestGetEnvDuration_UnsetFallsBack(t *testing.T) {
	t.Setenv("X_TTL", "")
	got := getEnvDuration("X_TTL", 7*time.Hour)
	if got != 7*time.Hour {
		t.Fatalf("got %v, want 7h", got)
	}
}

func TestGetEnvDuration_MalformedFallsBack(t *testing.T) {
	t.Setenv("X_TTL", "not a duration")
	got := getEnvDuration("X_TTL", 5*time.Minute)
	if got != 5*time.Minute {
		t.Fatalf("got %v, want 5m", got)
	}
}

func TestGetEnvDuration_NegativeFallsBack(t *testing.T) {
	t.Setenv("X_TTL", "-1h")
	got := getEnvDuration("X_TTL", 3*time.Hour)
	if got != 3*time.Hour {
		t.Fatalf("got %v, want 3h (negative duration rejected)", got)
	}
}

func TestGetEnvDuration_ZeroFallsBack(t *testing.T) {
	t.Setenv("X_TTL", "0s")
	got := getEnvDuration("X_TTL", 4*time.Hour)
	if got != 4*time.Hour {
		t.Fatalf("got %v, want 4h (zero duration rejected)", got)
	}
}

func TestLoad_PeerTTLOverride(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("IP_HASH_SECRET", "test-secret-0123456789abcdef0123")
	t.Setenv("TRACKER_PEER_TTL", "6h")

	cfg, _ := Load()
	if cfg.PeerTTL != 6*time.Hour {
		t.Errorf("PeerTTL: got %v, want 6h", cfg.PeerTTL)
	}
}
