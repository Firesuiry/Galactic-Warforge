package gamecore

import (
	"errors"
	"fmt"
	"time"

	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
)

// Rollback rewinds the live world state to a target tick using snapshots and command logs.
func (gc *GameCore) Rollback(req model.RollbackRequest) (*model.RollbackResponse, error) {
	if gc == nil {
		return nil, errors.New("game core is nil")
	}
	if gc.snapshotStore == nil {
		return nil, errors.New("snapshot store not configured")
	}
	if req.ToTick < 0 {
		return nil, errors.New("to_tick must be non-negative")
	}

	gc.world.Lock()
	defer gc.world.Unlock()

	currentTick := gc.world.Tick
	toTick := req.ToTick
	if toTick == 0 {
		toTick = currentTick
	}
	if toTick > currentTick {
		return nil, fmt.Errorf("to_tick %d exceeds current tick %d", toTick, currentTick)
	}

	snap := gc.snapshotStore.SnapshotAtOrBefore(toTick)
	if snap == nil {
		return nil, fmt.Errorf("no snapshot available at or before tick %d", toTick)
	}
	if snap.Tick > toTick {
		return nil, fmt.Errorf("snapshot tick %d is after requested to_tick %d", snap.Tick, toTick)
	}

	worlds, activePlanetID, spaceRuntime, err := snap.RestoreRuntime()
	if err != nil {
		return nil, fmt.Errorf("restore runtime: %w", err)
	}
	world := worlds[activePlanetID]
	if world == nil {
		return nil, fmt.Errorf("active world %s missing in rollback snapshot", activePlanetID)
	}
	discovery, err := snap.RestoreDiscovery()
	if err != nil {
		return nil, fmt.Errorf("restore discovery: %w", err)
	}
	if discovery == nil {
		discovery = mapstate.NewDiscovery(gc.cfg.Players, gc.maps)
	}

	replayCore := &GameCore{
		cfg:              gc.cfg,
		maps:             gc.maps,
		discovery:        discovery,
		world:            world,
		worlds:           worlds,
		executorUsage:    make(map[string]int),
		activePlanetID:   activePlanetID,
		spaceRuntime:     spaceRuntime,
		alertHistory:     NewAlertHistory(gc.cfg.Server.AlertHistoryLimit),
		monitor:          newProductionMonitor(gc.cfg.Server.ProductionMonitor),
		combatUnits:      NewCombatUnitManager(),
		orbitalPlatforms: NewOrbitalPlatformManager(),
	}

	entries := gc.cmdLog.Range(snap.Tick+1, toTick)
	entriesByTick := make(map[int64][]commandLogEntry)
	for _, entry := range entries {
		entriesByTick[entry.Tick] = append(entriesByTick[entry.Tick], entry)
	}

	start := time.Now()
	commandCount := 0

	for tick := snap.Tick + 1; tick <= toTick; tick++ {
		frame := replayCore.advanceWorldsOneTick()

		if tickEntries := entriesByTick[frame.currentTick]; len(tickEntries) > 0 {
			for _, entry := range tickEntries {
				qr := &model.QueuedRequest{
					Request: model.CommandRequest{
						RequestID:  entry.RequestID,
						IssuerType: entry.IssuerType,
						IssuerID:   entry.IssuerID,
						Commands:   entry.Commands,
					},
					PlayerID: entry.PlayerID,
				}
				_, _ = replayCore.executeRequest(qr)
				commandCount += len(entry.Commands)
			}
		}

		_ = tick
		_ = replayCore.runSettlementPipeline(frame)
	}

	durationMs := time.Since(start).Milliseconds()
	digest := digestRuntime(replayCore.world, replayCore.spaceRuntime)

	applyWorldState(gc.world, replayCore.world)
	if gc.discovery == nil {
		gc.discovery = replayCore.discovery
	} else {
		gc.discovery.ReplaceFromSnapshot(replayCore.discovery.Snapshot())
	}
	gc.executorUsage = countActiveExecutorUsage(gc.world)
	gc.setVictoryState(replayCore.Victory())
	gc.setCurrentWorld(gc.world.PlanetID, gc.world)
	gc.spaceRuntime = model.CloneSpaceRuntimeState(replayCore.spaceRuntime)

	trimmedLogAfter := gc.cmdLog.TrimAfter(toTick)
	trimmedEvents := 0
	if gc.eventHistory != nil {
		trimmedEvents = gc.eventHistory.TrimAfterTick(toTick)
	}
	trimmedAlerts := 0
	if gc.alertHistory != nil {
		trimmedAlerts = gc.alertHistory.TrimAfterTick(toTick)
	}
	trimmedSnapshots, trimmedDeltas := gc.snapshotStore.TrimAfter(toTick)
	gc.snapshotStore.TrimAuditAfterTick(toTick)
	trimmedLogBefore := 0
	if oldest := gc.snapshotStore.OldestSnapshotTick(); oldest > 0 {
		trimmedLogBefore = gc.cmdLog.TrimBefore(oldest)
		gc.snapshotStore.TrimAuditBeforeTick(oldest)
	}
	if gc.queue != nil {
		gc.queue.ClearPending()
	}

	replayFromTick := snap.Tick + 1
	if toTick < replayFromTick {
		replayFromTick = snap.Tick
	}
	appliedTicks := toTick - snap.Tick
	if appliedTicks < 0 {
		appliedTicks = 0
	}

	return &model.RollbackResponse{
		FromTick:            currentTick,
		ToTick:              toTick,
		SnapshotTick:        snap.Tick,
		ReplayFromTick:      replayFromTick,
		ReplayToTick:        toTick,
		AppliedTicks:        appliedTicks,
		CommandCount:        commandCount,
		DurationMs:          durationMs,
		TrimmedCommandLog:   trimmedLogAfter + trimmedLogBefore,
		TrimmedEventHistory: trimmedEvents,
		TrimmedAlertHistory: trimmedAlerts,
		TrimmedSnapshots:    trimmedSnapshots,
		TrimmedDeltas:       trimmedDeltas,
		Digest:              digest,
	}, nil
}

func applyWorldState(dst, src *model.WorldState) {
	if dst == nil || src == nil {
		return
	}
	dst.Tick = src.Tick
	dst.PlanetID = src.PlanetID
	dst.MapWidth = src.MapWidth
	dst.MapHeight = src.MapHeight
	dst.Players = src.Players
	dst.Buildings = src.Buildings
	dst.Units = src.Units
	dst.Grid = src.Grid
	dst.Resources = src.Resources
	dst.TileBuilding = src.TileBuilding
	dst.TileUnits = src.TileUnits
	dst.EntityCounter = src.EntityCounter
	dst.Pipelines = src.Pipelines
}
