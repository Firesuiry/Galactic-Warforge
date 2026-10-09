package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestResearchCompletesPlanetaryTechAndUnlocksRecipe(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000
	grantTechs(ws, "p1", "electromagnetism", "automatic_metallurgy")
	grantAllItems(ws, "p1", 100)

	if CanUseRecipeTech(player, "high_purity_silicon") {
		t.Fatal("high_purity_silicon must stay locked before smelting_purification")
	}

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find smelter tile: %v", err)
	}
	locked := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeArcSmelter),
			"recipe_id":     "high_purity_silicon",
		},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", locked)
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected locked high_purity_silicon build to fail, got %s (%s)", res.Code, res.Message)
	}

	lab := newBuilding("lab-planetary", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	if _, _, err := lab.Storage.Load(model.ItemElectromagneticMatrix, 30); err != nil {
		t.Fatalf("load research matrices: %v", err)
	}
	placeBuilding(ws, lab)
	placeBuilding(ws, newBuilding("power-planetary", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6}))

	beforeMatrices := lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
	if beforeMatrices < 30 {
		t.Fatalf("expected 30 matrices in lab, got %d", beforeMatrices)
	}

	start, _ := execCommand(core, model.CmdStartResearch, ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "smelting_purification"},
	})
	if start.Code != model.CodeOK {
		t.Fatalf("start smelting_purification: %s (%s)", start.Code, start.Message)
	}

	for i := 0; i < 40; i++ {
		lab.Runtime.State = model.BuildingWorkRunning
		core.processTick()
		if player.Tech != nil && player.Tech.CompletedTechs["smelting_purification"] > 0 {
			break
		}
	}
	if player.Tech == nil || player.Tech.CompletedTechs["smelting_purification"] == 0 {
		t.Fatalf("smelting_purification did not complete: %+v", player.Tech)
	}
	afterMatrices := lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
	if afterMatrices >= beforeMatrices {
		t.Fatalf("research did not consume matrices: before=%d after=%d", beforeMatrices, afterMatrices)
	}
	if !CanUseRecipeTech(player, "high_purity_silicon") {
		t.Fatal("high_purity_silicon still locked after smelting_purification")
	}

	unlocked, _ := execCommand(core, model.CmdBuild, ws, "p1", locked)
	if unlocked.Code != model.CodeOK {
		t.Fatalf("expected high_purity_silicon build after research, got %s (%s)", unlocked.Code, unlocked.Message)
	}

	// Production/research-related tech effects must be read by settlement, not
	// only stored on the completed-tech flag.
	labs := []*model.Building{lab}
	beforeSpeed, _ := researchThroughput(player, labs, nil)
	player.Tech.CompletedTechs["research_speed"] = 1
	if model.TechEffectValue(player, "research_speed") <= 0 {
		t.Fatal("research_speed effect was not readable after completion")
	}
	afterSpeed, _ := researchThroughput(player, labs, nil)
	if afterSpeed <= beforeSpeed {
		t.Fatalf("research_speed effect not applied by settlement: before=%d after=%d", beforeSpeed, afterSpeed)
	}
}
