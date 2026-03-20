package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// ExecutorConfig defines executor capability defaults per player.
type ExecutorConfig struct {
	BuildEfficiency float64 `yaml:"build_efficiency"`
	OperateRange    int     `yaml:"operate_range"`
	ConcurrentTasks int     `yaml:"concurrent_tasks"`
	ResearchBoost   float64 `yaml:"research_boost"`
}

// PlayerConfig holds player identity, auth key, and permissions.
type PlayerConfig struct {
	PlayerID    string         `yaml:"player_id"`
	Key         string         `yaml:"key"`
	TeamID      string         `yaml:"team_id"`
	Role        string         `yaml:"role"`
	Permissions []string       `yaml:"permissions"`
	Executor    ExecutorConfig `yaml:"executor"`
}

// BattlefieldConfig holds battlefield parameters
type BattlefieldConfig struct {
	MapSeed     string `yaml:"map_seed"`
	MaxTickRate int    `yaml:"max_tick_rate"`
	VictoryRule string `yaml:"victory_rule"`
	// ConstructionRegionConcurrentLimit caps in-progress construction tasks per region.
	ConstructionRegionConcurrentLimit int `yaml:"construction_region_concurrent_limit"`
}

// ServerConfig holds HTTP server settings
type ServerConfig struct {
	Port              int    `yaml:"port"`
	RateLimit         int    `yaml:"rate_limit"`          // commands per second per player
	EventHistoryLimit int    `yaml:"event_history_limit"` // max events kept for snapshot queries
	SnapshotMaxEvents int    `yaml:"snapshot_max_events"` // max events returned by snapshot endpoint
	AlertHistoryLimit int    `yaml:"alert_history_limit"` // max production alerts kept for snapshot queries
	DataDir           string `yaml:"data_dir"`            // snapshot/audit storage root
	// Snapshot storage policy (tick-based).
	SnapshotIntervalTicks  int64                   `yaml:"snapshot_interval_ticks"`  // full snapshot interval
	SnapshotRetentionTicks int64                   `yaml:"snapshot_retention_ticks"` // retain snapshots within last N ticks
	SnapshotRetentionCount int                     `yaml:"snapshot_retention_count"` // retain at most N snapshots
	SnapshotMaxBytes       int64                   `yaml:"snapshot_max_bytes"`       // soft max snapshot JSON size
	SnapshotDeltaMaxBytes  int64                   `yaml:"snapshot_delta_max_bytes"` // soft max delta JSON size
	ProductionMonitor      ProductionMonitorConfig `yaml:"production_monitor"`
}

