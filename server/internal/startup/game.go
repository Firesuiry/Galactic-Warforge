package startup

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

type gameDirState int

const (
	gameDirStateNew gameDirState = iota
	gameDirStateResume
)

// App owns the bootstrapped runtime and its background helpers.
type App struct {
	Config *config.Config
	Maps   *mapmodel.Universe
	Core   *gamecore.GameCore
	Bus    *gamecore.EventBus
	Queue  *queue.CommandQueue

	stopOnce     sync.Once
	autoSaveStop chan struct{}
	autoSaveDone chan struct{}
}

// Stop stops autosave first, then stops the game core.
func (app *App) Stop() {
	if app == nil {
		return
	}
	app.stopOnce.Do(func() {
		if app.autoSaveStop != nil {
			close(app.autoSaveStop)
		}
		if app.autoSaveDone != nil {
			<-app.autoSaveDone
		}
		if app.Core != nil {
			app.Core.Stop()
		}
	})
}

// LoadRuntime loads config, decides whether to create or resume a game, and starts autosave.
func LoadRuntime(cfgPath, mapCfgPath string) (*App, error) {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return nil, err
	}

	dir := gamedir.Open(cfg.Server.DataDir)
	state, err := detectGameDirState(dir)
	if err != nil {
		return nil, err
	}

	store, err := persistence.New(cfg.Server.DataDir, persistence.SnapshotPolicy{
		IntervalTicks:    cfg.Server.SnapshotIntervalTicks,
		RetentionTicks:   cfg.Server.SnapshotRetentionTicks,
		RetentionCount:   cfg.Server.SnapshotRetentionCount,
		MaxSnapshotBytes: cfg.Server.SnapshotMaxBytes,
		MaxDeltaBytes:    cfg.Server.SnapshotDeltaMaxBytes,
	})
	if err != nil {
		return nil, err
	}

	q := queue.New()
	bus := gamecore.NewEventBus()

	var (
		maps *mapmodel.Universe
		core *gamecore.GameCore
	)

	switch state {
	case gameDirStateResume:
		meta, save, err := dir.Load()
		if err != nil {
			return nil, err
		}
		cfg, err = applySavedGameplayConfig(cfg, meta)
		if err != nil {
			return nil, err
		}
		mapCfg := cloneSavedMapConfig(meta.MapConfig)
		maps = mapgen.Generate(mapCfg, meta.GameplayConfig.Battlefield.MapSeed)
		core, err = gamecore.NewFromSave(cfg, maps, q, bus, store, save)
		if err != nil {
			return nil, err
		}
		core.AttachGameDir(dir, meta, choosePersistedBaseSnapshot(save))
	case gameDirStateNew:
		externalMapCfg, err := mapconfig.Load(mapCfgPath)
		if err != nil {
			return nil, err
		}
		maps = mapgen.Generate(externalMapCfg, cfg.Battlefield.MapSeed)
		core = gamecore.New(cfg, maps, q, bus, store)
		meta := gamedir.NewMetaFile(cfg, externalMapCfg)
		core.AttachGameDir(dir, meta, snapshot.Capture(core.World(), core.Discovery()))
		if _, err := core.Save("startup"); err != nil {
			return nil, fmt.Errorf("initial save: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported game dir state %d", state)
	}

	app := &App{
		Config: cfg,
		Maps:   maps,
		Core:   core,
		Bus:    bus,
		Queue:  q,
	}
	app.autoSaveStop, app.autoSaveDone = startAutoSaveLoop(core, time.Duration(cfg.Server.AutoSaveIntervalSeconds)*time.Second)
	return app, nil
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

func cloneSavedMapConfig(cfg mapconfig.Config) *mapconfig.Config {
	copy := cfg
	return &copy
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
