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

type BootstrapItemConfig struct {
	ItemID   string `yaml:"item_id" json:"item_id"`
	Quantity int    `yaml:"quantity" json:"quantity"`
}

type PlayerBootstrapConfig struct {
	Minerals       int                   `yaml:"minerals" json:"minerals"`
	Energy         int                   `yaml:"energy" json:"energy"`
	Inventory      []BootstrapItemConfig `yaml:"inventory,omitempty" json:"inventory,omitempty"`
	CompletedTechs []string              `yaml:"completed_techs,omitempty" json:"completed_techs,omitempty"`
}

type ScenarioBootstrapBuildingConfig struct {
	OwnerID         string                `yaml:"owner_id"`
	BuildingType    string                `yaml:"building_type"`
	X               int                   `yaml:"x"`
	Y               int                   `yaml:"y"`
	State           string                `yaml:"state,omitempty"`
	RecipeID        string                `yaml:"recipe_id,omitempty"`
	RayReceiverMode string                `yaml:"ray_receiver_mode,omitempty"`
	Inventory       []BootstrapItemConfig `yaml:"inventory,omitempty"`
}

type ScenarioBootstrapPlanetConfig struct {
	PlanetID  string                            `yaml:"planet_id"`
	Buildings []ScenarioBootstrapBuildingConfig `yaml:"buildings,omitempty"`
}

type ScenarioBootstrapDysonNodeConfig struct {
	Latitude  float64 `yaml:"latitude"`
	Longitude float64 `yaml:"longitude"`
}

type ScenarioBootstrapDysonShellConfig struct {
	LatitudeMin float64 `yaml:"latitude_min"`
	LatitudeMax float64 `yaml:"latitude_max"`
	Coverage    float64 `yaml:"coverage"`
}

type ScenarioBootstrapDysonLayerConfig struct {
	LayerIndex  int                                 `yaml:"layer_index"`
	OrbitRadius float64                             `yaml:"orbit_radius"`
	Nodes       []ScenarioBootstrapDysonNodeConfig  `yaml:"nodes,omitempty"`
	Shells      []ScenarioBootstrapDysonShellConfig `yaml:"shells,omitempty"`
}

type ScenarioBootstrapSolarSailOrbitConfig struct {
	Count       int     `yaml:"count"`
	OrbitRadius float64 `yaml:"orbit_radius"`
	Inclination float64 `yaml:"inclination"`
}

type ScenarioBootstrapSystemConfig struct {
	PlayerID       string                                 `yaml:"player_id"`
	SystemID       string                                 `yaml:"system_id"`
	DysonLayers    []ScenarioBootstrapDysonLayerConfig    `yaml:"dyson_layers,omitempty"`
	SolarSailOrbit *ScenarioBootstrapSolarSailOrbitConfig `yaml:"solar_sail_orbit,omitempty"`
}

type ScenarioBootstrapConfig struct {
	Planets []ScenarioBootstrapPlanetConfig `yaml:"planets,omitempty"`
	Systems []ScenarioBootstrapSystemConfig `yaml:"systems,omitempty"`
}

// PlayerConfig holds player identity, auth key, and permissions.
type PlayerConfig struct {
	PlayerID    string                `yaml:"player_id"`
	Key         string                `yaml:"key"`
	TeamID      string                `yaml:"team_id"`
	Role        string                `yaml:"role"`
	Permissions []string              `yaml:"permissions"`
	Executor    ExecutorConfig        `yaml:"executor"`
	Bootstrap   PlayerBootstrapConfig `yaml:"bootstrap"`
	// Bot 遭遇战 AI（A1）：easy|normal|hard，空为人类玩家。
	// bot 走与玩家相同的命令接口，确定性可重放。
	Bot string `yaml:"bot,omitempty"`
}

// BattlefieldConfig holds battlefield parameters
type BattlefieldConfig struct {
	MapSeed               string `yaml:"map_seed"`
	MaxTickRate           int    `yaml:"max_tick_rate"`
	VictoryRule           string `yaml:"victory_rule"`
	InitialActivePlanetID string `yaml:"initial_active_planet_id,omitempty"`
	// ConstructionRegionConcurrentLimit caps in-progress construction tasks per region.
	ConstructionRegionConcurrentLimit int `yaml:"construction_region_concurrent_limit"`
	// EnemyDifficulty 黑雾难度：easy|normal|hard（默认 normal），
	// 影响威胁累积速率、波次规模与巢穴上限（E2）。
	EnemyDifficulty string `yaml:"enemy_difficulty,omitempty"`
	// PaceResearch 研究消耗/研究点需求倍率，缺省 1。>1 更慢，不改科技目录数字。
	PaceResearch float64 `yaml:"pace_research,omitempty"`
	// PaceBuild 建造时长倍率，缺省 1。乘在 defaultConstructionDurationTick 上。
	PaceBuild float64 `yaml:"pace_build,omitempty"`
	// PaceOutput 生产配方运行时时长倍率，缺省 1。不改目录 Duration。
	PaceOutput float64 `yaml:"pace_output,omitempty"`
	// TimeLimitTicks 时间限制（tick）。0=不限。到点按战损计分判胜；sandbox 永不因此判胜。
	// 10 tick/s 时 60 分钟 = 36000 tick，90 分钟 = 54000 tick。
	TimeLimitTicks int64 `yaml:"time_limit_ticks,omitempty"`
	// ThreatGrowthScale 黑雾威胁累积倍率，缺省 1。只放大正向累积，不改黑雾 AI。
	ThreatGrowthScale float64 `yaml:"threat_growth_scale,omitempty"`
	// DarkFogCalmTicks 黑雾被动：玩家最后一次伤害黑雾后经过多少 tick 恢复中立，缺省 6000。
	DarkFogCalmTicks int64 `yaml:"dark_fog_calm_ticks,omitempty"`
	// BotFirstAttackTick bot 军团首次主动进攻的最早 tick（开局发育期），缺省 0 不限。
	BotFirstAttackTick int64 `yaml:"bot_first_attack_tick,omitempty"`
}

