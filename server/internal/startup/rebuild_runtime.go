package startup

import (
	"fmt"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

// NewRebuildRuntime 装配一个「不走墙钟时钟」的运行时，供存档点重建使用：
// 数据目录与存档点目录由调用方指定，初始对局按 cfg 文件开新局
// （与 LoadRuntime 的新局分支同一路径，保证与线上开局一致）。
//
// 与 LoadRuntime 的差别：不读 data_dir 里的既有存档、不启动 tick 循环
// （重建方手动 gamecore.AdvanceTick），server.tick_rate_override 强制归零。
func NewRebuildRuntime(cfgPath, mapCfgPath, dataDir, checkpointDir string) (*Runtime, error) {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return nil, fmt.Errorf("读取服务端配置: %w", err)
	}
	mapCfg, err := mapconfig.Load(mapCfgPath)
	if err != nil {
		return nil, fmt.Errorf("读取地图配置: %w", err)
	}
	serverCfg := cfg.Server
	serverCfg.DataDir = dataDir
	serverCfg.CheckpointDir = checkpointDir
	serverCfg.Port = 0
	serverCfg.TickRateOverride = 0
	rt, err := NewRuntime(serverCfg, mapCfg)
	if err != nil {
		return nil, err
	}
	if err := rt.ResetToConfiguredNewGame(cfg); err != nil {
		return nil, err
	}
	return rt, nil
}

// ResetToConfiguredNewGameFromFile 从配置文件重开一局（供重建的 cp-root 层）。
func (rt *Runtime) ResetToConfiguredNewGameFromFile(cfgPath string) error {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}
	return rt.ResetToConfiguredNewGame(cfg)
}

// ResetToConfiguredNewGame 用给定配置开一局全新的对局并替换当前对局（不启动 tick 循环）。
// 与 Reset 的差别：直接用文件里的完整配置（含 bootstrap/executor/permissions），
// 不走 NewGameRequest 的继承与默认值补全——重建需要与线上开局逐字段一致。
func (rt *Runtime) ResetToConfiguredNewGame(cfg *config.Config) error {
	if rt == nil || rt.dir == nil || rt.mapCfg == nil {
		return fmt.Errorf("runtime is not ready for a new game")
	}
	if cfg == nil {
		return fmt.Errorf("config is required")
	}
	clone := *cfg
	clone.Server = rt.serverCfg
	if err := config.ApplyDefaults(&clone); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidNewGame, err)
	}
	maps := mapgen.Generate(rt.mapCfg, clone.Battlefield.MapSeed)
	if maps == nil || maps.PrimaryPlanet() == nil {
		return fmt.Errorf("%w: map config produces no planets", ErrInvalidNewGame)
	}
	q := queue.New()
	bus := gamecore.NewEventBus()
	store := newSnapshotStore(clone.Server)
	core := gamecore.New(&clone, maps, q, bus, store)
	meta := gamedir.NewMetaFile(&clone, rt.mapCfg)
	core.AttachGameDir(rt.dir, meta, snapshot.Capture(core.World(), core.Discovery()))
	if _, err := core.Save("rebuild_start"); err != nil {
		return fmt.Errorf("初始存档: %w", err)
	}
	sess := NewSession(&clone, maps, core, bus, q, OriginNew)
	sess.Meta = meta
	old := rt.current.Swap(sess)
	if old != nil {
		old.shutdown()
	}
	return nil
}
