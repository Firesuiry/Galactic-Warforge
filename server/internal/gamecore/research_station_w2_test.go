package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

// W2 研究站与建造体验：set_recipe / 垂直叠层 / 研究速度多级 /
// 战斗科技效果结算 / mass_construction 区域并发 / dark_fog_matrix 隐藏科技。

// --- C4a set_recipe -------------------------------------------------------

func setRecipeCmd(buildingID, recipeID string) model.Command {
	return model.Command{
		Type:    model.CmdSetRecipe,
		Target:  model.CommandTarget{EntityID: buildingID},
		Payload: map[string]any{"recipe_id": recipeID},
	}
}

func TestSetRecipeSwitchesResearchLabModes(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	lab := newBuilding("lab-sr", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	placeBuilding(ws, lab)
	if _, _, err := lab.Storage.Load("coal", 3); err != nil {
		t.Fatal(err)
	}

	// 研究模式 → 矩阵生产模式（基础配方，无科技门控）。
	res, _ := core.execSetRecipe(ws, "p1", setRecipeCmd("lab-sr", "electromagnetic_matrix"))
	if res.Code != model.CodeOK {
		t.Fatalf("set electromagnetic_matrix: %s (%s)", res.Code, res.Message)
	}
	if lab.Production == nil || lab.Production.RecipeID != "electromagnetic_matrix" {
		t.Fatalf("recipe not applied: %+v", lab.Production)
	}

	// 模拟在产进度与库存。
	lab.Production.RemainingTicks = 5
	lab.Production.ProgressFraction = 0.5
	lab.Production.PendingOutputs = []model.ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1}}

	// 未解锁的配方必须原子拒绝：配方、进度、库存全部保持原样。
	res, _ = core.execSetRecipe(ws, "p1", setRecipeCmd("lab-sr", "energy_matrix"))
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("gated energy_matrix must fail, got %s (%s)", res.Code, res.Message)
	}
	if lab.Production.RecipeID != "electromagnetic_matrix" || lab.Production.RemainingTicks != 5 {
		t.Fatalf("rejected switch mutated state: %+v", lab.Production)
	}

	// 解锁后切换成功：进度清零（DSP 语义），库存保留。
	grantTechs(ws, "p1", "energy_matrix")
	res, _ = core.execSetRecipe(ws, "p1", setRecipeCmd("lab-sr", "energy_matrix"))
	if res.Code != model.CodeOK {
		t.Fatalf("set energy_matrix after unlock: %s (%s)", res.Code, res.Message)
	}
	if lab.Production.RecipeID != "energy_matrix" {
		t.Fatalf("recipe not switched: %+v", lab.Production)
	}
	if lab.Production.RemainingTicks != 0 || lab.Production.ProgressFraction != 0 || lab.Production.PendingOutputs != nil {
		t.Fatalf("production progress not reset on switch: %+v", lab.Production)
	}
	if got := lab.Storage.OutputQuantity("coal"); got != 3 {
		t.Fatalf("storage must be kept on switch, coal = %d", got)
	}

	// 空 recipe_id 切回研究模式。
	res, _ = core.execSetRecipe(ws, "p1", setRecipeCmd("lab-sr", ""))
	if res.Code != model.CodeOK {
		t.Fatalf("clear recipe: %s (%s)", res.Code, res.Message)
	}
	if lab.Production.RecipeID != "" {
		t.Fatalf("research mode requires empty recipe, got %q", lab.Production.RecipeID)
	}
	if !isResearchLab(lab) {
		t.Fatal("lab with empty recipe must count as research mode")
	}
}

