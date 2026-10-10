package startup

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
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
	if app.Current().Core.World().Tick != 0 {
		t.Fatalf("expected fresh game tick 0, got %d", app.Current().Core.World().Tick)
	}
}

func TestBootstrapExistingDirUsesSavedGameplayAndMapConfig(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	writeSavedGame(t, gameDir, savedGameOptions{
		Seed:      "saved-seed",
		FaceSize:  24,
		PlayerIDs: []string{"saved-p1"},
		Tick:      44,
	})
	overwriteExternalFixtures(t, cfgPath, mapCfgPath, externalOverrideOptions{
		Seed:      "external-seed",
		FaceSize:  99,
		PlayerIDs: []string{"external-p1", "external-p2"},
	})

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer app.Stop()

	if app.Current().Config.Battlefield.MapSeed != "saved-seed" {
		t.Fatalf("expected saved gameplay config to win, got %q", app.Current().Config.Battlefield.MapSeed)
	}
	if len(app.Current().Config.Players) != 1 || app.Current().Config.Players[0].PlayerID != "saved-p1" {
		t.Fatalf("expected saved players restored, got %+v", app.Current().Config.Players)
	}
	if app.Current().Maps.PrimaryPlanet().Width != 72 || app.Current().Maps.PrimaryPlanet().Height != 48 {
		t.Fatalf("expected saved map config to win")
	}
	if app.Current().Core.World().Tick != 44 {
		t.Fatalf("expected resumed tick 44, got %d", app.Current().Core.World().Tick)
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

	if app.Current().Config.Server.Port != 19090 || app.Current().Config.Server.RateLimit != 77 {
		t.Fatalf("expected runtime overrides preserved")
	}
	if app.Current().Config.Server.EventHistoryLimit != 1 || app.Current().Config.Server.AlertHistoryLimit != 1 {
		t.Fatalf("expected history runtime overrides preserved")
	}
	if app.Current().Config.Server.AutoSaveIntervalSeconds != 5 {
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
	app.Start()
	defer app.Stop()

	app.Current().Core.World().Lock()
	app.Current().Core.World().Tick = 9
	app.Current().Core.World().Unlock()

	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		_, save, err := gamedir.Open(gameDir).Load()
		if err == nil && save.Tick >= 9 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}

	_, save, err := gamedir.Open(gameDir).Load()
	if err != nil {
		t.Fatalf("load save after auto save deadline: %v", err)
	}
	t.Fatalf("expected auto save to flush latest tick >=9, got tick %d", save.Tick)
}

func TestResumeFromGzipSavePreservesState(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	app.Current().Core.World().Lock()
	app.Current().Core.World().Tick = 42
	app.Current().Core.World().Unlock()
	if _, err := app.Current().Core.Save("manual"); err != nil {
		t.Fatalf("manual save: %v", err)
	}
	baseCount := len(app.Current().Core.World().Buildings)
	if baseCount == 0 {
		t.Fatalf("expected seeded base buildings before save")
	}
	app.Stop()

	raw, err := os.ReadFile(filepath.Join(gameDir, "save.json"))
	if err != nil {
		t.Fatalf("read save.json: %v", err)
	}
	if len(raw) < 2 || raw[0] != 0x1f || raw[1] != 0x8b {
		t.Fatalf("expected gzip-compressed save.json, got magic %x", raw[:min(8, len(raw))])
	}

	resumed, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("resume runtime: %v", err)
	}
	defer resumed.Stop()
	if got := resumed.Current().Core.World().Tick; got != 42 {
		t.Fatalf("expected tick 42 after resume, got %d", got)
	}
	if got := len(resumed.Current().Core.World().Buildings); got != baseCount {
		t.Fatalf("expected %d buildings after resume, got %d", baseCount, got)
	}
	player := resumed.Current().Core.World().Players["p1"]
	if player == nil || player.Resources.Minerals != 200 || player.Resources.Energy != 100 {
		t.Fatalf("expected player resources restored, got %+v", player)
	}
}