// ServerConfig holds HTTP server settings
type ServerConfig struct {
	Port              int    `yaml:"port"`
	RateLimit         int    `yaml:"rate_limit"`          // commands per second per player
	EventHistoryLimit int    `yaml:"event_history_limit"` // max events kept for snapshot queries
	SnapshotMaxEvents int    `yaml:"snapshot_max_events"` // max events returned by snapshot endpoint
	AlertHistoryLimit int    `yaml:"alert_history_limit"` // max production alerts kept for snapshot queries
	DataDir           string `yaml:"data_dir"`            // single-game working directory (meta.json + save.json)
	// GameDataDir 可选：游戏数据目录（items/recipes/techs/buildings/units/combat/war.yaml），
	// 非空时整套替换内置的 server/data/ 默认数据，启动时校验失败即退出。
	GameDataDir string `yaml:"game_data_dir,omitempty"`
	// Snapshot storage policy (tick-based).
	SnapshotIntervalTicks   int64                   `yaml:"snapshot_interval_ticks"`  // full snapshot interval
	SnapshotRetentionTicks  int64                   `yaml:"snapshot_retention_ticks"` // retain snapshots within last N ticks
	SnapshotRetentionCount  int                     `yaml:"snapshot_retention_count"` // retain at most N snapshots
	SnapshotMaxBytes        int64                   `yaml:"snapshot_max_bytes"`       // soft max snapshot JSON size
	AutoSaveIntervalSeconds int                     `yaml:"auto_save_interval_seconds"`
	ProductionMonitor       ProductionMonitorConfig `yaml:"production_monitor"`
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
	Battlefield       BattlefieldConfig       `yaml:"battlefield"`
	Players           []PlayerConfig          `yaml:"players"`
	ScenarioBootstrap ScenarioBootstrapConfig `yaml:"scenario_bootstrap,omitempty"`
	Server            ServerConfig            `yaml:"server"`
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
		defaultSnapshotIntervalTicks   int64 = 100
		defaultSnapshotRetentionCount        = 60
		defaultSnapshotMaxBytes        int64 = 2 * 1024 * 1024
		defaultAlertHistoryLimit             = 1000
		defaultAutoSaveIntervalSeconds       = 60
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
	if cfg.Server.AutoSaveIntervalSeconds == 0 {
		cfg.Server.AutoSaveIntervalSeconds = defaultAutoSaveIntervalSeconds
	}
	if cfg.Server.AutoSaveIntervalSeconds < 0 {
		return fmt.Errorf("server.auto_save_interval_seconds must be >= 0")
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
	if cfg.Battlefield.EnemyDifficulty == "" {
		cfg.Battlefield.EnemyDifficulty = "normal"
	}
	if cfg.Battlefield.PaceResearch < 0 || cfg.Battlefield.PaceBuild < 0 || cfg.Battlefield.PaceOutput < 0 || cfg.Battlefield.ThreatGrowthScale < 0 {
		return fmt.Errorf("battlefield pace/threat_growth_scale must be >= 0")
	}
	if cfg.Battlefield.TimeLimitTicks < 0 {
		return fmt.Errorf("battlefield.time_limit_ticks must be >= 0")
	}
	if cfg.Battlefield.PaceResearch == 0 {
		cfg.Battlefield.PaceResearch = 1
	}
	if cfg.Battlefield.PaceBuild == 0 {
		cfg.Battlefield.PaceBuild = 1
	}
	if cfg.Battlefield.PaceOutput == 0 {
		cfg.Battlefield.PaceOutput = 1
	}
	if cfg.Battlefield.ThreatGrowthScale == 0 {
		cfg.Battlefield.ThreatGrowthScale = 1
	}
	if cfg.Battlefield.DarkFogCalmTicks < 0 || cfg.Battlefield.BotFirstAttackTick < 0 {
		return fmt.Errorf("battlefield.dark_fog_calm_ticks/bot_first_attack_tick must be >= 0")
	}
	if cfg.Battlefield.DarkFogCalmTicks == 0 {
		cfg.Battlefield.DarkFogCalmTicks = 6000
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