func TestSetRecipeValidationEdges(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	smelter := newBuilding("smelter-sr", model.BuildingTypeArcSmelter, "p1", model.Position{X: 8, Y: 8})
	placeBuilding(ws, smelter)
	turbine := newBuilding("turbine-sr", model.BuildingTypeWindTurbine, "p1", model.Position{X: 9, Y: 9})
	placeBuilding(ws, turbine)

	// 生产建筑基础配方切换。
	res, _ := core.execSetRecipe(ws, "p1", setRecipeCmd("smelter-sr", "smelt_iron"))
	if res.Code != model.CodeOK {
		t.Fatalf("smelter smelt_iron: %s (%s)", res.Code, res.Message)
	}
	res, _ = core.execSetRecipe(ws, "p1", setRecipeCmd("smelter-sr", "smelt_copper"))
	if res.Code != model.CodeOK {
		t.Fatalf("smelter smelt_copper: %s (%s)", res.Code, res.Message)
	}
	if smelter.Production.RecipeID != "smelt_copper" {
		t.Fatalf("smelter recipe = %q", smelter.Production.RecipeID)
	}

	// 建筑类型不支持的配方。
	res, _ = core.execSetRecipe(ws, "p1", setRecipeCmd("smelter-sr", "electromagnetic_matrix"))
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("unsupported recipe must fail, got %s", res.Code)
	}
	if smelter.Production.RecipeID != "smelt_copper" {
		t.Fatalf("rejected switch mutated smelter: %q", smelter.Production.RecipeID)
	}

	// 未知配方 / 非拥有者 / 无生产能力的建筑 / 缺失建筑。
	if res, _ := core.execSetRecipe(ws, "p1", setRecipeCmd("smelter-sr", "no_such_recipe")); res.Code != model.CodeValidationFailed {
		t.Fatalf("unknown recipe must fail, got %s", res.Code)
	}
	if res, _ := core.execSetRecipe(ws, "p2", setRecipeCmd("smelter-sr", "smelt_iron")); res.Code != model.CodeNotOwner {
		t.Fatalf("non-owner must fail with NOT_OWNER, got %s", res.Code)
	}
	if res, _ := core.execSetRecipe(ws, "p1", setRecipeCmd("turbine-sr", "smelt_iron")); res.Code != model.CodeInvalidTarget {
		t.Fatalf("non-production building must fail, got %s", res.Code)
	}
	if res, _ := core.execSetRecipe(ws, "p1", setRecipeCmd("ghost", "smelt_iron")); res.Code != model.CodeEntityNotFound {
		t.Fatalf("missing building must fail, got %s", res.Code)
	}
}

// --- C4b 垂直叠层 ----------------------------------------------------------

func TestVerticalStackedLabsShareStorageAndThroughput(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000
	grantTechs(ws, "p1", "electromagnetism", "electromagnetic_matrix_technology", "vertical_construction")
	grantAllItems(ws, "p1", 100)

	pos, err := findOpenTileNearExecutor(ws, "p1")
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	base := newBuilding("lab-stack-base", model.BuildingTypeMatrixLab, "p1", *pos)
	base.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, base)
	placeBuilding(ws, newBuilding("power-stack", model.BuildingTypeWindTurbine, "p1", model.Position{X: pos.X + 1, Y: pos.Y}))

	// 通过 build 命令在同位置叠一层。
	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeMatrixLab),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("stack build: %s (%s)", res.Code, res.Message)
	}
	var stackTask *model.ConstructionTask
	for _, task := range ws.Construction.Tasks {
		stackTask = task
	}
	if stackTask == nil || stackTask.Position.Z != 1 {
		t.Fatalf("expected stacked task at Z=1, got %+v", stackTask)
	}

	var stacked *model.Building
	for i := 0; i < 6 && stacked == nil; i++ {
		core.processTick()
		for _, b := range ws.Buildings {
			if b.Type == model.BuildingTypeMatrixLab && b.Position.Z == 1 {
				stacked = b
			}
		}
	}
	if stacked == nil {
		t.Fatal("stacked lab was not constructed")
	}
	if got := ws.TileBuilding[model.TileKey(pos.X, pos.Y)]; got != base.ID {
		t.Fatalf("tile registration must stay with the base layer, got %s", got)
	}

	// 吞吐线性叠加：两座研究站各 1/tick。
	stacked.Runtime.State = model.BuildingWorkRunning
	labs := []*model.Building{base, stacked}
	if throughput, _ := researchThroughput(player, labs, nil); throughput != 2 {
		t.Fatalf("stacked research throughput = %d, want 2", throughput)
	}

	// 库存共享：矩阵只装进底层，叠层研究消耗从底层库存扣。
	if _, _, err := base.Storage.Load(model.ItemElectromagneticMatrix, 20); err != nil {
		t.Fatal(err)
	}
	start, _ := core.execStartResearch(ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "automatic_metallurgy"},
	})
	if start.Code != model.CodeOK {
		t.Fatalf("start research: %s (%s)", start.Code, start.Message)
	}
	base.Runtime.State = model.BuildingWorkRunning
	stacked.Runtime.State = model.BuildingWorkRunning
	core.processTick()

	research := player.Tech.CurrentResearch
	if research == nil {
		t.Fatal("expected in-progress research")
	}
	if research.Progress != 2 {
		t.Fatalf("stacked labs should consume 2 matrices in one tick, progress = %d", research.Progress)
	}
	if got := base.Storage.OutputQuantity(model.ItemElectromagneticMatrix); got != 18 {
		t.Fatalf("shared base storage = %d, want 18", got)
	}
	if got := stacked.Storage.OutputQuantity(model.ItemElectromagneticMatrix); got != 0 {
		t.Fatalf("stacked layer must draw from base storage, its own storage has %d", got)
	}
}

