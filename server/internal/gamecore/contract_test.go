package gamecore

import (
	"testing"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/model"
)

// 状态契约谓词词表：逐条覆盖，防止谓词改名/改口径时静默失效。
func TestEvaluateContractPredicateVocabulary(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.Tick = 1234
	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 7}
	player.Tech = model.NewPlayerTechState("p1")
	player.Tech.CompletedTechs["electromagnetism"] = 1
	// 进行中的研究：research_in_progress 表用例（table 用例共享同一份状态）。
	player.Tech.CurrentResearch = &model.PlayerResearch{TechID: "electromagnetism", State: model.ResearchInProgress}
	placeBuilding(ws, newBuilding("plant-c", model.BuildingTypeWindTurbine, "p1", model.Position{X: 20, Y: 20}))
	// 断电的风机：building_count_gte 数它，building_running_gte 不数它。
	stalled := newBuilding("plant-stalled", model.BuildingTypeWindTurbine, "p1", model.Position{X: 24, Y: 20})
	stalled.Runtime.State = model.BuildingWorkNoPower
	placeBuilding(ws, stalled)
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 21, Y: 20})
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 22, Y: 20})

	cases := []struct {
		name   string
		check  checkpoint.ContractCheck
		passed bool
		actual string
	}{
		{"tick_gte pass", checkpoint.ContractCheck{Kind: "tick_gte", Tick: 1000}, true, "1234"},
		{"tick_gte fail", checkpoint.ContractCheck{Kind: "tick_gte", Tick: 2000}, false, "1234"},
		{"tick_lt pass", checkpoint.ContractCheck{Kind: "tick_lt", Tick: 2000}, true, "1234"},
		{"tick_lt fail", checkpoint.ContractCheck{Kind: "tick_lt", Tick: 1000}, false, "1234"},
		{"game_not_finished", checkpoint.ContractCheck{Kind: "game_not_finished"}, true, "running"},
		{"player_alive", checkpoint.ContractCheck{Kind: "player_alive", Player: "p1"}, true, "true"},
		{"tech_researched pass", checkpoint.ContractCheck{Kind: "tech_researched", Player: "p1", TechID: "electromagnetism"}, true, "1"},
		{"tech_researched fail", checkpoint.ContractCheck{Kind: "tech_researched", Player: "p1", TechID: "dirac_inversion"}, false, "0"},
		{"research_in_progress pass", checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1"}, true, "electromagnetism"},
		{"research_in_progress tech match", checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1", TechID: "electromagnetism"}, true, "electromagnetism"},
		{"research_in_progress tech mismatch", checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1", TechID: "dirac_inversion"}, false, "electromagnetism"},
		{"building_count_gte pass", checkpoint.ContractCheck{Kind: "building_count_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 2}, true, "2"},
		{"building_count_gte counts stalled", checkpoint.ContractCheck{Kind: "building_count_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 3}, false, "2"},
		{"building_running_gte pass", checkpoint.ContractCheck{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 1}, true, "1"},
		{"building_running_gte skips no_power", checkpoint.ContractCheck{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 2}, false, "1"},
		{"unit_count_gte pass", checkpoint.ContractCheck{Kind: "unit_count_gte", Player: "p1", Type: string(model.UnitTypeSoldier), N: 2}, true, "2"},
		{"unit_count_gte fail", checkpoint.ContractCheck{Kind: "unit_count_gte", Player: "p1", Type: string(model.UnitTypeSoldier), N: 3}, false, "2"},
		{"item_gte pass", checkpoint.ContractCheck{Kind: "item_gte", Player: "p1", ItemID: string(model.ItemIronIngot), N: 7}, true, "7"},
		{"item_gte fail", checkpoint.ContractCheck{Kind: "item_gte", Player: "p1", ItemID: string(model.ItemIronIngot), N: 8}, false, "7"},
		{"dark_fog_hostile false", checkpoint.ContractCheck{Kind: "dark_fog_hostile", Player: "p1", Boolean: false}, true, "false"},
		{"dark_fog_hostile true", checkpoint.ContractCheck{Kind: "dark_fog_hostile", Player: "p1", Boolean: true}, false, "false"},
		{"enemy_attack_seen false", checkpoint.ContractCheck{Kind: "enemy_attack_seen", Player: "p1", Boolean: false}, true, "false"},
		{"enemy_attack_seen true", checkpoint.ContractCheck{Kind: "enemy_attack_seen", Player: "p1", Boolean: true}, false, "false"},
		{"unknown predicate", checkpoint.ContractCheck{Kind: "nope"}, false, "(unknown)"},
		{"missing player", checkpoint.ContractCheck{Kind: "player_alive", Player: "ghost"}, false, "(none)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{tc.check}}).Results[0]
			if result.Passed != tc.passed {
				t.Fatalf("passed=%v want %v (%+v)", result.Passed, tc.passed, result)
			}
			if result.Actual != tc.actual {
				t.Fatalf("actual=%q want %q", result.Actual, tc.actual)
			}
		})
	}
}

// research_in_progress：无进行中研究 → fail("false")；有 → pass(tech_id)，
// 指定 tech_id 时还要求正在研究的就是它（actual 写实际值）。
func TestResearchInProgressPredicate(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	player := ws.Players["p1"]
	player.Tech = model.NewPlayerTechState("p1")

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}

	if result := eval(checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1"}); result.Passed || result.Actual != "false" {
		t.Fatalf("no active research must fail with actual=false, got %+v", result)
	}

	player.Tech.CurrentResearch = &model.PlayerResearch{TechID: "electromagnetism", State: model.ResearchInProgress}
	if result := eval(checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1"}); !result.Passed || result.Actual != "electromagnetism" {
		t.Fatalf("active research must pass with actual=tech_id, got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1", TechID: "electromagnetism"}); !result.Passed {
		t.Fatalf("matching tech_id must pass, got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1", TechID: "dirac_inversion"}); result.Passed || result.Actual != "electromagnetism" {
		t.Fatalf("mismatching tech_id must fail with the actual tech_id, got %+v", result)
	}

	// 非 in_progress 状态不算「进行中」。
	player.Tech.CurrentResearch.State = model.ResearchPending
	if result := eval(checkpoint.ContractCheck{Kind: "research_in_progress", Player: "p1"}); result.Passed {
		t.Fatalf("pending research must not count as in progress, got %+v", result)
	}

	// 未指定 player 时任一玩家满足即通过（"或"语义）：p1 没有进行中研究、p2 有 → 通过，
	// actual 写的是满足条件的那个玩家的 tech_id（不能因为 p1 空手就判 false）。
	other := newBlackFogTestCore(t, "normal")
	otherWs := other.World()
	otherWs.Players["p1"].Tech = model.NewPlayerTechState("p1")
	otherWs.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true, Tech: model.NewPlayerTechState("p2")}
	otherWs.Players["p2"].Tech.CurrentResearch = &model.PlayerResearch{TechID: "electromagnetism", State: model.ResearchInProgress}
	report := other.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{{Kind: "research_in_progress"}}})
	if !report.Passed || report.Results[0].Actual != "electromagnetism" {
		t.Fatalf("任一玩家有进行中研究即应通过，report=%+v", report)
	}
}

// 未指定 player 时任一玩家满足即通过（"或"语义）。
func TestEvaluateContractWithoutPlayerMatchesAnyPlayer(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	ws.Players["p1"].IsAlive = false
	report := core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{{Kind: "player_alive"}}})
	if !report.Passed {
		t.Fatalf("p2 存活即应通过，report=%+v", report)
	}
}

