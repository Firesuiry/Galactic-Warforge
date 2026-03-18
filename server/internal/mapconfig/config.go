package mapconfig

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// GalaxyConfig defines galaxy-level scale.
type GalaxyConfig struct {
	SystemCount int `yaml:"system_count"`
}

// SystemConfig defines system-level scale.
type SystemConfig struct {
	PlanetsPerSystem int `yaml:"planets_per_system"`
}

// PlanetConfig defines planet-level scale and generation.
type PlanetConfig struct {
	Width            int `yaml:"width"`
	Height           int `yaml:"height"`
	ResourceDensity  int `yaml:"resource_density"` // percent of tiles with deposits
}

// Config is the root map configuration.
type Config struct {
	Galaxy GalaxyConfig `yaml:"galaxy"`
	System SystemConfig `yaml:"system"`
	Planet PlanetConfig `yaml:"planet"`
}

// Load reads and validates a map config from a YAML file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read map config: %w", err)
	}

	cfg := &Config{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse map config: %w", err)
	}

	// Defaults
	if cfg.Galaxy.SystemCount == 0 {
		cfg.Galaxy.SystemCount = 2
	}
	if cfg.System.PlanetsPerSystem == 0 {
		cfg.System.PlanetsPerSystem = 3
	}
	if cfg.Planet.Width == 0 {
		cfg.Planet.Width = 32
	}
	if cfg.Planet.Height == 0 {
		cfg.Planet.Height = 32
	}
	if cfg.Planet.ResourceDensity == 0 {
		cfg.Planet.ResourceDensity = 12
	}

	// Validation
	if cfg.Galaxy.SystemCount < 1 {
		return nil, fmt.Errorf("galaxy.system_count must be >= 1")
	}
	if cfg.System.PlanetsPerSystem < 1 {
		return nil, fmt.Errorf("system.planets_per_system must be >= 1")
	}
	if cfg.Planet.Width < 4 || cfg.Planet.Height < 4 {
		return nil, fmt.Errorf("planet width/height must be >= 4")
	}
	if cfg.Planet.ResourceDensity < 0 || cfg.Planet.ResourceDensity > 100 {
		return nil, fmt.Errorf("planet.resource_density must be 0..100")
	}

	return cfg, nil
}