// ProductionMonitorConfig configures production monitoring sampling and alert thresholds.
type ProductionMonitorConfig struct {
	SampleIntervalTicks  int64   `yaml:"sample_interval_ticks"`
	MaxEntitiesPerSample int     `yaml:"max_entities_per_sample"`
	BacklogWarnRatio     float64 `yaml:"backlog_warn_ratio"`
	BacklogCriticalRatio float64 `yaml:"backlog_critical_ratio"`
	ShortageRatio        float64 `yaml:"shortage_ratio"`
	EfficiencyWarnRatio  float64 `yaml:"efficiency_warn_ratio"`
	AlertCooldownTicks   int64   `yaml:"alert_cooldown_ticks"`
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

	if err := ApplyDefaults(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// ApplyDefaults fills optional config fields with defaults.
func ApplyDefaults(cfg *Config) error {
	if cfg == nil {
		return fmt.Errorf("nil config")
	}
	const (
		defaultSnapshotIntervalTicks  int64 = 100
		defaultSnapshotRetentionCount       = 60
		defaultSnapshotMaxBytes       int64 = 2 * 1024 * 1024
		defaultSnapshotDeltaMaxBytes  int64 = 1 * 1024 * 1024
		defaultAlertHistoryLimit            = 1000
	)
	if cfg.Battlefield.MaxTickRate == 0 {
		cfg.Battlefield.MaxTickRate = 10
	}
	if cfg.Battlefield.ConstructionRegionConcurrentLimit == 0 {
		cfg.Battlefield.ConstructionRegionConcurrentLimit = 4
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.RateLimit == 0 {
		cfg.Server.RateLimit = 10
	}
	if cfg.Server.EventHistoryLimit == 0 {
		cfg.Server.EventHistoryLimit = 2000
	}
	if cfg.Server.SnapshotMaxEvents == 0 {
		cfg.Server.SnapshotMaxEvents = 200
	}
	if cfg.Server.AlertHistoryLimit == 0 {
		cfg.Server.AlertHistoryLimit = defaultAlertHistoryLimit
	}
	if cfg.Server.SnapshotMaxEvents > cfg.Server.EventHistoryLimit {
		cfg.Server.SnapshotMaxEvents = cfg.Server.EventHistoryLimit
	}
	if cfg.Server.DataDir == "" {
		cfg.Server.DataDir = "data"
	}
	if cfg.Server.SnapshotIntervalTicks == 0 {
		cfg.Server.SnapshotIntervalTicks = defaultSnapshotIntervalTicks
	}
	if cfg.Server.SnapshotRetentionCount == 0 {
		cfg.Server.SnapshotRetentionCount = defaultSnapshotRetentionCount
	}
	if cfg.Server.SnapshotRetentionTicks == 0 {
		cfg.Server.SnapshotRetentionTicks = cfg.Server.SnapshotIntervalTicks * int64(cfg.Server.SnapshotRetentionCount)
	}
	if cfg.Server.SnapshotMaxBytes == 0 {
		cfg.Server.SnapshotMaxBytes = defaultSnapshotMaxBytes
	}
	if cfg.Server.SnapshotDeltaMaxBytes == 0 {
		cfg.Server.SnapshotDeltaMaxBytes = defaultSnapshotDeltaMaxBytes
	}
	if cfg.Server.ProductionMonitor.SampleIntervalTicks == 0 {
		cfg.Server.ProductionMonitor.SampleIntervalTicks = 5
	}
	if cfg.Server.ProductionMonitor.MaxEntitiesPerSample == 0 {
		cfg.Server.ProductionMonitor.MaxEntitiesPerSample = 500
	}
	if cfg.Server.ProductionMonitor.BacklogWarnRatio == 0 {
		cfg.Server.ProductionMonitor.BacklogWarnRatio = 0.6
	}
	if cfg.Server.ProductionMonitor.BacklogCriticalRatio == 0 {
		cfg.Server.ProductionMonitor.BacklogCriticalRatio = 0.9
	}
	if cfg.Server.ProductionMonitor.ShortageRatio == 0 {
		cfg.Server.ProductionMonitor.ShortageRatio = 0.2
	}
	if cfg.Server.ProductionMonitor.EfficiencyWarnRatio == 0 {
		cfg.Server.ProductionMonitor.EfficiencyWarnRatio = 0.5
	}
	if cfg.Server.ProductionMonitor.AlertCooldownTicks == 0 {
		cfg.Server.ProductionMonitor.AlertCooldownTicks = 20
	}
	if cfg.Battlefield.VictoryRule == "" {
		cfg.Battlefield.VictoryRule = "elimination"
	}

	if len(cfg.Players) == 0 {
		return fmt.Errorf("at least one player required")
	}

	for i := range cfg.Players {
		p := &cfg.Players[i]
		if p.TeamID == "" {
			p.TeamID = p.PlayerID
		}
		if p.Role == "" {
			p.Role = "commander"
		}
		if len(p.Permissions) == 0 {
			p.Permissions = DefaultPermissionsForRole(p.Role)
		}
		if p.Executor.BuildEfficiency == 0 {
			p.Executor.BuildEfficiency = 1.0
		}
		if p.Executor.OperateRange == 0 {
			p.Executor.OperateRange = 6
		}
		if p.Executor.ConcurrentTasks == 0 {
			p.Executor.ConcurrentTasks = 2
		}
	}

	return nil
}

// DefaultPermissionsForRole returns the default permission list for a role.
func DefaultPermissionsForRole(role string) []string {
	switch role {
	case "observer":
		return []string{"scan_galaxy", "scan_system", "scan_planet"}
	default:
		return []string{"*"}
	}
}
