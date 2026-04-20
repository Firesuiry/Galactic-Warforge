package gamecore

import "siliconworld/internal/model"

type settlementFrame struct {
	currentTick  int64
	currentWorld *model.WorldState
	worlds       []*model.WorldState
}

type settlementPhase struct {
	name string
	run  func(*GameCore, *settlementFrame) []*model.GameEvent
}

type settlementPipeline struct {
	phases []settlementPhase
}

func newSettlementPipeline() settlementPipeline {
	var pipeline settlementPipeline

	pipeline.register("construction", func(gc *GameCore, frame *settlementFrame) []*model.GameEvent {
		var events []*model.GameEvent
		for _, ws := range frame.worlds {
			events = append(events, gc.settleConstructionQueue(ws)...)
			events = append(events, settleBuildingJobs(ws)...)
		}
		return events
	})

	pipeline.register("research_and_dyson", func(gc *GameCore, frame *settlementFrame) []*model.GameEvent {
		events := settleResearch(gc.worlds)
		events = append(events, settleWarIndustry(frame.currentWorld, gc.spaceRuntime, frame.currentTick)...)
		events = append(events, settleSolarSails(gc.spaceRuntime, frame.currentTick)...)
		events = append(events, settleDysonSpheres(gc.spaceRuntime, frame.currentTick)...)
		return events
	})

	pipeline.register("planetary_runtime", func(gc *GameCore, frame *settlementFrame) []*model.GameEvent {
		var events []*model.GameEvent
		for _, ws := range frame.worlds {
			ws.ProductionSnapshot = model.NewProductionSettlementSnapshot(ws.Tick)

			env := currentPlanetEnvironment(gc.maps, ws.PlanetID)
			events = append(events, settlePowerGeneration(ws, env)...)
			receiverViews := settleRayReceivers(ws, gc.maps, gc.spaceRuntime)
			settlePlanetaryShields(ws)
			events = append(events, finalizePowerSettlement(ws, receiverViews)...)
			events = append(events, settleResources(ws)...)

			settleOrbitalCollectors(ws, gc.maps)
			settleConveyors(ws)
			settleSorters(ws)
			settleBuildingIO(ws)
			settlePipelineFlow(ws)
			settlePipelineIO(ws)
			events = append(events, settleProduction(ws)...)
			settleStorage(ws)

			if gc.monitor != nil {
				monEvents, alerts := gc.monitor.settleProductionMonitoring(ws, ws.Tick)
				events = append(events, monEvents...)
				if gc.alertHistory != nil && len(alerts) > 0 {
					gc.alertHistory.Record(alerts)
				}
			}

			settleLogisticsDispatch(ws)
			settleLogisticsDrones(ws)
		}
		return events
	})

	pipeline.register("interstellar_runtime", func(gc *GameCore, frame *settlementFrame) []*model.GameEvent {
		settleInterstellarDispatch(gc.worlds, gc.maps)
		settleLogisticsShips(gc.worlds)

		var events []*model.GameEvent
		for _, ws := range frame.worlds {
			events = append(events, settleCombatRuntime(ws, ws.Tick)...)
		}
		events = append(events, settleSpaceFleets(gc.worlds, gc.maps, gc.spaceRuntime, frame.currentTick)...)
		return events
	})

	pipeline.register("active_world_runtime", func(gc *GameCore, frame *settlementFrame) []*model.GameEvent {
		activeWorld := gc.resolveActiveWorld(frame.currentWorld)
		if activeWorld == nil {
			return nil
		}

		var events []*model.GameEvent
		events = append(events, settleTurrets(activeWorld)...)
		events = append(events, gc.settleEnemyForces()...)
		events = append(events, gc.settleCombat()...)
		events = append(events, gc.settleOrbitalCombat()...)
		events = append(events, gc.settleDroneControl()...)
		gc.settleStats()

		if !gc.Victory().Declared() {
			victory := resolveVictory(gc.cfg.Battlefield.VictoryRule, gc.worlds, activeWorld)
			if gc.declareVictory(victory) {
				events = append(events, victoryDeclaredEvent(victory))
				gc.recordVictoryAudit(victory)
			}
		}
		return events
	})

	return pipeline
}

func (p *settlementPipeline) register(name string, run func(*GameCore, *settlementFrame) []*model.GameEvent) {
	p.phases = append(p.phases, settlementPhase{
		name: name,
		run:  run,
	})
}

func (p settlementPipeline) run(gc *GameCore, frame *settlementFrame) []*model.GameEvent {
	var events []*model.GameEvent
	for _, phase := range p.phases {
		_ = phase.name
		events = append(events, phase.run(gc, frame)...)
	}
	return events
}

func (gc *GameCore) advanceWorldsOneTick() *settlementFrame {
	worlds := gc.sortedWorlds()
	for _, ws := range worlds {
		ws.Tick++
	}

	currentWorld := gc.World()
	if currentWorld == nil {
		activePlanetID := gc.ActivePlanetID()
		currentWorld = gc.WorldForPlanet(activePlanetID)
		if currentWorld != nil {
			gc.setCurrentWorld(activePlanetID, currentWorld)
		}
	}

	currentTick := int64(0)
	if currentWorld != nil {
		currentTick = currentWorld.Tick
		gc.executorUsage = countActiveExecutorUsage(currentWorld)
	}
	if gc.queue != nil && currentTick > 0 {
		gc.queue.PruneSeen(currentTick)
	}

	return &settlementFrame{
		currentTick:  currentTick,
		currentWorld: currentWorld,
		worlds:       worlds,
	}
}

func (gc *GameCore) runSettlementPipeline(frame *settlementFrame) []*model.GameEvent {
	if gc == nil || frame == nil {
		return nil
	}
	pipeline := newSettlementPipeline()
	return pipeline.run(gc, frame)
}

func (gc *GameCore) resolveActiveWorld(currentWorld *model.WorldState) *model.WorldState {
	activePlanetID := gc.ActivePlanetID()
	activeWorld := gc.WorldForPlanet(activePlanetID)
	if activeWorld == nil {
		activeWorld = currentWorld
	}
	if activeWorld != nil {
		gc.setCurrentWorld(activePlanetID, activeWorld)
	}
	return activeWorld
}

func hasVictoryDeclaredEvent(events []*model.GameEvent) bool {
	for _, evt := range events {
		if evt != nil && evt.EventType == model.EvtVictoryDeclared {
			return true
		}
	}
	return false
}
