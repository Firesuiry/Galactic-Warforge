package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

func TestExportSaveFileIncludesRuntimeAndDebugState(t *testing.T) {
	core := newSaveStateHarness(t)
	core.world.Tick = 37
	core.activePlanetID = "planet-1-1"
	core.victory = model.VictoryState{
		WinnerID:    "p1",
		Reason:      "game_win",
		VictoryRule: "hybrid",
		TechID:      "mission_complete",
	}
	core.cmdLog.Append(commandLogEntry{Tick: 37, PlayerID: "p1", RequestID: "req-1"})
	core.eventHistory.Record([]*model.GameEvent{{EventID: "evt-37-1", Tick: 37, EventType: model.EvtCommandResult}})
	core.alertHistory.Record([]*model.ProductionAlert{{AlertID: "alert-1", Tick: 37, PlayerID: "p1"}})
	core.snapshotStore.ReplaceAudit([]*model.AuditEntry{{Tick: 37, PlayerID: "p1", Action: "command"}})

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save file: %v", err)
	}
	if save.Tick != 37 {
		t.Fatalf("expected tick 37, got %d", save.Tick)
	}
	if save.RuntimeState.Winner != "p1" {
		t.Fatalf("expected winner p1, got %q", save.RuntimeState.Winner)
	}
	if save.RuntimeState.VictoryReason != "game_win" || save.RuntimeState.VictoryRule != "hybrid" || save.RuntimeState.VictoryTechID != "mission_complete" {
		t.Fatalf("expected victory metadata exported, got %+v", save.RuntimeState)
	}
	if save.RuntimeState.ActivePlanetID != "planet-1-1" {
		t.Fatalf("expected active planet restored, got %q", save.RuntimeState.ActivePlanetID)
	}
	if len(save.DebugState.CommandLog) != 1 || len(save.DebugState.AuditLog) != 1 {
		t.Fatalf("expected command/audit debug state exported, got %+v", save.DebugState)
	}
	if len(save.DebugState.EventHistory[model.EvtCommandResult]) != 1 {
		t.Fatalf("expected event history exported")
	}
	if len(save.DebugState.AlertHistory) != 1 {
		t.Fatalf("expected alert history exported")
	}
	if save.DebugState.BaseSnapshot == nil {
		t.Fatalf("expected base snapshot for replay/rollback anchor")
	}
	if save.Snapshot == nil || save.Snapshot.World == nil {
		t.Fatalf("expected exported snapshot world payload")
	}
	if len(save.Snapshot.World.Players) == 0 {
		t.Fatalf("expected exported snapshot to include world state")
	}
	if save.Snapshot.Discovery == nil || len(save.Snapshot.Discovery.Players) == 0 {
		t.Fatalf("expected exported snapshot to include discovery state")
	}
}