func TestVerticalStackLimitFollowsTechLevel(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000
	grantTechs(ws, "p1", "electromagnetic_matrix_technology")
	grantAllItems(ws, "p1", 100)

	pos, err := findOpenTileNearExecutor(ws, "p1")
	if err != nil {
		t.Fatalf("find open tile: %v", err)
	}
	placeBuilding(ws, newBuilding("lab-limit-base", model.BuildingTypeMatrixLab, "p1", *pos))

	stackCmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeMatrixLab),
		},
	}

	// 未研究 vertical_construction：不允许叠层。
	res, _ := core.execBuild(ws, "p1", stackCmd)
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("stack without tech must fail with POSITION_OCCUPIED, got %s (%s)", res.Code, res.Message)
	}

	// 1 级：允许第 2 层。
	grantTechs(ws, "p1", "vertical_construction")
	res, _ = core.execBuild(ws, "p1", stackCmd)
	if res.Code != model.CodeOK {
		t.Fatalf("first stack layer with tech L1: %s (%s)", res.Code, res.Message)
	}

	// 队列中已有 1 层 → 第 3 层超出上限，拒绝。
	res, _ = core.execBuild(ws, "p1", stackCmd)
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("stack beyond tech level must fail, got %s (%s)", res.Code, res.Message)
	}

	// 不同类型建筑不能叠在矩阵站上。
	res, _ = core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeArcSmelter),
		},
	})
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("different type on occupied tile must fail, got %s (%s)", res.Code, res.Message)
	}
}

// --- C5 research_speed 多级 ------------------------------------------------

func TestResearchSpeedLevelsScaleThroughput(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]

	lab := newBuilding("lab-speed", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.Functions.Research = &model.ResearchModule{ResearchPerTick: 10}
	labs := []*model.Building{lab}

	base, _ := researchThroughput(player, labs, nil)
	if base != 10 {
		t.Fatalf("base throughput = %d, want 10", base)
	}
	player.Tech.CompletedTechs["research_speed"] = 1
	l1, _ := researchThroughput(player, labs, nil)
	if l1 != 11 {
		t.Fatalf("research_speed L1 throughput = %d, want 11 (+10%%)", l1)
	}
	player.Tech.CompletedTechs["research_speed"] = 2
	l2, _ := researchThroughput(player, labs, nil)
	if l2 != 12 {
		t.Fatalf("research_speed L2 throughput = %d, want 12 (+20%%)", l2)
	}
	player.Tech.CompletedTechs["research_speed"] = 4
	l4, _ := researchThroughput(player, labs, nil)
	if l4 != 14 {
		t.Fatalf("research_speed L4 throughput = %d, want 14 (+40%%)", l4)
	}
}

// --- C4c 战斗科技效果结算 --------------------------------------------------

func TestCombatTechEffectsReachCombatSettlement(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]

	unit := core.combatUnits.SpawnCombatUnit(ws, model.CombatUnitTypeMech, "p1", model.Position{X: 5, Y: 5}, nil)
	base := model.DefaultCombatUnitStats(model.CombatUnitTypeMech)

	core.settleCombatTech()
	if unit.Weapon.Damage != base.Weapon.Damage || unit.MaxHP != base.MaxHP {
		t.Fatalf("no tech: stats must stay at baseline, got damage=%d hp=%d", unit.Weapon.Damage, unit.MaxHP)
	}

	player.Tech.CompletedTechs["df_kinetic_weapon_damage"] = 2 // +20% 伤害
	player.Tech.CompletedTechs["df_enhanced_structure"] = 1    // +10% 耐久
	player.Tech.CompletedTechs["df_energy_shield"] = 3         // +30 护盾
	core.settleCombatTech()

	wantDamage := int(float64(base.Weapon.Damage) * 1.2)
	if unit.Weapon.Damage != wantDamage {
		t.Fatalf("weapon damage = %d, want %d (L2 kinetic)", unit.Weapon.Damage, wantDamage)
	}
	wantHP := int(float64(base.MaxHP) * 1.1)
	if unit.MaxHP != wantHP {
		t.Fatalf("max HP = %d, want %d (L1 structure)", unit.MaxHP, wantHP)
	}
	wantShield := base.Shield.MaxLevel + 30
	if unit.Shield.MaxLevel != wantShield {
		t.Fatalf("shield max = %v, want %v (L3 energy shield)", unit.Shield.MaxLevel, wantShield)
	}

	// 幂等：重复结算不叠加。
	core.settleCombatTech()
	if unit.Weapon.Damage != wantDamage || unit.MaxHP != wantHP {
		t.Fatal("combat tech settlement must rebuild from baseline, not accumulate")
	}

	// shield_capacity 同时经既有 SyncMechaCapabilities 路径增益机甲。
	mecha := &model.Unit{Type: model.UnitTypeExecutor}
	model.SyncMechaCapabilities(mecha, player)
	if mecha.Mecha == nil || mecha.Mecha.MaxShield != 30 {
		t.Fatalf("df_energy_shield must feed mecha shield via TechEffectValue, got %+v", mecha.Mecha)
	}
}