func TestResumeFromLegacyPlainJSONSave(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	app.Current().Core.World().Lock()
	app.Current().Core.World().Tick = 33
	app.Current().Core.World().Unlock()
	if _, err := app.Current().Core.Save("manual"); err != nil {
		t.Fatalf("manual save: %v", err)
	}
	app.Stop()

	// Rewrite save.json as legacy uncompressed JSON; resume must accept it.
	_, save, err := gamedir.Open(gameDir).Load()
	if err != nil {
		t.Fatalf("load saved game: %v", err)
	}
	payload, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal legacy save: %v", err)
	}
	if err := os.WriteFile(filepath.Join(gameDir, "save.json"), payload, 0o644); err != nil {
		t.Fatalf("write legacy save: %v", err)
	}

	resumed, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("resume runtime from legacy save: %v", err)
	}
	defer resumed.Stop()
	if got := resumed.Current().Core.World().Tick; got != 33 {
		t.Fatalf("expected tick 33 after legacy resume, got %d", got)
	}
	if len(resumed.Current().Core.World().Buildings) == 0 {
		t.Fatalf("expected buildings restored from legacy save")
	}
}

func TestStopStopsAutoSaveLoop(t *testing.T) {
	cfgPath, mapCfgPath, gameDir := writeBootstrapFixtures(t)
	writeRuntimeOverrideConfig(t, cfgPath, runtimeOverrideOptions{AutoSaveIntervalSeconds: 1})

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	app.Start()

	app.Stop()

	app.Current().Core.World().Lock()
	app.Current().Core.World().Tick = 7
	app.Current().Core.World().Unlock()

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

func TestBootstrapUsesInitialActivePlanetAndPlayerBootstrap(t *testing.T) {
	root := t.TempDir()
	cfgPath := filepath.Join(root, "config.yaml")
	mapCfgPath := filepath.Join(root, "map.yaml")
	gameDir := filepath.Join(root, "game")

	configContent := fmt.Sprintf(`battlefield:
  map_seed: bootstrap-seed
  max_tick_rate: 10
  initial_active_planet_id: planet-1-2
players:
  - player_id: p1
    key: key1
    bootstrap:
      minerals: 4321
      energy: 876
      inventory:
        - item_id: frame_material
          quantity: 6
        - item_id: quantum_chip
          quantity: 4
      completed_techs:
        - gas_giants
        - vertical_launching
server:
  data_dir: %s
`, gameDir)
	if err := os.WriteFile(cfgPath, []byte(configContent), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	mapContent := `galaxy:
  system_count: 1
system:
  planets_per_system: 3
  gas_giant_ratio: 0
planet:
  face_size: 16
  resource_density: 8
overrides:
  planets:
    planet-1-2:
      kind: gas_giant
`
	if err := os.WriteFile(mapCfgPath, []byte(mapContent), 0o644); err != nil {
		t.Fatalf("write map config: %v", err)
	}

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer app.Stop()

	if app.Current().Core.World().PlanetID != "planet-1-2" {
		t.Fatalf("expected active world planet planet-1-2, got %s", app.Current().Core.World().PlanetID)
	}
	if app.Current().Core.ActivePlanetID() != "planet-1-2" {
		t.Fatalf("expected active planet id planet-1-2, got %s", app.Current().Core.ActivePlanetID())
	}
	if app.Current().Maps.Planets["planet-1-2"] == nil || app.Current().Maps.Planets["planet-1-2"].Kind != "gas_giant" {
		t.Fatalf("expected planet-1-2 to be gas giant, got %+v", app.Current().Maps.Planets["planet-1-2"])
	}
	if app.Current().Core.Discovery() == nil {
		t.Fatal("expected discovery state to exist")
	}
	if !app.Current().Core.Discovery().IsSystemDiscovered("p1", "sys-1") {
		t.Fatal("expected active planet system to be discovered for bootstrap player")
	}
	if !app.Current().Core.Discovery().IsPlanetDiscovered("p1", "planet-1-2") {
		t.Fatal("expected active planet to be discovered for bootstrap player")
	}

	player := app.Current().Core.World().Players["p1"]
	if player == nil {
		t.Fatal("expected bootstrap player p1")
	}
	if player.Resources.Minerals != 4321 || player.Resources.Energy != 876 {
		t.Fatalf("unexpected bootstrap resources: %+v", player.Resources)
	}
	if player.Inventory[model.ItemFrameMaterial] != 6 || player.Inventory[model.ItemQuantumChip] != 4 {
		t.Fatalf("unexpected bootstrap inventory: %+v", player.Inventory)
	}
	if player.Tech == nil || player.Tech.CompletedTechs["gas_giants"] == 0 || player.Tech.CompletedTechs["vertical_launching"] == 0 {
		t.Fatalf("expected bootstrap techs applied, got %+v", player.Tech)
	}
}

type savedGameOptions struct {
	Seed      string
	FaceSize  int
	PlayerIDs []string
	Tick      int64
}

type externalOverrideOptions struct {
	Seed      string
	FaceSize  int
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
	writeMapConfigFile(t, mapCfgPath, 16)
	return cfgPath, mapCfgPath, gameDir
}

func writeSavedGame(t *testing.T, gameDir string, opts savedGameOptions) {
	t.Helper()
	dir := gamedir.Open(gameDir)
	meta := minimalMetaFile(t)
	if opts.Seed != "" {
		meta.GameplayConfig.Battlefield.MapSeed = opts.Seed
	}
	if opts.FaceSize > 0 {
		meta.MapConfig.Planet.FaceSize = opts.FaceSize
	}
	if len(opts.PlayerIDs) > 0 {
		meta.GameplayConfig.Players = nil
		for _, id := range opts.PlayerIDs {
			meta.GameplayConfig.Players = append(meta.GameplayConfig.Players, config.PlayerConfig{PlayerID: id, Key: id + "-key"})
		}
	}
	world := model.NewWorldState("planet-1-1", meta.MapConfig.Planet.FaceSize)
	world.Tick = opts.Tick
	save := &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          opts.Tick,
		Snapshot:      snapshot.Capture(world, nil),
		RuntimeState:  gamedir.RuntimeState{ActivePlanetID: "planet-1-1"},
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
	writeMapConfigFile(t, mapCfgPath, opts.FaceSize)
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

func writeMapConfigFile(t *testing.T, path string, faceSize int) {
	t.Helper()
	content := fmt.Sprintf(`galaxy:
  system_count: 1
system:
  planets_per_system: 1
planet:
  face_size: %d
  resource_density: 8
`, faceSize)
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
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 8},
	})
}

