package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

func findOwnedBuildingByType(ws *model.WorldState, ownerID string, btype model.BuildingType) *model.Building {
	if ws == nil {
		return nil
	}
	for _, building := range ws.Buildings {
		if building == nil {
			continue
		}
		if building.OwnerID == ownerID && building.Type == btype {
			return building
		}
	}
	return nil
}

func waitForCompletedResearch(t *testing.T, core *GameCore, playerID, techID string) {
	t.Helper()

	for i := 0; i < 64; i++ {
		core.processTick()
		player := core.World().Players[playerID]
		if player != nil && player.Tech != nil && player.Tech.CompletedTechs[techID] > 0 {
			return
		}
	}

	player := core.World().Players[playerID]
	t.Fatalf("research %s did not complete, player tech state: %+v", techID, player.Tech)
}

func TestT092FreshNewGameCanReachEarlyResearchClosure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}
	player.EnsureInventory()[model.ItemElectromagneticMatrix] = 50

	if !CanBuildTech(player, model.TechUnlockBuilding, string(model.BuildingTypeMatrixLab)) {
		t.Fatalf("expected fresh new game to allow building %s from initial tech", model.BuildingTypeMatrixLab)
	}

	base := findOwnedBuildingByType(ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
	if base == nil {
		t.Fatal("expected p1 base building")
	}
	windPos, err := findAdjacentOpenTile(ws, base.Position)
	if err != nil {
		t.Fatalf("find adjacent wind tile: %v", err)
	}
	if windPos == nil {
		t.Fatal("expected open tile next to base for first wind turbine")
	}

	buildWindRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: windPos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeWindTurbine),
		},
	})
	if buildWindRes.Code != model.CodeOK {
		t.Fatalf("build first wind turbine: %s (%s)", buildWindRes.Code, buildWindRes.Message)
	}

	for i := 0; i < 8; i++ {
		core.processTick()
	}

	labPos, err := findAdjacentOpenTile(ws, base.Position)
	if err != nil {
		t.Fatalf("find adjacent lab tile: %v", err)
	}
	if labPos == nil {
		t.Fatal("expected open tile next to base for first matrix lab")
	}

	buildRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: labPos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeMatrixLab),
		},
	})
	if buildRes.Code != model.CodeOK {
		t.Fatalf("build first matrix lab: %s (%s)", buildRes.Code, buildRes.Message)
	}

	for i := 0; i < 8; i++ {
		core.processTick()
	}

	lab := findOwnedBuildingByType(ws, "p1", model.BuildingTypeMatrixLab)
	if lab == nil {
		t.Fatal("expected matrix_lab to be constructed")
	}
	if lab.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected first matrix_lab to run after starter wind power is online, got %s", lab.Runtime.State)
	}

	for _, techID := range []string{
		"electromagnetism",
		"basic_logistics_system",
		"automatic_metallurgy",
		"basic_assembling_processes",
		"electromagnetic_matrix",
	} {
		transferRes, _ := core.execTransferItem(ws, "p1", model.Command{
			Type: model.CmdTransferItem,
			Payload: map[string]any{
				"building_id": lab.ID,
				"item_id":     model.ItemElectromagneticMatrix,
				"quantity":    10,
			},
		})
		if transferRes.Code != model.CodeOK {
			t.Fatalf("transfer matrices for %s: %s (%s)", techID, transferRes.Code, transferRes.Message)
		}

		startRes, _ := core.execStartResearch(ws, "p1", model.Command{
			Type: model.CmdStartResearch,
			Payload: map[string]any{
				"tech_id": techID,
			},
		})
		if startRes.Code != model.CodeOK {
			t.Fatalf("start research %s: %s (%s)", techID, startRes.Code, startRes.Message)
		}

		waitForCompletedResearch(t, core, "p1", techID)
	}

	requiredBuildings := []model.BuildingType{
		model.BuildingTypeMatrixLab,
		model.BuildingTypeWindTurbine,
		model.BuildingTypeTeslaTower,
		model.BuildingTypeMiningMachine,
		model.BuildingTypeConveyorBeltMk1,
		model.BuildingTypeSorterMk1,
		model.BuildingTypeDepotMk1,
		model.BuildingTypeArcSmelter,
		model.BuildingTypeAssemblingMachineMk1,
	}
	for _, btype := range requiredBuildings {
		if !CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
			t.Fatalf("expected %s to be buildable after early research closure", btype)
		}
	}

	if player.Inventory[model.ItemElectromagneticMatrix] != 0 {
		t.Fatalf("expected bootstrap matrices to be fully consumed, got %d", player.Inventory[model.ItemElectromagneticMatrix])
	}

	if player.Tech == nil {
		t.Fatal("expected player tech state")
	}
	if player.Tech.CurrentResearch != nil {
		t.Fatalf("expected no active research after closure, got %+v", player.Tech.CurrentResearch)
	}

	for _, techID := range []string{
		"electromagnetism",
		"basic_logistics_system",
		"automatic_metallurgy",
		"basic_assembling_processes",
		"electromagnetic_matrix",
	} {
		if player.Tech.CompletedTechs[techID] == 0 {
			t.Fatalf("expected %s completed, got %+v", techID, player.Tech.CompletedTechs)
		}
	}

	if got := fmt.Sprintf("%v", lab.Production.RecipeID); got != "" {
		t.Fatalf("expected first matrix_lab to remain in research mode, got recipe %q", got)
	}
}
