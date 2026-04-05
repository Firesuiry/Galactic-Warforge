package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestT097OfficialMidgameIdleProductionBuildingsDoNotInflateStats(t *testing.T) {
	core := newOfficialMidgameTestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	player.Stats.ProductionStats.Efficiency = 0.5

	positions := make([]model.Position, 0, 3)
	for len(positions) < 3 {
		pos, err := findOpenTile(ws, 2)
		if err != nil || pos == nil {
			t.Fatalf("find open tile %d: %v", len(positions), err)
		}
		positions = append(positions, *pos)
		placeholder := newBuilding("placeholder-"+string(rune('0'+len(positions))), model.BuildingTypeDepotMk1, "p1", *pos)
		placeBuilding(ws, placeholder)
	}
	for _, pos := range positions {
		delete(ws.Buildings, ws.Grid[pos.Y][pos.X].BuildingID)
		delete(ws.TileBuilding, model.TileKey(pos.X, pos.Y))
		ws.Grid[pos.Y][pos.X].BuildingID = ""
	}

	recomposingAssembler := newBuilding("b-51", model.BuildingTypeRecomposingAssembler, "p1", positions[0])
	recomposingAssembler.Runtime.State = model.BuildingWorkRunning

	selfEvolutionLab := newBuilding("b-52", model.BuildingTypeSelfEvolutionLab, "p1", positions[1])
	selfEvolutionLab.Runtime.State = model.BuildingWorkRunning

	silo := newVerticalLaunchingSiloBuilding("b-35", positions[2], "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	silo.Production.RecipeID = "small_carrier_rocket"

	for _, building := range []*model.Building{recomposingAssembler, selfEvolutionLab, silo} {
		placeBuilding(ws, building)
	}

	stats := settleProductionAndCollectStats(t, core, "p1")
	if stats.TotalOutput != 0 {
		t.Fatalf("expected official midgame idle production buildings to contribute zero output, got %+v", stats)
	}
	if len(stats.ByBuildingType) != 0 {
		t.Fatalf("expected no by_building_type entries for idle official midgame buildings, got %+v", stats.ByBuildingType)
	}
	if len(stats.ByItem) != 0 {
		t.Fatalf("expected no by_item entries for idle official midgame buildings, got %+v", stats.ByItem)
	}
	if stats.Efficiency != 0 {
		t.Fatalf("expected efficiency reset in official midgame idle case, got %+v", stats)
	}
}