// 黑雾击杀玩家单位不算"被敌方玩家攻击"：只有敌方玩家造成战损才为真。
func TestEnemyAttackSeenIgnoresDarkFogAttacks(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true, Stats: model.NewPlayerStats("p2")}
	ws.Players["p1"].Stats = model.NewPlayerStats("p1")

	// 黑雾（非玩家）击杀 p1 单位：p1 有战损，但没有任何玩家有战果。
	recordCombatUnitKill(ws, "p1", model.DarkFogOwnerID)
	if enemyAttackSeen(ws.Players["p1"], core.opponentKills("p1")) {
		t.Fatal("黑雾偷袭不得判定为被敌方玩家攻击")
	}

	// 敌方玩家 p2 击杀 p1 单位：双边计数成立。
	recordCombatUnitKill(ws, "p1", "p2")
	if !enemyAttackSeen(ws.Players["p1"], core.opponentKills("p1")) {
		t.Fatal("敌方玩家击杀应判定为被攻击")
	}
}

// research_progress_gte：只有真在推进（进度 > 0）才通过；卡在 waiting_matrix 时
// 进度停在 0，这条谓词就是「研究确实在跑」的可执行断言（cp-research-start 用）。
func TestResearchProgressPredicate(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	player := ws.Players["p1"]
	player.Tech = model.NewPlayerTechState("p1")

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}

	check := checkpoint.ContractCheck{Kind: "research_progress_gte", Player: "p1", TechID: "electromagnetism", N: 1}
	if result := eval(check); result.Passed || result.Actual != "0" {
		t.Fatalf("没有进行中的研究必须失败，got %+v", result)
	}

	player.Tech.CurrentResearch = &model.PlayerResearch{TechID: "electromagnetism", State: model.ResearchInProgress, Progress: 3, BlockedReason: "waiting_matrix"}
	if result := eval(check); !result.Passed || result.Actual != "3" {
		t.Fatalf("进度 3 >= 1 应通过，got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "research_progress_gte", Player: "p1", N: 4}); result.Passed {
		t.Fatalf("进度 3 < 4 应失败，got %+v", result)
	}
	// 指定了 tech_id 时要求正在研究的就是它。
	if result := eval(checkpoint.ContractCheck{Kind: "research_progress_gte", Player: "p1", TechID: "dirac_inversion", N: 1}); result.Passed || result.Actual != "3" {
		t.Fatalf("研究的是别的科技应失败并报实际进度，got %+v", result)
	}
}

