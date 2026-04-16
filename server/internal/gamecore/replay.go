package gamecore

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
)

// Replay replays command logs from a snapshot to validate determinism.
func (gc *GameCore) Replay(req model.ReplayRequest) (*model.ReplayResponse, error) {
	if gc == nil {
		return nil, errors.New("game core is nil")
	}
	if gc.snapshotStore == nil {
		return nil, errors.New("snapshot store not configured")
	}
	if req.FromTick < 0 || req.ToTick < 0 {
		return nil, errors.New("tick must be non-negative")
	}
	if req.Speed < 0 {
		return nil, errors.New("speed must be non-negative")
	}

	currentTick := gc.currentTick()
	toTick := req.ToTick
	if toTick == 0 {
		toTick = currentTick
	}
	fromTick := req.FromTick
	if fromTick == 0 {
		fromTick = toTick
	}
	if req.Step {
		toTick = fromTick
	}
	if toTick < fromTick {
		return nil, errors.New("to_tick must be >= from_tick")
	}
	if toTick > currentTick {
		return nil, fmt.Errorf("to_tick %d exceeds current tick %d", toTick, currentTick)
	}

	lookupTick := fromTick
	if fromTick > 0 {
		lookupTick = fromTick - 1
	}
	snap := gc.snapshotStore.SnapshotAtOrBefore(lookupTick)
	if snap == nil {
		return nil, fmt.Errorf("no snapshot available at or before tick %d", lookupTick)
	}
	if snap.Tick > fromTick {
		return nil, fmt.Errorf("snapshot tick %d is after requested from_tick %d", snap.Tick, fromTick)
	}
	if toTick < snap.Tick {
		return nil, fmt.Errorf("target tick %d precedes snapshot tick %d", toTick, snap.Tick)
	}

	worlds, activePlanetID, spaceRuntime, err := snap.RestoreRuntime()
	if err != nil {
		return nil, fmt.Errorf("restore runtime: %w", err)
	}
	world := worlds[activePlanetID]
	if world == nil {
		return nil, fmt.Errorf("active world %s missing in replay snapshot", activePlanetID)
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
	mismatchCount := 0
	delay := time.Duration(0)
	if req.Speed > 0 {
		delay = time.Duration(float64(time.Second) / req.Speed)
	}

	for tick := snap.Tick + 1; tick <= toTick; tick++ {
		frame := replayCore.advanceWorldsOneTick()

		if tickEntries := entriesByTick[frame.currentTick]; len(tickEntries) > 0 {
			for _, entry := range tickEntries {
				qr := &model.QueuedRequest{
					Request: model.CommandRequest{
						RequestID: entry.RequestID,
						Commands:  entry.Commands,
					},
					PlayerID: entry.PlayerID,
				}
				results, _ := replayCore.executeRequest(qr)
				commandCount += len(entry.Commands)
				if req.Verify {
					mismatchCount += compareCommandResults(entry.Results, results)
				}
			}
		}

		_ = tick
		_ = replayCore.runSettlementPipeline(frame)

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	durationMs := time.Since(start).Milliseconds()
	digest := digestRuntime(replayCore.world, replayCore.spaceRuntime)

	var snapDigest *model.ReplayDigest
	drift := false
	var notes []string
	if req.Verify {
		if targetSnap := gc.snapshotStore.SnapshotAt(toTick); targetSnap != nil {
			targetWorld, err := targetSnap.RestoreWorld()
			if err != nil {
				notes = append(notes, fmt.Sprintf("目标快照恢复失败: %v", err))
			} else {
				d := digestRuntime(targetWorld, targetSnap.Space)
				snapDigest = &d
				if d.Hash != digest.Hash {
					drift = true
				}
			}
		} else {
			notes = append(notes, fmt.Sprintf("目标 tick %d 无对应快照，跳过哈希比对", toTick))
		}
		if mismatchCount > 0 {
			drift = true
		}
	}

	replayFromTick := snap.Tick + 1
	if toTick < replayFromTick {
		replayFromTick = snap.Tick
	}
	appliedTicks := toTick - snap.Tick
	if appliedTicks < 0 {
		appliedTicks = 0
	}

	return &model.ReplayResponse{
		FromTick:            fromTick,
		ToTick:              toTick,
		SnapshotTick:        snap.Tick,
		ReplayFromTick:      replayFromTick,
		ReplayToTick:        toTick,
		AppliedTicks:        appliedTicks,
		CommandCount:        commandCount,
		ResultMismatchCount: mismatchCount,
		DurationMs:          durationMs,
		Step:                req.Step,
		Speed:               req.Speed,
		Digest:              digest,
		SnapshotDigest:      snapDigest,
		DriftDetected:       drift,
		Notes:               notes,
	}, nil
}

func (gc *GameCore) currentTick() int64 {
	return gc.CurrentTick()
}

func compareCommandResults(expected, actual []model.CommandResult) int {
	mismatch := 0
	if len(expected) != len(actual) {
		diff := len(expected) - len(actual)
		if diff < 0 {
			diff = -diff
		}
		mismatch += diff
	}
	n := len(expected)
	if len(actual) < n {
		n = len(actual)
	}
	for i := 0; i < n; i++ {
		if expected[i].Status != actual[i].Status || expected[i].Code != actual[i].Code || expected[i].CommandIndex != actual[i].CommandIndex {
			mismatch++
		}
	}
	return mismatch
}

func digestRuntime(ws *model.WorldState, space *model.SpaceRuntimeState) model.ReplayDigest {
	d := model.ReplayDigest{}
	if ws == nil {
		return d
	}
	d.Tick = ws.Tick
	d.Players = len(ws.Players)
	d.Buildings = len(ws.Buildings)
	d.Units = len(ws.Units)
	d.Resources = len(ws.Resources)
	d.EntityCounter = ws.EntityCounter

	for _, p := range ws.Players {
		if p == nil {
			continue
		}
		if p.IsAlive {
			d.AlivePlayers++
		}
		d.TotalMinerals += p.Resources.Minerals
		d.TotalEnergy += p.Resources.Energy
	}
	for _, r := range ws.Resources {
		if r == nil {
			continue
		}
		d.ResourceRemaining += int64(r.Remaining)
	}
	if space != nil {
		d.SpaceEntityCounter = space.EntityCounter
		for _, playerRuntime := range space.Players {
			if playerRuntime == nil {
				continue
			}
			for _, systemRuntime := range playerRuntime.Systems {
				if systemRuntime == nil || systemRuntime.SolarSailOrbit == nil {
					continue
				}
				d.SolarSailSystems++
				d.SolarSailCount += len(systemRuntime.SolarSailOrbit.Sails)
				d.SolarSailTotalEnergy += systemRuntime.SolarSailOrbit.TotalEnergy
			}
		}
	}

	d.Hash = hashDigest(d)
	return d
}

func hashDigest(d model.ReplayDigest) string {
	raw := fmt.Sprintf("%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d",
		d.Tick,
		d.Players,
		d.AlivePlayers,
		d.Buildings,
		d.Units,
		d.Resources,
		d.TotalMinerals,
		d.TotalEnergy,
		d.ResourceRemaining,
		d.EntityCounter,
		d.SpaceEntityCounter,
		d.SolarSailCount,
		d.SolarSailSystems,
		d.SolarSailTotalEnergy,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
