package mapconfig

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// GalaxyConfig defines galaxy-level scale.
type GalaxyConfig struct {
	SystemCount int     `yaml:"system_count"`
	Width       float64 `yaml:"width"`
	Height      float64 `yaml:"height"`
}

// SystemConfig defines system-level scale.
type SystemConfig struct {
	PlanetsPerSystem int     `yaml:"planets_per_system"`
	GasGiantRatio    float64 `yaml:"gas_giant_ratio"`
	MaxMoons         int     `yaml:"max_moons"`
}

// RangeConfig defines a min/max range for numeric values.
type RangeConfig struct {
	Min *float64 `yaml:"min"`
	Max *float64 `yaml:"max"`
}

// TerrainConfig defines static terrain ratios.
type TerrainConfig struct {
	WaterRatio   *float64 `yaml:"water_ratio"`
	LavaRatio    *float64 `yaml:"lava_ratio"`
	BlockedRatio *float64 `yaml:"blocked_ratio"`
}

// EnvironmentConfig defines environmental parameter ranges.
type EnvironmentConfig struct {
	Wind            RangeConfig `yaml:"wind"`
	Light           RangeConfig `yaml:"light"`
	DayLengthHours  RangeConfig `yaml:"day_length_hours"`
	TidalLockChance *float64    `yaml:"tidal_lock_chance"`
}

// ResourceConfig defines resource distribution parameters on a planet.
type ResourceConfig struct {
	RareChance            float64 `yaml:"rare_chance"`
	ClusterMin            int     `yaml:"cluster_min"`
	ClusterMax            int     `yaml:"cluster_max"`
	ClusterRadius         int     `yaml:"cluster_radius"`
	VeinAmountMin         int     `yaml:"vein_amount_min"`
	VeinAmountMax         int     `yaml:"vein_amount_max"`
	VeinYieldMin          int     `yaml:"vein_yield_min"`
	VeinYieldMax          int     `yaml:"vein_yield_max"`
	OilYieldMin           int     `yaml:"oil_yield_min"`
	OilYieldMax           int     `yaml:"oil_yield_max"`
	OilMinYield           int     `yaml:"oil_min_yield"`
	OilDecayPerTick       int     `yaml:"oil_decay_per_tick"`
	RenewableRegenPerTick int     `yaml:"renewable_regen_per_tick"`
}

// PlanetConfig defines planet-level scale and generation.
type PlanetConfig struct {
	Width           int               `yaml:"width"`
	Height          int               `yaml:"height"`
	ResourceDensity int               `yaml:"resource_density"` // percent of tiles with deposits
	Terrain         TerrainConfig     `yaml:"terrain"`
	Environment     EnvironmentConfig `yaml:"environment"`
	Resources       ResourceConfig    `yaml:"resources"`
}

// Config is the root map configuration.
type Config struct {
	Galaxy GalaxyConfig `yaml:"galaxy"`
	System SystemConfig `yaml:"system"`
	Planet PlanetConfig `yaml:"planet"`
}

