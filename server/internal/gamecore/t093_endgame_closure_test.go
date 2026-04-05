package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestMissionCompleteDeclaresVictoryAndRecordsOutputs(t *testing.T) {
	core := newSaveStateHarness(t)
	core.cfg.Battlefield.VictoryRule = "hybrid"
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	grantTechs(ws, "p1", "universe_matrix")

	lab := newBuilding("lab-t093", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research.ResearchPerTick = 10
	if _, _, err := lab.Storage.Load(model.ItemUniverseMatrix, 1); err != nil {
		t.Fatalf("load universe matrix: %v", err)
	}
	placeBuilding(ws, lab)

	player.Tech.CurrentResearch = &model.PlayerResearch{
		TechID:       "mission_complete",
		State:        model.ResearchInProgress,
		TotalCost:    1,
		RequiredCost: []model.ItemAmount{{ItemID: model.ItemUniverseMatrix, Quantity: 1}},
		ConsumedCost: map[string]int{},
	}

	core.processTick()

	victory := core.Victory()
	if victory.WinnerID != "p1" {
		t.Fatalf("expected winner p1, got %+v", victory)
	}
	if victory.Reason != "game_win" {
		t.Fatalf("expected reason game_win, got %+v", victory)
	}
	if victory.VictoryRule != "hybrid" {
		t.Fatalf("expected victory_rule hybrid, got %+v", victory)
	}
	if victory.TechID != "mission_complete" {
		t.Fatalf("expected tech_id mission_complete, got %+v", victory)
	}

	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtResearchCompleted, model.EvtVictoryDeclared}, "", 0, 10)
	if len(events) < 2 {
		t.Fatalf("expected research and victory events, got %+v", events)
	}
	if events[0].EventType != model.EvtResearchCompleted {
		t.Fatalf("expected first event research_completed, got %+v", events)
	}
	if events[1].EventType != model.EvtVictoryDeclared {
		t.Fatalf("expected second event victory_declared, got %+v", events)
	}

	victoryAuditFound := false
	for _, entry := range core.snapshotStore.AuditEntries() {
		if entry == nil || entry.Action != "victory" {
			continue
		}
		victoryAuditFound = true
		if entry.Details["winner_id"] != "p1" || entry.Details["reason"] != "game_win" || entry.Details["victory_rule"] != "hybrid" || entry.Details["tech_id"] != "mission_complete" {
			t.Fatalf("unexpected victory audit details: %+v", entry.Details)
		}
	}
	if !victoryAuditFound {
		t.Fatalf("expected victory audit entry, got %+v", core.snapshotStore.AuditEntries())
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	summary := ql.Summary(ws, "p1", victory)
	if summary.Winner != "p1" || summary.VictoryReason != "game_win" || summary.VictoryRule != "hybrid" {
		t.Fatalf("unexpected summary victory payload: %+v", summary)
	}

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	if save.RuntimeState.Winner != "p1" || save.RuntimeState.VictoryReason != "game_win" || save.RuntimeState.VictoryRule != "hybrid" || save.RuntimeState.VictoryTechID != "mission_complete" {
		t.Fatalf("unexpected runtime save state: %+v", save.RuntimeState)
	}
}

func TestEnergyStatsUseResolvedNetworksAndStorageState(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	generator := newBuilding("wind-t093", model.BuildingTypeWindTurbine, "p1", model.Position{X: 1, Y: 1})
	generator.Runtime.State = model.BuildingWorkRunning
	receiver := newBuilding("receiver-t093", model.BuildingTypeRayReceiver, "p1", model.Position{X: 2, Y: 1})
	receiver.Runtime.State = model.BuildingWorkRunning
	consumer := newBuilding("assembler-t093", model.BuildingTypeAssemblingMachineMk1, "p1", model.Position{X: 3, Y: 1})
	consumer.Runtime.State = model.BuildingWorkRunning
	consumer.Runtime.Params.EnergyConsume = 30
	consumer.Runtime.Functions.Energy.ConsumePerTick = 30
	storage := newBuilding("storage-t093", model.BuildingTypeEnergyExchanger, "p1", model.Position{X: 4, Y: 1})
	storage.Runtime.State = model.BuildingWorkPaused
	storage.Runtime.Functions.EnergyStorage.Capacity = 50
	storage.EnergyStorage.Energy = 9

	for _, building := range []*model.Building{generator, receiver, consumer, storage} {
		placeBuilding(ws, building)
		model.RegisterPowerGridBuilding(ws, building)
	}

	ws.PowerInputs = []model.PowerInput{
		{BuildingID: generator.ID, OwnerID: "p1", Output: 12},
		{BuildingID: receiver.ID, OwnerID: "p1", Output: 8},
	}

	core.updateEnergyStats(player)

	stats := player.Stats.EnergyStats
	if stats.Generation != 20 {
		t.Fatalf("expected generation 20 from resolved network supply, got %+v", stats)
	}
	if stats.Consumption != 20 {
		t.Fatalf("expected consumption 20 from resolved allocations, got %+v", stats)
	}
	if stats.Storage != 50 {
		t.Fatalf("expected storage 50 from runtime energy storage capacity, got %+v", stats)
	}
	if stats.CurrentStored != 9 {
		t.Fatalf("expected current_stored 9 from energy storage state, got %+v", stats)
	}
	if stats.ShortageTicks != 1 {
		t.Fatalf("expected shortage_ticks to increment, got %+v", stats)
	}
}
