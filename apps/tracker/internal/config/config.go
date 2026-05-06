// Package config loads the tracker configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	HTTPPort       int
	DatabaseURL    string
	RedisURL       string
	RedisPassword  string
	RedisKeyPrefix string
	IPHashSecret   string
	Debug          bool
}

// Load reads configuration from the environment. Required fields without
// values cause an error (we refuse to start with broken security defaults).
func Load() (*Config, error) {
	cfg := &Config{
		HTTPPort:       getEnvInt("TRACKER_HTTP_PORT", 8080),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		RedisURL:       os.Getenv("REDIS_URL"),
		RedisPassword:  os.Getenv("REDIS_PASSWORD"),
		RedisKeyPrefix: getEnvDefault("REDIS_KEY_PREFIX", "ot:"),
		IPHashSecret:   os.Getenv("IP_HASH_SECRET"),
		Debug:          os.Getenv("TRACKER_DEBUG") == "true",
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	if cfg.IPHashSecret == "" {
		return nil, fmt.Errorf("IP_HASH_SECRET is required")
	}

	return cfg, nil
}

func getEnvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