// 来源存档点随 data_dir 存档持久化：读档 → 重启进程 → 再存档，parent 仍指向原存档点，
// 且三种来源（新局 / 读存档点 / 重启恢复）在 GameSummary.origin 上可区分。
func TestCheckpointLineageSurvivesRestart(t *testing.T) {
	cfgPath, mapCfgPath, _ := writeBootstrapFixtures(t)
	cpDir := filepath.Join(t.TempDir(), "checkpoints")

	app, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	app.checkpoints = checkpoint.Open(cpDir)
	if got := app.Current().Summary().Origin; got != OriginNew {
		t.Fatalf("fresh game origin = %q, want %q", got, OriginNew)
	}
	if _, err := app.SaveCheckpoint(SaveCheckpointRequest{Name: "cp-root"}); err != nil {
		t.Fatalf("save cp-root: %v", err)
	}
	if _, err := app.LoadCheckpoint("cp-root"); err != nil {
		t.Fatalf("load cp-root: %v", err)
	}
	sum := app.Current().Summary()
	if sum.Origin != OriginCheckpoint || sum.SourceCheckpoint != "cp-root" {
		t.Fatalf("after load origin=%q source=%q, want checkpoint/cp-root", sum.Origin, sum.SourceCheckpoint)
	}
	app.Stop()

	resumed, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("resume runtime: %v", err)
	}
	defer resumed.Stop()
	resumed.checkpoints = checkpoint.Open(cpDir)
	sum = resumed.Current().Summary()
	if sum.Origin != OriginResume || sum.SourceCheckpoint != "cp-root" {
		t.Fatalf("after restart origin=%q source=%q, want resume/cp-root", sum.Origin, sum.SourceCheckpoint)
	}
	derived, err := resumed.SaveCheckpoint(SaveCheckpointRequest{Name: "cp-next"})
	if err != nil {
		t.Fatalf("save cp-next: %v", err)
	}
	if derived.Parent != "cp-root" {
		t.Fatalf("derived parent after restart = %q, want cp-root", derived.Parent)
	}
}
