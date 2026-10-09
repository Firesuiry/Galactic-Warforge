package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 熔炉/制造台建成后必须能用 set_recipe 原地改配方（试玩报告新问题 #6：
// 建成后详情面板只有只读配方，为了设配方要先拆除重建）。
// 本用例走真实链路：建造 → 施工完成 → 改配方 → 再改回来。
func TestSetRecipeAfterConstructionOnSmelterAndAssembler(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_collection", "basic_assembling_processes")
	grantAllItems(ws, "p1", 200)
	player := ws.Players["p1"]
	player.Resources.Minerals = 5000
	player.Resources.Energy = 5000

	buildAndComplete := func(btype model.BuildingType, recipeID string) *model.Building {
		t.Helper()
		base := findOwnedBuildingByType(ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
		if base == nil {
			t.Fatal("expected p1 base")
		}
		pos, err := findAdjacentOpenTile(ws, base.Position)
		if err != nil || pos == nil {
			t.Fatalf("find build tile: %v", err)
		}
		payload := map[string]any{"building_type": string(btype)}
		if recipeID != "" {
			payload["recipe_id"] = recipeID
		}
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
			Type:    model.CmdBuild,
			Target:  model.CommandTarget{Position: pos},
			Payload: payload,
		})
		if res.Code != model.CodeOK {
			t.Fatalf("build %s: %s (%s)", btype, res.Code, res.Message)
		}
		before := len(ws.Buildings)
		t103ProcessTicks(core, 8)
		if len(ws.Buildings) != before+1 {
			t.Fatalf("build %s did not complete (buildings %d -> %d)", btype, before, len(ws.Buildings))
		}
		building := findOwnedBuildingByType(ws, "p1", btype)
		if building == nil {
			t.Fatalf("expected %s after construction", btype)
		}
		return building
	}

	// 熔炉：建造时选「铁块」，建成后改成「铜块」，再改回。
	smelter := buildAndComplete(model.BuildingTypeArcSmelter, "smelt_iron")
	if smelter.Production == nil || smelter.Production.RecipeID != "smelt_iron" {
		t.Fatalf("smelter recipe after build = %+v", smelter.Production)
	}
	res, _ := execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(smelter.ID, "smelt_copper"))
	if res.Code != model.CodeOK {
		t.Fatalf("set smelter smelt_copper: %s (%s)", res.Code, res.Message)
	}
	if smelter.Production.RecipeID != "smelt_copper" {
		t.Fatalf("smelter recipe = %q, want smelt_copper", smelter.Production.RecipeID)
	}
	if res.Message == "" || !containsChinese(res.Message) {
		t.Fatalf("switch receipt must be Chinese, got %q", res.Message)
	}
	res, _ = execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(smelter.ID, "smelt_iron"))
	if res.Code != model.CodeOK || smelter.Production.RecipeID != "smelt_iron" {
		t.Fatalf("switch back failed: %s (%s) recipe=%q", res.Code, res.Message, smelter.Production.RecipeID)
	}

	// 制造台：建成后改成电磁矩阵，再清空配方转空闲。
	assembler := buildAndComplete(model.BuildingTypeAssemblingMachineMk1, "")
	res, _ = execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(assembler.ID, "electromagnetic_matrix"))
	if res.Code != model.CodeOK {
		t.Fatalf("set assembler electromagnetic_matrix: %s (%s)", res.Code, res.Message)
	}
	if assembler.Production.RecipeID != "electromagnetic_matrix" {
		t.Fatalf("assembler recipe = %q", assembler.Production.RecipeID)
	}
	res, _ = execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(assembler.ID, ""))
	if res.Code != model.CodeOK || assembler.Production.RecipeID != "" {
		t.Fatalf("clear assembler recipe failed: %s (%s) recipe=%q", res.Code, res.Message, assembler.Production.RecipeID)
	}

	// 切换时进度清零、库存保留。
	assembler.Storage.Inventory = model.ItemInventory{"circuit_board": 5}
	assembler.Production.RecipeID = "gear"
	assembler.Production.RemainingTicks = 9
	assembler.Production.ProgressFraction = 0.5
	assembler.Production.PendingOutputs = []model.ItemAmount{{ItemID: "gear", Quantity: 1}}
	res, _ = execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(assembler.ID, "electromagnetic_matrix"))
	if res.Code != model.CodeOK {
		t.Fatalf("switch with progress: %s (%s)", res.Code, res.Message)
	}
	if assembler.Production.RemainingTicks != 0 || assembler.Production.ProgressFraction != 0 || assembler.Production.PendingOutputs != nil {
		t.Fatalf("progress must reset on switch: %+v", assembler.Production)
	}
	if assembler.Storage.Inventory["circuit_board"] != 5 {
		t.Fatalf("storage must be kept on switch: %+v", assembler.Storage.Inventory)
	}

	// 失败回执：未知配方 / 不支持的配方 / 未解锁配方，且原子拒绝（不改动现有配方）。
	before := assembler.Production.RecipeID
	if res, _ := execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(assembler.ID, "no_such_recipe")); res.Code != model.CodeValidationFailed {
		t.Fatalf("unknown recipe must fail, got %s", res.Code)
	}
	if res, _ := execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(assembler.ID, "smelt_iron")); res.Code != model.CodeValidationFailed {
		t.Fatalf("unsupported recipe must fail, got %s", res.Code)
	}
	if res, _ := execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(assembler.ID, "energy_matrix")); res.Code != model.CodeValidationFailed {
		t.Fatalf("locked recipe must fail, got %s", res.Code)
	}
	if assembler.Production.RecipeID != before {
		t.Fatalf("rejected switch mutated the recipe: %q -> %q", before, assembler.Production.RecipeID)
	}
}
