package startup

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/terrain"
)

func TestBootstrapEmptyDirCreatesGameAndInitialSave(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer app.Stop()

	if _, err := os.Stat(filepath.Join(gameDir, "meta.json")); err != nil {
		t.Fatalf("expected meta.json written before serve: %v", err)
	}
	if _, err := os.Stat(filepath.Join(gameDir, "save.json")); err != nil {
		t.Fatalf("expected save.json written before serve: %v", err)
	}
	if app.Core.World().Tick != 0 {
		t.Fatalf("expected fresh game tick 0, got %d", app.Core.World().Tick)
	}
}

func TestBootstrapExistingDirUsesSavedGameplayAndMapConfig(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	writeSavedGame(t, gameDir, savedGameOptions{
		Seed:      "saved-seed",
		PlanetW:   24,
		PlanetH:   12,
		PlayerIDs: []string{"saved-p1"},
		Tick:      44,
	})
	overwriteExternalFixtures(t, cfgPath, mapCfgPath, externalOverrideOptions{
		Seed:      "external-seed",
		PlanetW:   99,
		PlanetH:   99,
		PlayerIDs: []string{"external-p1", "external-p2"},
	})

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer app.Stop()

	if app.Config.Battlefield.MapSeed != "saved-seed" {
		t.Fatalf("expected saved gameplay config to win, got %q", app.Config.Battlefield.MapSeed)
	}
	if len(app.Config.Players) != 1 || app.Config.Players[0].PlayerID != "saved-p1" {
		t.Fatalf("expected saved players restored, got %+v", app.Config.Players)
	}
	if app.Maps.PrimaryPlanet().Width != 24 || app.Maps.PrimaryPlanet().Height != 12 {
		t.Fatalf("expected saved map config to win")
	}
	if app.Core.World().Tick != 44 {
		t.Fatalf("expected resumed tick 44, got %d", app.Core.World().Tick)
	}
}

func TestBootstrapExistingDirKeepsExternalRuntimeOverrides(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	writeSavedGame(t, gameDir, savedGameOptions{Tick: 12})
	writeRuntimeOverrideConfig(t, cfgPath, runtimeOverrideOptions{
		Port:                    19090,
		RateLimit:               77,
		EventHistoryLimit:       1,
		AlertHistoryLimit:       1,
		AutoSaveIntervalSeconds: 5,
	})

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer app.Stop()

	if app.Config.Server.Port != 19090 || app.Config.Server.RateLimit != 77 {
		t.Fatalf("expected runtime overrides preserved")
	}
	if app.Config.Server.EventHistoryLimit != 1 || app.Config.Server.AlertHistoryLimit != 1 {
		t.Fatalf("expected history runtime overrides preserved")
	}
	if app.Config.Server.AutoSaveIntervalSeconds != 5 {
		t.Fatalf("expected auto save override preserved")
	}
}

func TestAutoSaveTickerWritesUpdatedSave(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	writeRuntimeOverrideConfig(t, cfgPath, runtimeOverrideOptions{AutoSaveIntervalSeconds: 1})

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer app.Stop()

	app.Core.World().Lock()
	app.Core.World().Tick = 9
	app.Core.World().Unlock()

	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		_, save, err := gamedir.Open(gameDir).Load()
		if err == nil && save.Tick == 9 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}

	saveData, err := os.ReadFile(filepath.Join(gameDir, "save.json"))
	if err != nil {
		t.Fatalf("read save.json: %v", err)
	}
	if !bytes.Contains(saveData, []byte(`"tick": 9`)) {
		t.Fatalf("expected auto save to flush latest tick, got %s", string(saveData))
	}
}

func TestStopStopsAutoSaveLoop(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	writeRuntimeOverrideConfig(t, cfgPath, runtimeOverrideOptions{AutoSaveIntervalSeconds: 1})

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}

	app.Stop()

	app.Core.World().Lock()
	app.Core.World().Tick = 7
	app.Core.World().Unlock()

	time.Sleep(1200 * time.Millisecond)

	_, save, err := gamedir.Open(gameDir).Load()
	if err != nil {
		t.Fatalf("load save after stop: %v", err)
	}
	if save.Tick != 0 {
		t.Fatalf("expected auto save loop stopped after app.Stop, got tick %d", save.Tick)
	}
}

func TestBootstrapRejectsPartialSaveDir(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	if err := os.MkdirAll(gameDir, 0o755); err != nil {
		t.Fatalf("mkdir game dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(gameDir, "meta.json"), []byte(`{"format_version":1}`), 0o644); err != nil {
		t.Fatalf("write partial meta: %v", err)
	}

	if _, err := LoadRuntime(cfgPath, mapCfgPath); err == nil {
		t.Fatalf("expected partial save dir to be rejected")
	}
}

type savedGameOptions struct {
	Seed      string
	PlanetW   int
	PlanetH   int
	PlayerIDs []string
	Tick      int64
}

type externalOverrideOptions struct {
	Seed      string
	PlanetW   int
	PlanetH   int
	PlayerIDs []string
}

type runtimeOverrideOptions struct {
	Port                    int
	RateLimit               int
	EventHistoryLimit       int
	AlertHistoryLimit       int
	AutoSaveIntervalSeconds int
}

func writeBootstrapFixtures(t *testing.T) (cfgPath string, mapCfgPath string, gameDir string) {
	t.Helper()
	root := t.TempDir()
	cfgPath = filepath.Join(root, "config.yaml")
	mapCfgPath = filepath.Join(root, "map.yaml")
	gameDir = filepath.Join(root, "game")
	writeConfigFile(t, cfgPath, gameDir, config.BattlefieldConfig{MapSeed: "seed-a", MaxTickRate: 10}, []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}}, runtimeOverrideOptions{})
	writeMapConfigFile(t, mapCfgPath, 16, 16)
	return cfgPath, mapCfgPath, gameDir
}