func TestNewFromSaveRestoresTickWinnerAndHistories(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	save := &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          28,
		Snapshot:      snapshot.Capture(model.NewWorldState(maps.PrimaryPlanetID, 16, 16), mapstate.NewDiscovery(cfg.Players, maps)),
		RuntimeState: gamedir.RuntimeState{
			ActivePlanetID: maps.PrimaryPlanetID,
			Winner:         "p2",
			VictoryReason:  "game_win",
			VictoryRule:    "hybrid",
			VictoryTechID:  "mission_complete",
		},
		DebugState: gamedir.DebugState{
			BaseSnapshot: snapshot.Capture(model.NewWorldState(maps.PrimaryPlanetID, 16, 16), mapstate.NewDiscovery(cfg.Players, maps)),
			CommandLog:   []gamedir.CommandLogEntry{{Tick: 9, PlayerID: "p1", RequestID: "req-9"}},
			EventHistory: map[model.EventType][]*model.GameEvent{
				model.EvtCommandResult: {
					{EventID: "evt-9-1", Tick: 9, EventType: model.EvtCommandResult},
				},
			},
			AlertHistory: []*model.ProductionAlert{{AlertID: "alert-9", Tick: 9, PlayerID: "p1"}},
			AuditLog:     []*model.AuditEntry{{Tick: 9, PlayerID: "p1", Action: "command"}},
		},
	}

	core, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore core: %v", err)
	}
	if got := core.World().Tick; got != 28 {
		t.Fatalf("expected tick 28, got %d", got)
	}
	if core.Winner() != "p2" {
		t.Fatalf("expected winner restored")
	}
	if victory := core.Victory(); victory.Reason != "game_win" || victory.VictoryRule != "hybrid" || victory.TechID != "mission_complete" {
		t.Fatalf("expected victory metadata restored, got %+v", victory)
	}
	if core.ActivePlanetID() != maps.PrimaryPlanetID {
		t.Fatalf("expected active planet restored")
	}
	if len(core.GetCommandLog().All()) != 1 {
		t.Fatalf("expected command log restored")
	}
	if len(core.AlertHistory().All()) != 1 {
		t.Fatalf("expected alert history restored")
	}
	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtCommandResult}, "", 0, 10)
	if len(events) != 1 || events[0].EventID != "evt-9-1" {
		t.Fatalf("expected event history restored")
	}
	audit := core.snapshotStore.AuditEntries()
	if len(audit) != 1 || audit[0].Action != "command" {
		t.Fatalf("expected audit log restored")
	}
	if core.Discovery() == nil || !core.Discovery().IsPlanetDiscovered("p1", maps.PrimaryPlanetID) {
		t.Fatalf("expected discovery restored")
	}
	if snap := core.snapshotStore.SnapshotAtOrBefore(28); snap == nil {
		t.Fatalf("expected restored runtime snapshots")
	}
}

func TestNewFromSaveClampsHistoriesToRuntimeLimits(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	cfg.Server.AlertHistoryLimit = 1
	cfg.Server.EventHistoryLimit = 1
	save := oversizedSaveFile(t, cfg, maps)

	core, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore core: %v", err)
	}
	if got := len(core.AlertHistory().All()); got != 1 {
		t.Fatalf("expected alert history limit applied, got %d", got)
	}
	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtCommandResult}, "", 0, 10)
	if len(events) != 1 {
		t.Fatalf("expected event history limit applied, got %d", len(events))
	}
}

func TestSaveWritesThroughGameDir(t *testing.T) {
	core := newSaveStateHarness(t)
	core.world.Tick = 51
	core.activePlanetID = "planet-1-1"
	core.victory = model.VictoryState{
		WinnerID:    "p2",
		Reason:      "game_win",
		VictoryRule: "hybrid",
		TechID:      "mission_complete",
	}
	core.cmdLog.Append(commandLogEntry{Tick: 51, PlayerID: "p2", RequestID: "req-save"})
	core.eventHistory.Record([]*model.GameEvent{{EventID: "evt-51-1", Tick: 51, EventType: model.EvtCommandResult}})
	core.alertHistory.Record([]*model.ProductionAlert{{AlertID: "alert-51", Tick: 51, PlayerID: "p2"}})
	core.snapshotStore.ReplaceAudit([]*model.AuditEntry{{Tick: 51, PlayerID: "p2", Action: "command"}})

	res, err := core.Save("auto")
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if res.Trigger != "auto" {
		t.Fatalf("expected trigger auto, got %q", res.Trigger)
	}
	if res.Tick != 51 {
		t.Fatalf("expected tick 51, got %d", res.Tick)
	}
	if res.SavedAt.IsZero() {
		t.Fatalf("expected saved_at set")
	}
	if res.Path != core.gameDir.SavePath() {
		t.Fatalf("expected save path %q, got %q", core.gameDir.SavePath(), res.Path)
	}

	meta, save, err := core.gameDir.Load()
	if err != nil {
		t.Fatalf("load after save: %v", err)
	}
	if meta == nil || save == nil {
		t.Fatalf("expected meta/save payload")
	}
	if save.Tick != 51 || save.RuntimeState.Winner != "p2" || save.RuntimeState.ActivePlanetID != "planet-1-1" {
		t.Fatalf("expected save payload persisted runtime state")
	}
	if save.RuntimeState.VictoryReason != "game_win" || save.RuntimeState.VictoryRule != "hybrid" || save.RuntimeState.VictoryTechID != "mission_complete" {
		t.Fatalf("expected victory metadata persisted, got %+v", save.RuntimeState)
	}
	if len(save.DebugState.CommandLog) != 1 || len(save.DebugState.EventHistory[model.EvtCommandResult]) != 1 || len(save.DebugState.AlertHistory) != 1 || len(save.DebugState.AuditLog) != 1 {
		t.Fatalf("expected persisted debug state")
	}
	if save.SavedAt.IsZero() || !save.SavedAt.Equal(res.SavedAt) {
		t.Fatalf("expected SaveResult saved_at to match written save")
	}
}

