package startup

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

type gameDirState int

const (
	gameDirStateNew gameDirState = iota
	gameDirStateResume
)

// LoadRuntime loads config, decides whether to create or resume a game, and
// returns the hot-resettable runtime (F1). The returned runtime has not started
// any goroutines yet; main calls Runtime.Start before serving HTTP so tests can
// drive ticks deterministically.
func LoadRuntime(cfgPath, mapCfgPath string) (*Runtime, error) {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return nil, err
	}

	rt, err := NewRuntime(cfg.Server, nil)
	if err != nil {
		return nil, err
	}

	state, err := detectGameDirState(rt.dir)
	if err != nil {
		return nil, err
	}

	var (
		maps *mapmodel.Universe
		sess *Session
	)

	switch state {
	case gameDirStateResume:
		meta, save, err := rt.dir.Load()
		if err != nil {
			return nil, err
		}
		cfg, err = applySavedGameplayConfig(cfg, meta)
		if err != nil {
			return nil, err
		}
		// 恢复对局必须用存档内固化的地图配置（与 saved surface 一一对应）；
		// 热重置所用地图模板（F1）则优先启动时指定的 mapconfig 文件，读不到再退回存档。
		mapCfg := cloneSavedMapConfig(meta.MapConfig)
		startupMapCfg := loadStartupMapConfig(mapCfgPath, meta.MapConfig)
		rt.mapCfg = startupMapCfg
		maps = mapgen.Generate(mapCfg, meta.GameplayConfig.Battlefield.MapSeed)
		q := queue.New()
		bus := gamecore.NewEventBus()
		store, err := newSnapshotStore(cfg.Server)
		if err != nil {
			return nil, err
		}
		core, err := gamecore.NewFromSave(cfg, maps, q, bus, store, save)
		if err != nil {
			return nil, err
		}
		core.AttachGameDir(rt.dir, meta, choosePersistedBaseSnapshot(save))
		sess = NewSession(cfg, maps, core, bus, q)
	case gameDirStateNew:
		externalMapCfg, err := mapconfig.Load(mapCfgPath)
		if err != nil {
			return nil, err
		}
		rt.mapCfg = externalMapCfg
		maps = mapgen.Generate(externalMapCfg, cfg.Battlefield.MapSeed)
		q := queue.New()
		bus := gamecore.NewEventBus()
		store, err := newSnapshotStore(cfg.Server)
		if err != nil {
			return nil, err
		}
		core := gamecore.New(cfg, maps, q, bus, store)
		meta := gamedir.NewMetaFile(cfg, externalMapCfg)
		core.AttachGameDir(rt.dir, meta, snapshot.Capture(core.World(), core.Discovery()))
		if _, err := core.Save("startup"); err != nil {
			return nil, fmt.Errorf("initial save: %w", err)
		}
		sess = NewSession(cfg, maps, core, bus, q)
	default:
		return nil, fmt.Errorf("unsupported game dir state %d", state)
	}

	rt.current.Store(sess)
	return rt, nil
}

// loadStartupMapConfig 读取启动时指定的 mapconfig 文件；不可读时退回存档内固化的配置。
func loadStartupMapConfig(path string, saved mapconfig.Config) *mapconfig.Config {
	if cfg, err := mapconfig.Load(path); err == nil {
		return cfg
	}
	cp := saved
	return &cp
}

func cloneSavedMapConfig(cfg mapconfig.Config) *mapconfig.Config {
	copy := cfg
	return &copy
}

func applySavedGameplayConfig(live *config.Config, meta *gamedir.MetaFile) (*config.Config, error) {
	if live == nil {
		return nil, fmt.Errorf("nil config")
	}
	if meta == nil {
		return nil, fmt.Errorf("nil meta file")
	}
	merged := *live
	merged.Battlefield = meta.GameplayConfig.Battlefield
	merged.Players = append([]config.PlayerConfig(nil), meta.GameplayConfig.Players...)
	if err := config.ApplyDefaults(&merged); err != nil {
		return nil, err
	}
	return &merged, nil
}

func choosePersistedBaseSnapshot(save *gamedir.SaveFile) *snapshot.Snapshot {
	if save == nil {
		return nil
	}
	if save.DebugState.BaseSnapshot != nil {
		return save.DebugState.BaseSnapshot
	}
	return save.Snapshot
}

func detectGameDirState(dir *gamedir.Dir) (gameDirState, error) {
	root := filepath.Dir(dir.MetaPath())
	info, err := os.Stat(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return gameDirStateNew, nil
		}
		return 0, fmt.Errorf("stat game dir: %w", err)
	}
	if !info.IsDir() {
		return 0, fmt.Errorf("game dir is not a directory: %s", root)
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return 0, fmt.Errorf("read game dir: %w", err)
	}
	if len(entries) == 0 {
		return gameDirStateNew, nil
	}

	hasMeta, err := fileExists(dir.MetaPath())
	if err != nil {
		return 0, err
	}
	hasSave, err := fileExists(dir.SavePath())
	if err != nil {
		return 0, err
	}
	if hasMeta && hasSave {
		return gameDirStateResume, nil
	}
	if hasMeta || hasSave {
		return 0, fmt.Errorf("game dir contains partial save files")
	}
	return 0, fmt.Errorf("game dir is not empty and does not contain a complete save")
}

func fileExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, fmt.Errorf("stat %s: %w", filepath.Base(path), err)
}

func startAutoSaveLoop(core *gamecore.GameCore, interval time.Duration) (chan struct{}, chan struct{}) {
	if core == nil || interval <= 0 {
		return nil, nil
	}
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		defer log.Printf("[AutoSave] loop stopped")
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				if _, err := core.Save("auto"); err != nil {
					log.Printf("[AutoSave] %v", err)
				}
			}
		}
	}()
	return stopCh, doneCh
}