// ApplyDefaults fills missing config values with defaults.
func ApplyDefaults(cfg *Config) {
	if cfg == nil {
		return
	}

	// Defaults
	if cfg.Galaxy.SystemCount == 0 {
		cfg.Galaxy.SystemCount = 2
	}
	if cfg.Galaxy.Width == 0 {
		cfg.Galaxy.Width = 1000
	}
	if cfg.Galaxy.Height == 0 {
		cfg.Galaxy.Height = 1000
	}
	if cfg.System.PlanetsPerSystem == 0 {
		cfg.System.PlanetsPerSystem = 3
	}
	if cfg.System.GasGiantRatio == 0 {
		cfg.System.GasGiantRatio = 0.35
	}
	if cfg.System.MaxMoons == 0 {
		cfg.System.MaxMoons = 4
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

	setFloatDefault(&cfg.Planet.Terrain.WaterRatio, 0.12)
	setFloatDefault(&cfg.Planet.Terrain.LavaRatio, 0.04)
	setFloatDefault(&cfg.Planet.Terrain.BlockedRatio, 0.08)

	setRangeDefaults(&cfg.Planet.Environment.Wind, 0.6, 1.4)
	setRangeDefaults(&cfg.Planet.Environment.Light, 0.6, 1.5)
	setRangeDefaults(&cfg.Planet.Environment.DayLengthHours, 12, 48)
	setFloatDefault(&cfg.Planet.Environment.TidalLockChance, 0.1)

	setResourceDefaults(&cfg.Planet.Resources)
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

	ApplyDefaults(cfg)

	// Validation
	if cfg.Galaxy.SystemCount < 1 {
		return nil, fmt.Errorf("galaxy.system_count must be >= 1")
	}
	if cfg.Galaxy.Width <= 0 || cfg.Galaxy.Height <= 0 {
		return nil, fmt.Errorf("galaxy width/height must be > 0")
	}
	if cfg.System.PlanetsPerSystem < 1 {
		return nil, fmt.Errorf("system.planets_per_system must be >= 1")
	}
	if cfg.System.GasGiantRatio < 0 || cfg.System.GasGiantRatio > 1 {
		return nil, fmt.Errorf("system.gas_giant_ratio must be 0..1")
	}
	if cfg.System.MaxMoons < 0 {
		return nil, fmt.Errorf("system.max_moons must be >= 0")
	}
	if cfg.Planet.Width < 4 || cfg.Planet.Height < 4 {
		return nil, fmt.Errorf("planet width/height must be >= 4")
	}
	if cfg.Planet.ResourceDensity < 0 || cfg.Planet.ResourceDensity > 100 {
		return nil, fmt.Errorf("planet.resource_density must be 0..100")
	}
	if err := validateTerrain(cfg.Planet.Terrain); err != nil {
		return nil, err
	}
	if err := validateEnvironment(cfg.Planet.Environment); err != nil {
		return nil, err
	}
	if err := validateResources(cfg.Planet.Resources); err != nil {
		return nil, err
	}

	return cfg, nil
}

func validateTerrain(cfg TerrainConfig) error {
	water := valueOrZero(cfg.WaterRatio)
	lava := valueOrZero(cfg.LavaRatio)
	blocked := valueOrZero(cfg.BlockedRatio)
	if water < 0 || water > 1 {
		return fmt.Errorf("planet.terrain.water_ratio must be 0..1")
	}
	if lava < 0 || lava > 1 {
		return fmt.Errorf("planet.terrain.lava_ratio must be 0..1")
	}
	if blocked < 0 || blocked > 1 {
		return fmt.Errorf("planet.terrain.blocked_ratio must be 0..1")
	}
	if water+lava+blocked > 1 {
		return fmt.Errorf("planet.terrain ratios must sum to <= 1")
	}
	return nil
}

func validateEnvironment(cfg EnvironmentConfig) error {
	if err := validateRange(cfg.Wind, "planet.environment.wind"); err != nil {
		return err
	}
	if err := validateRange(cfg.Light, "planet.environment.light"); err != nil {
		return err
	}
	if err := validateRange(cfg.DayLengthHours, "planet.environment.day_length_hours"); err != nil {
		return err
	}
	if cfg.TidalLockChance == nil {
		return fmt.Errorf("planet.environment.tidal_lock_chance required")
	}
	if *cfg.TidalLockChance < 0 || *cfg.TidalLockChance > 1 {
		return fmt.Errorf("planet.environment.tidal_lock_chance must be 0..1")
	}
	if cfg.DayLengthHours.Min != nil && *cfg.DayLengthHours.Min <= 0 {
		return fmt.Errorf("planet.environment.day_length_hours.min must be > 0")
	}
	if cfg.DayLengthHours.Max != nil && *cfg.DayLengthHours.Max <= 0 {
		return fmt.Errorf("planet.environment.day_length_hours.max must be > 0")
	}
	return nil
}

func validateResources(cfg ResourceConfig) error {
	if cfg.RareChance < 0 || cfg.RareChance > 1 {
		return fmt.Errorf("planet.resources.rare_chance must be 0..1")
	}
	if cfg.ClusterMin < 1 {
		return fmt.Errorf("planet.resources.cluster_min must be >= 1")
	}
	if cfg.ClusterMax < cfg.ClusterMin {
		return fmt.Errorf("planet.resources.cluster_max must be >= cluster_min")
	}
	if cfg.ClusterRadius < 0 {
		return fmt.Errorf("planet.resources.cluster_radius must be >= 0")
	}
	if cfg.VeinAmountMin <= 0 || cfg.VeinAmountMax <= 0 || cfg.VeinAmountMax < cfg.VeinAmountMin {
		return fmt.Errorf("planet.resources.vein_amount_min/max must be > 0 and max >= min")
	}
	if cfg.VeinYieldMin <= 0 || cfg.VeinYieldMax <= 0 || cfg.VeinYieldMax < cfg.VeinYieldMin {
		return fmt.Errorf("planet.resources.vein_yield_min/max must be > 0 and max >= min")
	}
	if cfg.OilYieldMin <= 0 || cfg.OilYieldMax <= 0 || cfg.OilYieldMax < cfg.OilYieldMin {
		return fmt.Errorf("planet.resources.oil_yield_min/max must be > 0 and max >= min")
	}
	if cfg.OilMinYield <= 0 || cfg.OilMinYield > cfg.OilYieldMin {
		return fmt.Errorf("planet.resources.oil_min_yield must be > 0 and <= oil_yield_min")
	}
	if cfg.OilDecayPerTick < 0 {
		return fmt.Errorf("planet.resources.oil_decay_per_tick must be >= 0")
	}
	if cfg.RenewableRegenPerTick < 0 {
		return fmt.Errorf("planet.resources.renewable_regen_per_tick must be >= 0")
	}
	return nil
}

func validateRange(cfg RangeConfig, name string) error {
	if cfg.Min == nil || cfg.Max == nil {
		return fmt.Errorf("%s min/max required", name)
	}
	if *cfg.Min > *cfg.Max {
		return fmt.Errorf("%s.min must be <= %s.max", name, name)
	}
	if *cfg.Min < 0 || *cfg.Max < 0 {
		return fmt.Errorf("%s min/max must be >= 0", name)
	}
	return nil
}

func setFloatDefault(ptr **float64, def float64) {
	if *ptr == nil {
		v := def
		*ptr = &v
	}
}

func setRangeDefaults(r *RangeConfig, defMin, defMax float64) {
	if r.Min == nil {
		v := defMin
		r.Min = &v
	}
	if r.Max == nil {
		v := defMax
		r.Max = &v
	}
}

func setResourceDefaults(cfg *ResourceConfig) {
	if cfg.ClusterMin == 0 {
		cfg.ClusterMin = 3
	}
	if cfg.ClusterMax == 0 {
		cfg.ClusterMax = 8
	}
	if cfg.ClusterMax < cfg.ClusterMin {
		cfg.ClusterMax = cfg.ClusterMin
	}
	if cfg.ClusterRadius == 0 {
		cfg.ClusterRadius = 3
	}
	if cfg.RareChance == 0 {
		cfg.RareChance = 0.08
	}
	if cfg.VeinAmountMin == 0 {
		cfg.VeinAmountMin = 80
	}
	if cfg.VeinAmountMax == 0 {
		cfg.VeinAmountMax = 200
	}
	if cfg.VeinYieldMin == 0 {
		cfg.VeinYieldMin = 2
	}
	if cfg.VeinYieldMax == 0 {
		cfg.VeinYieldMax = 6
	}
	if cfg.OilYieldMin == 0 {
		cfg.OilYieldMin = 3
	}
	if cfg.OilYieldMax == 0 {
		cfg.OilYieldMax = 8
	}
	if cfg.OilMinYield == 0 {
		cfg.OilMinYield = 1
	}
	if cfg.OilDecayPerTick == 0 {
		cfg.OilDecayPerTick = 1
	}
	if cfg.RenewableRegenPerTick == 0 {
		cfg.RenewableRegenPerTick = 2
	}
}

func valueOrZero(ptr *float64) float64 {
	if ptr == nil {
		return 0
	}
	return *ptr
}
