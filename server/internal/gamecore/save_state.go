package gamecore

import (
	"fmt"
	"math/rand"
	"strings"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

// SaveResult describes a successful save operation.
type SaveResult struct {
	Trigger string
	Tick    int64
	SavedAt time.Time
	Path    string
}

// AttachGameDir binds a game directory and metadata to the core.
func (gc *GameCore) AttachGameDir(dir *gamedir.Dir, meta *gamedir.MetaFile, base *snapshot.Snapshot) {
	if gc == nil {
		return
	}
	gc.saveMu.Lock()
	defer gc.saveMu.Unlock()
	gc.gameDir = dir
	gc.saveMeta = meta
	gc.baseSnapshot = base
}

// ExportSaveFile exports current runtime and debug state into a save payload.
func (gc *GameCore) ExportSaveFile(trigger string) (*gamedir.SaveFile, error) {
	if gc == nil {
		return nil, fmt.Errorf("game core is nil")
	}
	gc.saveMu.Lock()
	base := gc.baseSnapshot
	gc.saveMu.Unlock()
	return gc.exportSaveFileWithBase(trigger, base)
}

func (gc *GameCore) exportSaveFileWithBase(trigger string, base *snapshot.Snapshot) (*gamedir.SaveFile, error) {
	if gc.world == nil || len(gc.worlds) == 0 {
		return nil, fmt.Errorf("world is nil")
	}
	if strings.TrimSpace(trigger) == "" {
		trigger = "manual"
	}

	current := snapshot.CaptureRuntime(gc.worlds, gc.activePlanetID, gc.discovery, gc.spaceRuntime)
	if current == nil {
		return nil, fmt.Errorf("capture snapshot: nil snapshot")
	}

	victory := gc.Victory()
	runtimeState := gamedir.RuntimeState{
		ActivePlanetID: gc.activePlanetID,
		Winner:         victory.WinnerID,
		VictoryReason:  victory.Reason,
		VictoryRule:    victory.VictoryRule,
		VictoryTechID:  victory.TechID,
	}
	if runtimeState.ActivePlanetID == "" && gc.world != nil {
		runtimeState.ActivePlanetID = gc.world.PlanetID
	}

	var commandLog []gamedir.CommandLogEntry
	if gc.cmdLog != nil {
		commandLog = exportCommandLog(gc.cmdLog.All())
	}
	var eventHistory map[model.EventType][]*model.GameEvent
	if gc.eventHistory != nil {
		eventHistory = gc.eventHistory.Export()
	}
	var alertHistory []*model.ProductionAlert
	if gc.alertHistory != nil {
		alertHistory = gc.alertHistory.All()
	}
	var auditLog []*model.AuditEntry
	if gc.snapshotStore != nil {
		auditLog = cloneAuditEntries(gc.snapshotStore.AuditEntries())
	}

	return &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          current.Tick,
		Snapshot:      current,
		RuntimeState:  runtimeState,
		DebugState: gamedir.DebugState{
			BaseSnapshot: chooseBaseSnapshot(base, current),
			CommandLog:   commandLog,
			EventHistory: eventHistory,
			AlertHistory: alertHistory,
			AuditLog:     auditLog,
		},
	}, nil
}

// Save exports and writes save payload into attached game directory.
func (gc *GameCore) Save(trigger string) (*SaveResult, error) {
	if gc == nil {
		return nil, fmt.Errorf("game core is nil")
	}

	gc.saveMu.Lock()
	dir := gc.gameDir
	meta := gc.saveMeta
	base := gc.baseSnapshot
	gc.saveMu.Unlock()
	if dir == nil {
		return nil, fmt.Errorf("game dir not attached")
	}
	if meta == nil {
		return nil, fmt.Errorf("save meta not attached")
	}

	save, err := gc.exportSaveFileWithBase(trigger, base)
	if err != nil {
		return nil, err
	}
	if err := dir.WriteSave(meta, save); err != nil {
		return nil, err
	}
	return &SaveResult{
		Trigger: trigger,
		Tick:    save.Tick,
		SavedAt: save.SavedAt,
		Path:    dir.SavePath(),
	}, nil
}

