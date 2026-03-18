package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// PlayerConfig holds player identity and auth key
type PlayerConfig struct {
	PlayerID string `yaml:"player_id"`
	Key      string `yaml:"key"`
}

// BattlefieldConfig holds battlefield parameters
type BattlefieldConfig struct {
	MapSeed     string `yaml:"map_seed"`
	MaxTickRate int    `yaml:"max_tick_rate"`
	VictoryRule string `yaml:"victory_rule"`
	MapWidth    int    `yaml:"map_width"`
	MapHeight   int    `yaml:"map_height"`
}

// ServerConfig holds HTTP server settings
type ServerConfig struct {
	Port      int `yaml:"port"`
	RateLimit int `yaml:"rate_limit"` // commands per second per player
}

// Config is the root configuration structure
type Config struct {
	Battlefield BattlefieldConfig `yaml:"battlefield"`
	Players     []PlayerConfig    `yaml:"players"`
	Server      ServerConfig      `yaml:"server"`
}

// KeyToPlayer maps auth keys to player IDs
func (c *Config) KeyToPlayer() map[string]string {
	m := make(map[string]string, len(c.Players))
	for _, p := range c.Players {
		m[p.Key] = p.PlayerID
	}
	return m
}

// Load reads and parses config from a YAML file
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	cfg := &Config{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// Set defaults
	if cfg.Battlefield.MaxTickRate == 0 {
		cfg.Battlefield.MaxTickRate = 10
	}
	if cfg.Battlefield.MapWidth == 0 {
		cfg.Battlefield.MapWidth = 32
	}
	if cfg.Battlefield.MapHeight == 0 {
		cfg.Battlefield.MapHeight = 32
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.RateLimit == 0 {
		cfg.Server.RateLimit = 10
	}
	if cfg.Battlefield.VictoryRule == "" {
		cfg.Battlefield.VictoryRule = "elimination"
	}

	if len(cfg.Players) == 0 {
		return nil, fmt.Errorf("at least one player required")
	}

	return cfg, nil
}
