package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// TestCanUseRecipeTechGating pins the systematic recipe-gating semantics:
// a recipe is usable iff it has no gate (basic recipe) or any gating tech —
// from tech unlock lists or the recipe's own TechUnlock field — is completed.
func TestCanUseRecipeTechGating(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	// 基础配方：无任何门控，新玩家直接可用。
	for _, recipeID := range []string{
		"smelt_iron", "smelt_copper", "smelt_magnet",
		"circuit_board", "magnetic_coil", "gear",
		"electromagnetic_matrix", "fuel_rod_recycling",
	} {
		if !CanUseRecipeTech(player, recipeID) {
			t.Fatalf("expected basic recipe %s usable without research", recipeID)
		}
	}

	// 门控配方：新玩家必须被拒绝，包括此前形同虚设的矩阵配方。
	gated := map[string]string{
		"smelt_stone":                      "automatic_metallurgy",
		"smelt_silicon":                    "smelting_purification",
		"smelt_titanium":                   "titanium_smelting",
		"coal_to_graphite":                 "smelting_purification",
		"motor":                            "electromagnetic_drive",
		"microcrystalline_component":       "semiconductor",
		"processor":                        "processor",
		"plastic":                          "basic_chemical",
		"graphene_from_graphite":           "superconductor",
		"graphene_from_fire_ice":           "superconductor",
		"carbon_nanotube":                  "high_strength_material",
		"crystal_silicon_from_fractal":     "crystal_smelting",
		"photon_combiner_from_grating":     "photon_conversion",
		"particle_container_from_monopole": "particle_container",
		"hydrogen_fuel_rod":                "hydrogen_fuel",
		"deuterium_fuel_rod":               "mini_fusion",
		"solar_sail":                       "solar_sail_orbit",
		"ammo_bullet":                      "weapon_system",
		"ammo_missile":                     "missile_turret",
		"energy_matrix":                    "energy_matrix",
		"structure_matrix":                 "structure_matrix",
		"information_matrix":               "information_matrix",
		"gravity_matrix":                   "gravity_matrix",
		"universe_matrix":                  "universe_matrix",
	}
	for recipeID, techID := range gated {
		if CanUseRecipeTech(player, recipeID) {
			t.Fatalf("expected recipe %s locked before %s", recipeID, techID)
		}
	}
	for recipeID, techID := range gated {
		grantTechs(ws, "p1", techID)
		if !CanUseRecipeTech(player, recipeID) {
			t.Fatalf("expected recipe %s usable after completing %s", recipeID, techID)
		}
	}

	// 边界：空 ID、未知配方、无科技状态的玩家都不能通过。
	if CanUseRecipeTech(player, "") {
		t.Fatal("empty recipe id must be rejected")
	}
	if CanUseRecipeTech(player, "not_a_recipe") {
		t.Fatal("unknown recipe id must be rejected")
	}
	if CanUseRecipeTech(&model.PlayerState{PlayerID: "ghost"}, "smelt_iron") {
		t.Fatal("player without tech state must be rejected")
	}
	if CanUseRecipeTech(nil, "smelt_iron") {
		t.Fatal("nil player must be rejected")
	}
}

func TestCatalogRecipesAreExplicitlyBasicOrGated(t *testing.T) {
	basic := map[string]bool{
		"smelt_iron": true, "smelt_copper": true, "smelt_magnet": true,
		"circuit_board": true, "magnetic_coil": true, "gear": true,
		"electromagnetic_matrix": true, "fuel_rod_recycling": true,
	}

	fresh := func() *model.PlayerState {
		return &model.PlayerState{PlayerID: "p-gate", Tech: model.NewPlayerTechState("p-gate")}
	}

	for _, recipe := range model.AllRecipes() {
		player := fresh()
		usable := CanUseRecipeTech(player, recipe.ID)
		if basic[recipe.ID] {
			if !usable {
				t.Errorf("basic recipe %s must be usable without research", recipe.ID)
			}
			continue
		}
		if usable {
			t.Errorf("non-basic recipe %s was default-allowed with no research", recipe.ID)
			continue
		}

		var gateTechs []string
		for _, def := range model.AllTechDefinitions() {
			if def == nil {
				continue
			}
			for _, unlock := range def.Unlocks {
				if unlock.Type == model.TechUnlockRecipe && unlock.ID == recipe.ID {
					gateTechs = append(gateTechs, def.ID)
				}
			}
		}
		gateTechs = append(gateTechs, recipe.TechUnlock...)
		if len(gateTechs) == 0 {
			t.Errorf("non-basic recipe %s has no tech gate", recipe.ID)
			continue
		}
		unlocked := false
		for _, techID := range gateTechs {
			holder := fresh()
			holder.Tech.CompletedTechs[techID] = 1
			if CanUseRecipeTech(holder, recipe.ID) {
				unlocked = true
				break
			}
		}
		if !unlocked {
			t.Errorf("recipe %s stayed locked after completing its gating techs %v", recipe.ID, gateTechs)
		}
	}
}

// TestBuildWithGatedMatrixRecipeRequiresResearch 验证建造设配方路径（rules.go）
// 对矩阵配方执行真实门控：未解锁 energy_matrix 科技时拒绝，解锁后放行。
func TestBuildWithGatedMatrixRecipeRequiresResearch(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	base := findOwnedBuildingByType(ws, "p1", model.BuildingTypeBattlefieldAnalysisBase)
	if base == nil {
		t.Fatal("expected p1 base building")
	}

	buildLab := func() model.CommandResult {
		pos, err := findAdjacentOpenTile(ws, base.Position)
		if err != nil || pos == nil {
			t.Fatalf("find adjacent tile: %v", err)
		}
		res, _ := core.execBuild(ws, "p1", model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: pos},
			Payload: map[string]any{
				"building_type": string(model.BuildingTypeMatrixLab),
				"recipe_id":     "energy_matrix",
			},
		})
		return res
	}

	res := buildLab()
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected energy_matrix build rejected before research, got %s (%s)", res.Code, res.Message)
	}

	grantTechs(ws, "p1", "energy_matrix")
	res = buildLab()
	if res.Code != model.CodeOK {
		t.Fatalf("expected energy_matrix build allowed after research, got %s (%s)", res.Code, res.Message)
	}
}

// TestHandcraftGatedSmeltingRecipe 验证机甲手工路径（mecha_jobs.go）
// 与建造路径共享同一门控：smelt_stone 需要 automatic_metallurgy。
func TestHandcraftGatedSmeltingRecipe(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	player.Inventory = model.ItemInventory{model.ItemStoneOre: 1}

	result, _ := core.execCraftItem(ws, "p1", handcraftCommand("smelt_stone", 1))
	if result.Code != model.CodeValidationFailed || unit.Mecha.Job != nil || player.Inventory[model.ItemStoneOre] != 1 {
		t.Fatalf("locked smelt_stone handcraft bypass: %+v", result)
	}

	player.Tech.CompletedTechs["automatic_metallurgy"] = 1
	result, _ = core.execCraftItem(ws, "p1", handcraftCommand("smelt_stone", 1))
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 50)
	if player.Inventory[model.ItemStoneBrick] != 1 {
		t.Fatal("unlocked smelt_stone handcraft did not produce stone brick")
	}
}