// NewFromSave restores a GameCore from a save file.
func NewFromSave(cfg *config.Config, maps *mapmodel.Universe, q *queue.CommandQueue, bus *EventBus, store *persistence.Store, save *gamedir.SaveFile) (*GameCore, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is nil")
	}
	if maps == nil {
		return nil, fmt.Errorf("maps is nil")
	}
	if save == nil {
		return nil, fmt.Errorf("save file is nil")
	}
	if save.Snapshot == nil {
		return nil, fmt.Errorf("save snapshot is nil")
	}
	if q == nil {
		q = queue.New()
	}
	if bus == nil {
		bus = NewEventBus()
	}
	if err := config.ApplyDefaults(cfg); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	worlds, activePlanetID, spaceRuntime, err := save.Snapshot.RestoreRuntime()
	if err != nil {
		return nil, fmt.Errorf("restore runtime: %w", err)
	}
	activeWorld := worlds[activePlanetID]
	if activeWorld == nil {
		return nil, fmt.Errorf("active world %s missing in save", activePlanetID)
	}
	for _, world := range worlds {
		world.Tick = save.Tick
	}
	discovery, err := save.Snapshot.RestoreDiscovery()
	if err != nil {
		return nil, fmt.Errorf("restore discovery: %w", err)
	}
	if discovery == nil {
		discovery = mapstate.NewDiscovery(cfg.Players, maps)
	}

	seed := int64(1)
	if activeWorld != nil && activeWorld.PlanetID != "" {
		if planet, ok := maps.Planet(activeWorld.PlanetID); ok && planet != nil {
			seed = planet.Seed
		}
	} else if primary := maps.PrimaryPlanet(); primary != nil {
		seed = primary.Seed
	}

	core := &GameCore{
		cfg:              cfg,
		maps:             maps,
		discovery:        discovery,
		world:            activeWorld,
		worlds:           worlds,
		queue:            q,
		bus:              bus,
		metrics:          NewMetrics(),
		cmdLog:           &CommandLog{},
		eventHistory:     NewEventHistory(cfg.Server.EventHistoryLimit),
		alertHistory:     NewAlertHistory(cfg.Server.AlertHistoryLimit),
		monitor:          newProductionMonitor(cfg.Server.ProductionMonitor),
		snapshotStore:    store,
		rng:              rand.New(rand.NewSource(seed)),
		stopCh:           make(chan struct{}),
		activePlanetID:   activePlanetID,
		executorUsage:    make(map[string]int),
		spaceRuntime:     spaceRuntime,
		combatUnits:      NewCombatUnitManager(),
		orbitalPlatforms: NewOrbitalPlatformManager(),
		baseSnapshot:     chooseBaseSnapshot(save.DebugState.BaseSnapshot, save.Snapshot),
	}
	if core.activePlanetID == "" && activeWorld != nil {
		core.activePlanetID = activeWorld.PlanetID
	}
	core.setActivePlanet(core.activePlanetID)
	core.setVictoryState(model.VictoryState{
		WinnerID:    save.RuntimeState.Winner,
		Reason:      save.RuntimeState.VictoryReason,
		VictoryRule: save.RuntimeState.VictoryRule,
		TechID:      save.RuntimeState.VictoryTechID,
	})

	core.cmdLog.ReplaceAll(importCommandLog(save.DebugState.CommandLog))
	core.eventHistory.ReplaceAll(save.DebugState.EventHistory)
	core.alertHistory.ReplaceAll(save.DebugState.AlertHistory)

	if store != nil {
		store.ReplaceAudit(cloneAuditEntries(save.DebugState.AuditLog))
		store.ReplaceSnapshots(core.baseSnapshot, save.Snapshot)
	}

	return core, nil
}

func exportCommandLog(entries []commandLogEntry) []gamedir.CommandLogEntry {
	out := make([]gamedir.CommandLogEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, gamedir.CommandLogEntry{
			Tick:        entry.Tick,
			PlayerID:    entry.PlayerID,
			RequestID:   entry.RequestID,
			IssuerType:  entry.IssuerType,
			IssuerID:    entry.IssuerID,
			EnqueueTick: entry.EnqueueTick,
			Commands:    append([]model.Command(nil), entry.Commands...),
			Results:     append([]model.CommandResult(nil), entry.Results...),
		})
	}
	return out
}

func importCommandLog(entries []gamedir.CommandLogEntry) []commandLogEntry {
	out := make([]commandLogEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, commandLogEntry{
			Tick:        entry.Tick,
			PlayerID:    entry.PlayerID,
			RequestID:   entry.RequestID,
			IssuerType:  entry.IssuerType,
			IssuerID:    entry.IssuerID,
			EnqueueTick: entry.EnqueueTick,
			Commands:    append([]model.Command(nil), entry.Commands...),
			Results:     append([]model.CommandResult(nil), entry.Results...),
		})
	}
	return out
}

func chooseBaseSnapshot(base, current *snapshot.Snapshot) *snapshot.Snapshot {
	if base != nil {
		return base
	}
	return current
}

func cloneAuditEntries(entries []*model.AuditEntry) []*model.AuditEntry {
	if len(entries) == 0 {
		return nil
	}
	out := make([]*model.AuditEntry, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		cp := *entry
		if entry.PermissionGranted != nil {
			granted := *entry.PermissionGranted
			cp.PermissionGranted = &granted
		}
		if len(entry.Permissions) > 0 {
			cp.Permissions = append([]string(nil), entry.Permissions...)
		}
		if len(entry.Details) > 0 {
			details := make(map[string]any, len(entry.Details))
			for k, v := range entry.Details {
				details[k] = v
			}
			cp.Details = details
		}
		out = append(out, &cp)
	}
	return out
}