func TestProcessTickIgnoresSaveMutex(t *testing.T) {
	core := newSaveStateHarness(t)
	core.saveMu.Lock()
	defer core.saveMu.Unlock()

	done := make(chan struct{})
	go func() {
		core.processTick()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("expected processTick to continue while saveMu is held")
	}

	if got := core.World().Tick; got != 1 {
		t.Fatalf("expected tick to advance even when saveMu held, got %d", got)
	}
}

func TestNewFromSaveKeepsBaseSnapshotWhenRetentionIsLow(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	cfg.Server.SnapshotRetentionCount = 1
	cfg.Server.SnapshotRetentionTicks = 1
	base := snapshot.Capture(model.NewWorldState(maps.PrimaryPlanetID, 16, 16), mapstate.NewDiscovery(cfg.Players, maps))
	base.Tick = 3
	current := snapshot.Capture(model.NewWorldState(maps.PrimaryPlanetID, 16, 16), mapstate.NewDiscovery(cfg.Players, maps))
	current.Tick = 28
	save := &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          28,
		Snapshot:      current,
		RuntimeState: gamedir.RuntimeState{
			ActivePlanetID: maps.PrimaryPlanetID,
			Winner:         "p2",
			VictoryReason:  "game_win",
			VictoryRule:    "hybrid",
			VictoryTechID:  "mission_complete",
		},
		DebugState: gamedir.DebugState{
			BaseSnapshot: base,
		},
	}

	core, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore core: %v", err)
	}

	if snap := core.snapshotStore.SnapshotAt(3); snap == nil {
		t.Fatalf("expected base snapshot retained in store")
	}
	if snap := core.snapshotStore.SnapshotAt(28); snap == nil {
		t.Fatalf("expected current snapshot retained in store")
	}
}

func newSaveHarnessDeps(t *testing.T) (*config.Config, *mapmodel.Universe, *queue.CommandQueue, *EventBus, *persistence.Store) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-a", MaxTickRate: 10},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{
			EventHistoryLimit:      8,
			AlertHistoryLimit:      8,
			SnapshotIntervalTicks:  1,
			SnapshotRetentionTicks: 100,
			SnapshotRetentionCount: 4,
		},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 8},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionTicks: 100,
		RetentionCount: 4,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	return cfg, maps, queue.New(), NewEventBus(), store
}

func newSaveStateHarness(t *testing.T) *GameCore {
	t.Helper()
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	core := New(cfg, maps, q, bus, store)
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 8},
	}
	core.AttachGameDir(
		gamedir.Open(t.TempDir()),
		gamedir.NewMetaFile(cfg, mapCfg),
		snapshot.Capture(core.World(), core.Discovery()),
	)
	return core
}

func oversizedSaveFile(t *testing.T, cfg *config.Config, maps *mapmodel.Universe) *gamedir.SaveFile {
	t.Helper()
	return &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          12,
		Snapshot:      snapshot.Capture(model.NewWorldState(maps.PrimaryPlanetID, 16, 16), mapstate.NewDiscovery(cfg.Players, maps)),
		DebugState: gamedir.DebugState{
			EventHistory: map[model.EventType][]*model.GameEvent{
				model.EvtCommandResult: {
					{EventID: "evt-1-1", Tick: 1, EventType: model.EvtCommandResult},
					{EventID: "evt-2-1", Tick: 2, EventType: model.EvtCommandResult},
				},
			},
			AlertHistory: []*model.ProductionAlert{
				{AlertID: "alert-1", Tick: 1, PlayerID: "p1"},
				{AlertID: "alert-2", Tick: 2, PlayerID: "p1"},
			},
		},
	}
}