// --- mass_construction 区域并发 ---------------------------------------------

func TestMassConstructionRaisesRegionConcurrentLimit(t *testing.T) {
	core := newConstructionTestCore(t, 10, 1)
	ws := core.world
	player := ws.Players["p1"]
	// grantAllTechs 给了 1 级；先移除以便对比基线。
	delete(player.Tech.CompletedTechs, "mass_construction")

	// 找同一区域内的三个空地。
	positions := make([]model.Position, 0, 3)
	regionOf := ""
	for y := 0; y < ws.MapHeight && len(positions) < 3; y++ {
		for x := 0; x < ws.MapWidth && len(positions) < 3; x++ {
			if !ws.Grid[y][x].Terrain.Buildable() {
				continue
			}
			key := model.TileKey(x, y)
			if ws.TileBuilding[key] != "" || ws.Grid[y][x].ResourceNodeID != "" {
				continue
			}
			region := constructionRegionKey(ws, model.Position{X: x, Y: y})
			if regionOf == "" {
				regionOf = region
			}
			if region != regionOf {
				continue
			}
			positions = append(positions, model.Position{X: x, Y: y})
		}
	}
	if len(positions) < 3 {
		t.Fatalf("need 3 open tiles in one region, got %d", len(positions))
	}

	for i, pos := range positions {
		task := &model.ConstructionTask{
			ID:           fmt.Sprintf("mass-%d", i),
			PlayerID:     "p1",
			RegionID:     constructionRegionKey(ws, pos),
			BuildingType: model.BuildingTypeSolarPanel,
			Position:     pos,
			State:        model.ConstructionPending,
			EnqueueTick:  ws.Tick,
		}
		if err := ws.Construction.Enqueue(ws, task); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
	}

	countInProgress := func() int {
		n := 0
		for _, task := range ws.Construction.Tasks {
			if task.State == model.ConstructionInProgress {
				n++
			}
		}
		return n
	}

	core.settleConstructionQueue(ws)
	if got := countInProgress(); got != 1 {
		t.Fatalf("region limit 1 without tech: in-progress = %d, want 1", got)
	}

	player.Tech.CompletedTechs["mass_construction"] = 2 // 区域并发 +2
	core.settleConstructionQueue(ws)
	if got := countInProgress(); got != 3 {
		t.Fatalf("mass_construction L2: in-progress = %d, want 3", got)
	}
}

// --- dark_fog_matrix 隐藏科技 -----------------------------------------------

func TestHiddenDarkFogTechUnlocksViaLootedItem(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	grantTechs(ws, "p1", "information_matrix") // dark_fog_matrix 前置

	lab := newBuilding("lab-hidden", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research = &model.ResearchModule{ResearchPerTick: 10}
	placeBuilding(ws, lab)
	placeBuilding(ws, newBuilding("power-hidden", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6}))

	cmd := model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "dark_fog_matrix"},
	}

	// 未持有 dark_fog_matrix 物品：隐藏科技不可见，拒绝。
	res, _ := core.execStartResearch(ws, "p1", cmd)
	if res.Code == model.CodeOK {
		t.Fatal("hidden tech must reject before the trigger item is held")
	}

	// 战利品入手（直接注入研究站库存，绕过仓储容量对布景的限制）：
	// 隐藏科技变为可研究，并沿 self_evolution_lab 解锁链消耗 dark_fog_matrix。
	lab.Storage.EnsureInventory()["dark_fog_matrix"] = 60
	res, _ = core.execStartResearch(ws, "p1", cmd)
	if res.Code != model.CodeOK {
		t.Fatalf("hidden tech with trigger item: %s (%s)", res.Code, res.Message)
	}

	for i := 0; i < 10; i++ {
		lab.Runtime.State = model.BuildingWorkRunning
		core.processTick()
		if player.Tech.CompletedTechs["dark_fog_matrix"] > 0 {
			break
		}
	}
	if player.Tech.CompletedTechs["dark_fog_matrix"] == 0 {
		t.Fatalf("dark_fog_matrix research did not complete: %+v", player.Tech.CurrentResearch)
	}
	if got := lab.Storage.OutputQuantity("dark_fog_matrix"); got != 0 {
		t.Fatalf("research must consume dark_fog_matrix items, %d left", got)
	}
	if !CanBuildTech(player, model.TechUnlockBuilding, "self_evolution_lab") {
		t.Fatal("dark_fog_matrix must unlock self_evolution_lab")
	}
}
