package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestPlanetaryProductionRecipesSettleFromBuildCommand(t *testing.T) {
	cases := []struct {
		name     string
		techs    []string
		building model.BuildingType
		recipeID string
	}{
		{"smelter_steel", []string{"steel_smelting"}, model.BuildingTypeArcSmelter, "steel"},
		{"assembler_proliferator_mk1", []string{"proliferator_mk1"}, model.BuildingTypeAssemblingMachineMk1, "proliferator_mk1"},
		{"refinery_oil_fractionation", []string{"plasma_refining"}, model.BuildingTypeOilRefinery, "oil_fractionation"},
		{"lab_electromagnetic_matrix", nil, model.BuildingTypeMatrixLab, "electromagnetic_matrix"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recipe, ok := model.Recipe(tc.recipeID)
			if !ok {
				t.Fatalf("missing recipe %s", tc.recipeID)
			}

			core := newE2ETestCore(t)
			ws := core.World()
			player := ws.Players["p1"]
			if player == nil {
				t.Fatal("expected player p1")
			}
			player.Resources.Minerals = 10000
			player.Resources.Energy = 10000
			grantTechs(ws, "p1", tc.techs...)
			grantAllItems(ws, "p1", 100)

			prodPos, powerPos := findAdjacentBuildPair(t, ws, "p1")

			powerRes, _ := core.execBuild(ws, "p1", model.Command{
				Type:   model.CmdBuild,
				Target: model.CommandTarget{Position: powerPos},
				Payload: map[string]any{
					"building_type": string(model.BuildingTypeWindTurbine),
				},
			})
			if powerRes.Code != model.CodeOK {
				t.Fatalf("build wind turbine: %s (%s)", powerRes.Code, powerRes.Message)
			}

			buildRes, _ := core.execBuild(ws, "p1", model.Command{
				Type:   model.CmdBuild,
				Target: model.CommandTarget{Position: prodPos},
				Payload: map[string]any{
					"building_type": string(tc.building),
					"recipe_id":     tc.recipeID,
				},
			})
			if buildRes.Code != model.CodeOK {
				t.Fatalf("build %s with %s: %s (%s)", tc.building, tc.recipeID, buildRes.Code, buildRes.Message)
			}

			var building *model.Building
			for i := 0; i < 24 && building == nil; i++ {
				core.processTick()
				id := ws.TileBuilding[model.TileKey(prodPos.X, prodPos.Y)]
				candidate := ws.Buildings[id]
				if candidate != nil && candidate.Type == tc.building && candidate.Production != nil && candidate.Storage != nil {
					building = candidate
				}
			}
			if building == nil {
				t.Fatal("production building did not finish construction")
			}
			if building.Production.RecipeID != tc.recipeID {
				t.Fatalf("recipe %s not applied, got %q", tc.recipeID, building.Production.RecipeID)
			}

			beforeInputs := map[string]int{}
			for _, input := range recipe.Inputs {
				if _, _, err := building.Storage.Receive(input.ItemID, input.Quantity); err != nil {
					if _, _, loadErr := building.Storage.Load(input.ItemID, input.Quantity); loadErr != nil {
						t.Fatalf("prime input %s: receive=%v load=%v", input.ItemID, err, loadErr)
					}
				}
				beforeInputs[input.ItemID] = storageItemQuantity(building, input.ItemID)
				if beforeInputs[input.ItemID] < input.Quantity {
					t.Fatalf("input %s not stored: have %d want %d", input.ItemID, beforeInputs[input.ItemID], input.Quantity)
				}
			}
			beforeOutputs := map[string]int{}
			for _, output := range recipe.AllOutputs() {
				beforeOutputs[output.ItemID] = building.Storage.OutputQuantity(output.ItemID)
			}

			deadline := recipe.Duration*4 + 40
			if deadline < 80 {
				deadline = 80
			}
			produced := false
			for i := 0; i < deadline; i++ {
				core.processTick()
				ok := true
				for _, output := range recipe.AllOutputs() {
					if building.Storage.OutputQuantity(output.ItemID) < beforeOutputs[output.ItemID]+output.Quantity {
						ok = false
						break
					}
				}
				if ok {
					produced = true
					break
				}
			}
			if !produced {
				t.Fatalf("recipe %s did not settle: state=%s reason=%s storage=%+v remaining=%d",
					tc.recipeID, building.Runtime.State, building.Runtime.StateReason, building.Storage, building.Production.RemainingTicks)
			}
			for _, input := range recipe.Inputs {
				got := storageItemQuantity(building, input.ItemID)
				if got >= beforeInputs[input.ItemID] {
					t.Fatalf("input %s did not decrease: before=%d after=%d", input.ItemID, beforeInputs[input.ItemID], got)
				}
			}
			for _, output := range recipe.AllOutputs() {
				got := building.Storage.OutputQuantity(output.ItemID)
				if got < beforeOutputs[output.ItemID]+output.Quantity {
					t.Fatalf("output %s=%d want at least %d", output.ItemID, got, beforeOutputs[output.ItemID]+output.Quantity)
				}
			}
		})
	}
}

func findAdjacentBuildPair(t *testing.T, ws *model.WorldState, playerID string) (*model.Position, *model.Position) {
	t.Helper()
	player := ws.Players[playerID]
	if player == nil {
		t.Fatal("missing player")
	}
	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		t.Fatal("missing executor")
	}
	executor := ws.Units[execState.UnitID]
	if executor == nil {
		t.Fatal("missing executor unit")
	}

	pos, _ := findOpenTile(ws, 2)
	if pos != nil {
		if powerPos, _ := findAdjacentOpenTile(ws, *pos); powerPos != nil {
			return pos, powerPos
		}
	}
	for _, candidate := range ws.SurfaceDisc(executor.Position, execState.OperateRange) {
		if !t103IsOpenBuildTile(ws, candidate) {
			continue
		}
		neighbor, _ := findAdjacentOpenTile(ws, candidate)
		if neighbor != nil && ws.SurfaceWithin(executor.Position, *neighbor, execState.OperateRange) {
			p := candidate
			return &p, neighbor
		}
	}
	t.Fatal("no reachable adjacent pair for production")
	return nil, nil
}

func storageItemQuantity(building *model.Building, itemID string) int {
	if building == nil || building.Storage == nil {
		return 0
	}
	total := building.Storage.OutputQuantity(itemID)
	if building.Storage.Inventory != nil {
		total += building.Storage.Inventory[itemID]
	}
	if building.Storage.InputBuffer != nil {
		total += building.Storage.InputBuffer[itemID]
	}
	return total
}
