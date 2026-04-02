package gamedir

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/terrain"
)

func TestWriteRoundTrip(t *testing.T) {
	dir := Open(t.TempDir())
	meta := &MetaFile{
		FormatVersion: 1,
		GameplayConfig: GameplayConfig{
			Battlefield: config.BattlefieldConfig{MapSeed: "seed-a", MaxTickRate: 10},
			Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		},
		MapConfig: mapconfig.Config{
			Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
			System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
			Planet: mapconfig.PlanetConfig{Width: 16, Height: 16, ResourceDensity: 8},
		},
	}
	save := &SaveFile{
		FormatVersion: 1,
		Tick:          12,
		Snapshot: &snapshot.Snapshot{
			Version: snapshot.CurrentVersion,
			Tick:    12,
			World: &snapshot.WorldSnapshot{
				Tick:      12,
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
		RuntimeState: RuntimeState{ActivePlanetID: "planet-1-1", Winner: "p1"},
		DebugState: DebugState{
			BaseSnapshot: &snapshot.Snapshot{
				Version: snapshot.CurrentVersion,
				Tick:    10,
				World: &snapshot.WorldSnapshot{
					Tick:      10,
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
			CommandLog: []CommandLogEntry{{
				Tick:        12,
				PlayerID:    "p1",
				RequestID:   "req-1",
				IssuerType:  "player",
				IssuerID:    "p1",
				EnqueueTick: 11,
				Commands:    []model.Command{{Type: model.CmdBuild}},
				Results:     []model.CommandResult{{CommandIndex: 0, Status: model.StatusExecuted, Code: model.CodeOK}},
			}},
			EventHistory: map[model.EventType][]*model.GameEvent{
				model.EvtTickCompleted: {{EventID: "evt-1", Tick: 12, EventType: model.EvtTickCompleted}},
			},
			AlertHistory: []*model.ProductionAlert{{AlertID: "alert-1", Tick: 12, PlayerID: "p1"}},
			AuditLog:     []*model.AuditEntry{{Tick: 12, PlayerID: "p1", Action: "command"}},
		},
	}

	if err := dir.WriteInitial(meta, save); err != nil {
		t.Fatalf("write initial: %v", err)
	}
	gotMeta, gotSave, err := dir.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if gotMeta.GameplayConfig.Battlefield.MapSeed != "seed-a" {
		t.Fatalf("expected saved gameplay config, got %+v", gotMeta.GameplayConfig.Battlefield)
	}
	if gotMeta.CreatedAt.IsZero() || gotMeta.LastSavedAt.IsZero() {
		t.Fatalf("expected meta timestamps to be persisted")
	}
	if gotMeta.ConfigFingerprint == "" || gotMeta.MapFingerprint == "" {
		t.Fatalf("expected metadata fingerprints to be persisted")
	}
	if gotSave.Tick != 12 {
		t.Fatalf("expected tick 12, got %d", gotSave.Tick)
	}
	if gotSave.SavedAt.IsZero() {
		t.Fatalf("expected save saved_at to be persisted")
	}
	if gotSave.RuntimeState.Winner != "p1" {
		t.Fatalf("expected winner restored, got %q", gotSave.RuntimeState.Winner)
	}
	if len(gotSave.DebugState.CommandLog) != 1 {
		t.Fatalf("expected command log restored")
	}
	entry := gotSave.DebugState.CommandLog[0]
	if entry.IssuerType != "player" || entry.IssuerID != "p1" || entry.EnqueueTick != 11 {
		t.Fatalf("expected rich command metadata restored, got %+v", entry)
	}
	if len(entry.Commands) != 1 || len(entry.Results) != 1 {
		t.Fatalf("expected commands/results restored")
	}
	if gotSave.DebugState.BaseSnapshot == nil || gotSave.DebugState.BaseSnapshot.Tick != 10 || len(gotSave.DebugState.EventHistory[model.EvtTickCompleted]) != 1 || len(gotSave.DebugState.AlertHistory) != 1 || len(gotSave.DebugState.AuditLog) != 1 {
		t.Fatalf("expected debug state restored")
	}
}

func TestLoadRejectsMissingOrBrokenFiles(t *testing.T) {
	dir := Open(t.TempDir())
	if _, _, err := dir.Load(); err == nil || !strings.Contains(err.Error(), "meta.json") {
		t.Fatalf("expected missing meta.json error, got %v", err)
	}

	if err := os.WriteFile(dir.MetaPath(), []byte("{"), 0o644); err != nil {
		t.Fatalf("write broken meta: %v", err)
	}
	if err := os.WriteFile(dir.SavePath(), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write broken save: %v", err)
	}
	if _, _, err := dir.Load(); err == nil || !strings.Contains(err.Error(), "meta.json") {
		t.Fatalf("expected parse error mentioning meta.json, got %v", err)
	}
}

func TestWriteSaveAtomicallyReplacesFile(t *testing.T) {
	dir := Open(t.TempDir())
	meta := minimalMeta()
	save := minimalSave(5)
	if err := dir.WriteInitial(meta, save); err != nil {
		t.Fatalf("write initial: %v", err)
	}
	save.Tick = 6
	if err := dir.WriteSave(meta, save); err != nil {
		t.Fatalf("write save: %v", err)
	}
	if _, err := os.Stat(dir.SavePath() + ".tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected no temp file left behind, got %v", err)
	}
}

func TestNewMetaFileSetsMetadata(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-x", MaxTickRate: 20},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "k1"}},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 2},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 3},
		Planet: mapconfig.PlanetConfig{Width: 8, Height: 8, ResourceDensity: 9},
	}

	meta := NewMetaFile(cfg, mapCfg)
	if meta == nil {
		t.Fatalf("expected meta file")
	}
	if meta.FormatVersion != 1 {
		t.Fatalf("expected format version 1, got %d", meta.FormatVersion)
	}
	if meta.CreatedAt.IsZero() || meta.LastSavedAt.IsZero() {
		t.Fatalf("expected timestamps initialized")
	}
	if meta.LastSavedAt.Before(meta.CreatedAt) {
		t.Fatalf("expected last_saved_at >= created_at")
	}
	if meta.ConfigFingerprint == "" || meta.MapFingerprint == "" {
		t.Fatalf("expected fingerprints generated")
	}
}

func TestWriteInitialRejectsInvalidSnapshotWithoutWritingMeta(t *testing.T) {
	dir := Open(t.TempDir())
	bad := minimalSave(3)
	bad.Snapshot = &snapshot.Snapshot{Version: 0, Tick: 3}

	if err := dir.WriteInitial(minimalMeta(), bad); err == nil {
		t.Fatalf("expected invalid save rejected")
	}
	if _, err := os.Stat(dir.MetaPath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected meta.json absent after failed write, got %v", err)
	}
	if _, err := os.Stat(dir.SavePath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected save.json absent after failed write, got %v", err)
	}
}

func TestWriteSaveRejectsInvalidSnapshotWithoutAdvancingMeta(t *testing.T) {
	dir := Open(t.TempDir())
	meta := minimalMeta()
	save := minimalSave(5)
	if err := dir.WriteInitial(meta, save); err != nil {
		t.Fatalf("write initial: %v", err)
	}
	beforeMeta, beforeSave, err := dir.Load()
	if err != nil {
		t.Fatalf("load before write: %v", err)
	}

	bad := minimalSave(6)
	bad.Snapshot = &snapshot.Snapshot{Version: 0, Tick: 6}
	metaUpdate := *beforeMeta
	if err := dir.WriteSave(&metaUpdate, bad); err == nil {
		t.Fatalf("expected invalid save rejected")
	}

	afterMeta, afterSave, err := dir.Load()
	if err != nil {
		t.Fatalf("load after failed write: %v", err)
	}
	if !afterMeta.LastSavedAt.Equal(beforeMeta.LastSavedAt) {
		t.Fatalf("expected meta last_saved_at unchanged on failed save")
	}
	if afterSave.Tick != beforeSave.Tick {
		t.Fatalf("expected save tick unchanged on failed save, got %d", afterSave.Tick)
	}
}

func TestLoadRejectsInvalidSnapshotPayloads(t *testing.T) {
	dir := Open(t.TempDir())
	if err := dir.WriteInitial(minimalMeta(), minimalSave(7)); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	t.Run("invalid-snapshot", func(t *testing.T) {
		bad := minimalSave(8)
		bad.Snapshot = &snapshot.Snapshot{Version: 0, Tick: 8}
		data, err := json.Marshal(bad)
		if err != nil {
			t.Fatalf("marshal bad save: %v", err)
		}
		if err := os.WriteFile(dir.SavePath(), data, 0o644); err != nil {
			t.Fatalf("write bad save: %v", err)
		}
		if _, _, err := dir.Load(); err == nil || !strings.Contains(err.Error(), "snapshot") {
			t.Fatalf("expected invalid snapshot rejected, got %v", err)
		}
	})

	t.Run("invalid-base-snapshot", func(t *testing.T) {
		bad := minimalSave(9)
		bad.DebugState.BaseSnapshot = &snapshot.Snapshot{Version: 0, Tick: 9}
		data, err := json.Marshal(bad)
		if err != nil {
			t.Fatalf("marshal bad save: %v", err)
		}
		if err := os.WriteFile(dir.SavePath(), data, 0o644); err != nil {
			t.Fatalf("write bad save: %v", err)
		}
		if _, _, err := dir.Load(); err == nil || !strings.Contains(err.Error(), "base_snapshot") {
			t.Fatalf("expected invalid base snapshot rejected, got %v", err)
		}
	})
}

func TestLoadRejectsTornStateWhenSaveIsNewerThanMeta(t *testing.T) {
	dir := Open(t.TempDir())
	meta := minimalMeta()
	save := minimalSave(11)
	if err := dir.WriteInitial(meta, save); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	_, loadedSave, err := dir.Load()
	if err != nil {
		t.Fatalf("load baseline: %v", err)
	}
	loadedSave.SavedAt = loadedSave.SavedAt.Add(time.Second)
	loadedSave.Tick = 12
	data, err := json.Marshal(loadedSave)
	if err != nil {
		t.Fatalf("marshal torn save: %v", err)
	}
	if err := os.WriteFile(dir.SavePath(), data, 0o644); err != nil {
		t.Fatalf("write torn save: %v", err)
	}

	if _, _, err := dir.Load(); err == nil || !strings.Contains(err.Error(), "inconsistent") {
		t.Fatalf("expected torn-state consistency error, got %v", err)
	}
}

func minimalMeta() *MetaFile {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-min", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "k1"}},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 4, Height: 4, ResourceDensity: 5},
	}
	return NewMetaFile(cfg, mapCfg)
}

func minimalSave(tick int64) *SaveFile {
	return &SaveFile{
		FormatVersion: 1,
		Tick:          tick,
		Snapshot: &snapshot.Snapshot{
			Version: snapshot.CurrentVersion,
			Tick:    tick,
			World: &snapshot.WorldSnapshot{
				Tick:      tick,
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
		RuntimeState: RuntimeState{ActivePlanetID: "planet-1-1"},
	}
}