func writeSavedGame(t *testing.T, gameDir string, opts savedGameOptions) {
	t.Helper()
	dir := gamedir.Open(gameDir)
	meta := minimalMetaFile(t)
	if opts.Seed != "" {
		meta.GameplayConfig.Battlefield.MapSeed = opts.Seed
	}
	if opts.PlanetW > 0 {
		meta.MapConfig.Planet.Width = opts.PlanetW
		meta.MapConfig.Planet.Height = opts.PlanetH
	}
	if len(opts.PlayerIDs) > 0 {
		meta.GameplayConfig.Players = nil
		for _, id := range opts.PlayerIDs {
			meta.GameplayConfig.Players = append(meta.GameplayConfig.Players, config.PlayerConfig{PlayerID: id, Key: id + "-key"})
		}
	}
	save := &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          opts.Tick,
		Snapshot: &snapshot.Snapshot{
			Version: snapshot.CurrentVersion,
			Tick:    opts.Tick,
			World: &snapshot.WorldSnapshot{
				Tick:      opts.Tick,
				PlanetID:  "planet-1-1",
				MapWidth:  1,
				MapHeight: 1,
				Players:   map[string]*model.PlayerState{},
				Buildings: map[string]*snapshot.BuildingSnapshot{},
				Units:     map[string]*model.Unit{},
				Resources: map[string]*model.ResourceNodeState{},
				Terrain:   [][]terrain.TileType{{terrain.TileBuildable}},
			},
		},
		RuntimeState: gamedir.RuntimeState{ActivePlanetID: "planet-1-1"},
	}
	if err := dir.WriteInitial(meta, save); err != nil {
		t.Fatalf("write saved game: %v", err)
	}
}

func overwriteExternalFixtures(t *testing.T, cfgPath, mapCfgPath string, opts externalOverrideOptions) {
	t.Helper()
	gameDir := filepath.Join(filepath.Dir(cfgPath), "game")
	players := []config.PlayerConfig{{PlayerID: opts.PlayerIDs[0], Key: "ext-key"}}
	if len(opts.PlayerIDs) > 1 {
		for _, id := range opts.PlayerIDs[1:] {
			players = append(players, config.PlayerConfig{PlayerID: id, Key: id + "-key"})
		}
	}
	writeConfigFile(t, cfgPath, gameDir, config.BattlefieldConfig{MapSeed: opts.Seed, MaxTickRate: 10}, players, runtimeOverrideOptions{})
	writeMapConfigFile(t, mapCfgPath, opts.PlanetW, opts.PlanetH)
}

func writeRuntimeOverrideConfig(t *testing.T, cfgPath string, opts runtimeOverrideOptions) {
	t.Helper()
	gameDir := filepath.Join(filepath.Dir(cfgPath), "game")
	writeConfigFile(t, cfgPath, gameDir, config.BattlefieldConfig{MapSeed: "seed-a", MaxTickRate: 10}, []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}}, opts)
}

func writeConfigFile(t *testing.T, cfgPath, gameDir string, battlefield config.BattlefieldConfig, players []config.PlayerConfig, opts runtimeOverrideOptions) {
	t.Helper()
	var playerBlock bytes.Buffer
	for _, player := range players {
		fmt.Fprintf(&playerBlock, "  - player_id: %s\n    key: %s\n", player.PlayerID, player.Key)
	}
	content := fmt.Sprintf(`battlefield:
  map_seed: %s
  max_tick_rate: %d
players:
%sserver:
  data_dir: %s
  port: %d
  rate_limit: %d
  event_history_limit: %d
  alert_history_limit: %d
  auto_save_interval_seconds: %d
`, battlefield.MapSeed, battlefield.MaxTickRate, playerBlock.String(), gameDir, opts.Port, opts.RateLimit, opts.EventHistoryLimit, opts.AlertHistoryLimit, opts.AutoSaveIntervalSeconds)
	if err := os.WriteFile(cfgPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
}

func writeMapConfigFile(t *testing.T, path string, width, height int) {
	t.Helper()
	content := fmt.Sprintf(`galaxy:
  system_count: 1
system:
  planets_per_system: 1
planet:
  width: %d
  height: %d
  resource_density: 8
`, width, height)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write map config: %v", err)
	}
}

func minimalMetaFile(t *testing.T) *gamedir.MetaFile {
	t.Helper()
	return gamedir.NewMetaFile(&config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-a", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
	}, &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 8},
	})
}