// building_item_gte：数的是「玩家该类建筑库存里」的物品（主库存 + 输入/输出缓冲），
// 用来断言「产线真的把货送进了那台机器」。
func TestBuildingItemPredicate(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	player := ws.Players["p1"]

	lab := newBuilding("lab-item", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	placeBuilding(ws, lab)
	lab.Storage.EnsureInventory()[model.ItemElectromagneticMatrix] = 2
	lab.Storage.EnsureOutputBuffer()[model.ItemElectromagneticMatrix] = 3

	// 背包里的矩阵不算数：谓词只看建筑库存。
	player.Inventory = model.ItemInventory{model.ItemElectromagneticMatrix: 99}

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}
	check := checkpoint.ContractCheck{Kind: "building_item_gte", Player: "p1", Type: string(model.BuildingTypeMatrixLab), ItemID: string(model.ItemElectromagneticMatrix), N: 5}
	if result := eval(check); !result.Passed || result.Actual != "5" {
		t.Fatalf("研究站库存 2+3=5 应通过，got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "building_item_gte", Player: "p1", Type: string(model.BuildingTypeMatrixLab), ItemID: string(model.ItemElectromagneticMatrix), N: 6}); result.Passed {
		t.Fatalf("要求 6 应失败，got %+v", result)
	}
	// 建筑类型不匹配时不计入（另一台制造台里的矩阵不算研究站的）。
	other := newBuilding("asm-item", model.BuildingTypeAssemblingMachineMk1, "p1", model.Position{X: 20, Y: 20})
	placeBuilding(ws, other)
	other.Storage.EnsureInventory()[model.ItemElectromagneticMatrix] = 40
	if result := eval(check); !result.Passed || result.Actual != "5" {
		t.Fatalf("只应数研究站里的矩阵，got %+v", result)
	}
}

// no_alert_since：自给定 tick 起没有该类生产告警才通过（type 可选，只看该建筑类型）。
func TestNoAlertSincePredicate(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	belt := newBuilding("belt-alert", model.BuildingTypeConveyorBeltMk1, "p1", model.Position{X: 6, Y: 6})
	placeBuilding(ws, belt)
	core.AlertHistory().Record([]*model.ProductionAlert{{
		AlertID: "alert-300-belt-alert-belt_blocked", Tick: 300, PlayerID: "p1",
		BuildingID: belt.ID, BuildingType: belt.Type, AlertType: model.AlertTypeBeltBlocked,
	}})

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}
	if result := eval(checkpoint.ContractCheck{Kind: "no_alert_since", AlertType: string(model.AlertTypeBeltBlocked), Tick: 300}); result.Passed || result.Actual != "1" {
		t.Fatalf("tick 300 起的告警应被数到并判失败，got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "no_alert_since", AlertType: string(model.AlertTypeBeltBlocked), Tick: 301}); !result.Passed || result.Actual != "0" {
		t.Fatalf("tick 301 之后应无告警，got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "no_alert_since", AlertType: string(model.AlertTypeInputShortage), Tick: 0}); !result.Passed {
		t.Fatalf("别的告警类型不应影响，got %+v", result)
	}
	if result := eval(checkpoint.ContractCheck{Kind: "no_alert_since", AlertType: string(model.AlertTypeBeltBlocked), Type: string(model.BuildingTypeMatrixLab), Tick: 0}); !result.Passed {
		t.Fatalf("限定建筑类型后不该命中传送带的告警，got %+v", result)
	}
}
