package gamecore

import (
	"fmt"
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

// dark_fog_calmed：自 tick 起该玩家出现过 dark_fog_calmed 事件才通过。
// 「恢复中立」本身用 dark_fog_hostile=false 只能证明此刻不敌对，证明不了冷静期
// 真的到期结算过（读档前就没敌对也满足），所以 tc07-calmed 同时断言这条。
func TestDarkFogCalmedPredicate(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}
	calmed := checkpoint.ContractCheck{Kind: "dark_fog_calmed", Player: "p1", Tick: 700}

	if result := eval(calmed); result.Passed || result.Actual != "0" {
		t.Fatalf("没有事件时必须失败，got %+v", result)
	}

	// 别家玩家的冷静事件不算：p2 恢复中立不能让 p1 的契约通过。
	core.EventHistory().Record([]*model.GameEvent{{
		EventID: "evt-699-1", Tick: 699, EventType: model.EvtDarkFogCalmed,
		Payload: map[string]any{"player_id": "p2"},
	}})
	if result := eval(calmed); result.Passed {
		t.Fatalf("别家玩家的 dark_fog_calmed 不该算，got %+v", result)
	}

	// 早于起始 tick 的事件不算。
	core.EventHistory().Record([]*model.GameEvent{{
		EventID: "evt-690-1", Tick: 690, EventType: model.EvtDarkFogCalmed,
		Payload: map[string]any{"player_id": "p1"},
	}})
	if result := eval(calmed); result.Passed {
		t.Fatalf("tick 690 < 700 的事件不该算，got %+v", result)
	}

	core.EventHistory().Record([]*model.GameEvent{{
		EventID: "evt-70211-1", Tick: 70211, EventType: model.EvtDarkFogCalmed,
		Payload: map[string]any{"player_id": "p1"},
	}})
	if result := eval(calmed); !result.Passed || result.Actual != "1" {
		t.Fatalf("tick 70211 的 p1 冷静事件应通过，got %+v", result)
	}

	// 与 dark_fog_hostile 组合：恢复中立 + 事件在 = 整条「冷静到期」断言。
	player := ws.Players["p1"]
	player.DarkFog = model.DarkFogRelation{}
	report := core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{
		{Kind: "dark_fog_hostile", Player: "p1", Boolean: false},
		{Kind: "dark_fog_calmed", Player: "p1", Tick: 700},
	}})
	if !report.Passed {
		t.Fatalf("恢复中立且事件在应通过，report=%+v", report)
	}
}

// unit_near：按落点 + 半径数存活单位。用来断言「军团真的开到了巢穴外」——
// unit_count_gte 在单位还蹲在基地时也通过（cp-near-hive 的 move 被拒也满足 ≥6）。
func TestUnitNearPredicate(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	nest := model.Position{X: 30, Y: 30}
	for i := 0; i < 3; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 30 + i, Y: 30})
	}
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 31, Y: 31})
	// 远处的兵（基地里）不算进巢穴半径。
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	// 别的玩家的兵不算。
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 30, Y: 31})

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}
	check := checkpoint.ContractCheck{Kind: "unit_near", Player: "p1", Position: &nest, Radius: 2, Type: string(model.UnitTypeSoldier), N: 4}
	if result := eval(check); !result.Passed || result.Actual != "4" {
		t.Fatalf("半径 2 内应有 4 个 p1 步兵，got %+v", result)
	}
	check.N = 5
	if result := eval(check); result.Passed {
		t.Fatalf("半径 2 内只有 4 个，要求 5 应失败，got %+v", result)
	}
	// 半径 1 只覆盖 (30,30)(31,30) 与 (30,31)？——按 cube-sphere 图距逐格判定，
	// 这里只断言「半径变小不会数到更多」。
	near := check
	near.N, near.Radius = 1, 0
	if result := eval(near); result.Actual == "4" {
		t.Fatalf("半径 0 不应数到 4 个（只应数落在该格上的），got %+v", result)
	}
	// type 为空时数所有单位。
	spawnWorldTestUnit(ws, model.UnitTypeExecutor, "p1", model.Position{X: 30, Y: 30})
	all := checkpoint.ContractCheck{Kind: "unit_near", Player: "p1", Position: &nest, Radius: 2, N: 5}
	if result := eval(all); !result.Passed {
		t.Fatalf("不限定类型时应数到 5 个（4 步兵 + 1 机甲），got %+v", result)
	}
	// 缺 position 时报错，不能静默通过。
	if result := eval(checkpoint.ContractCheck{Kind: "unit_near", Player: "p1", Radius: 2, N: 1}); result.Passed {
		t.Fatalf("缺 position 必须失败，got %+v", result)
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

// 按落点定位建筑的谓词：building_item_at_gte / building_item_at_lt /
// building_no_alert_since。建筑 ID 是运行时分配的，契约要能按「建造落点」断言
// （分拣器送到的仓储非空、紧贴传送带但没分拣器的仓储必须空着、带尾没被堵住）。
func TestBuildingPositionPredicates(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	player := ws.Players["p1"]

	depot := newBuilding("depot-1", model.BuildingTypeDepotMk1, "p1", model.Position{X: 30, Y: 30})
	if _, _, err := depot.Storage.Load(model.ItemIronIngot, 5); err != nil {
		t.Fatalf("装货: %v", err)
	}
	placeBuilding(ws, depot)
	// 同落点但属于别人的建筑：不能算作该玩家的建筑。
	other := newBuilding("depot-2", model.BuildingTypeDepotMk1, "p2", model.Position{X: 40, Y: 40})
	placeBuilding(ws, other)

	eval := func(check checkpoint.ContractCheck) checkpoint.ContractResult {
		return core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{check}}).Results[0]
	}
	at := func(kind, item string, n int, x, y int) checkpoint.ContractCheck {
		return checkpoint.ContractCheck{Kind: kind, Player: "p1", ItemID: item, N: n,
			Position: &model.Position{X: x, Y: y}}
	}

	if r := eval(at("building_item_at_gte", string(model.ItemIronIngot), 5, 30, 30)); !r.Passed || r.Actual != "5" {
		t.Fatalf("落点仓储里的铁块应 >= 5，got %+v", r)
	}
	if r := eval(at("building_item_at_gte", string(model.ItemIronIngot), 6, 30, 30)); r.Passed {
		t.Fatalf("铁块只有 5 个，>= 6 必须失败，got %+v", r)
	}
	// 直接 IO 已移除：紧贴传送带、没配分拣器的仓储必须一直是空的。
	if r := eval(at("building_item_at_lt", string(model.ItemIronIngot), 1, 30, 30)); r.Passed {
		t.Fatalf("铁块 5 个时 < 1 必须失败，got %+v", r)
	}
	if r := eval(at("building_item_at_lt", string(model.ItemCopperOre), 1, 30, 30)); !r.Passed {
		t.Fatalf("空物品的 < 1 必须通过，got %+v", r)
	}
	// 别人家的建筑：按落点找不到该玩家的建筑。
	if r := eval(at("building_item_at_gte", string(model.ItemIronIngot), 0, 40, 40)); r.Passed || r.Actual != "(none)" {
		t.Fatalf("p2 的建筑不算 p1 的，got %+v", r)
	}
	// 空落点 / 缺 position。
	if r := eval(at("building_item_at_gte", string(model.ItemIronIngot), 0, 50, 50)); r.Passed || r.Actual != "(none)" {
		t.Fatalf("空落点必须失败，got %+v", r)
	}
	if r := eval(checkpoint.ContractCheck{Kind: "building_item_at_gte", Player: "p1"}); r.Passed ||
		r.Detail != "该谓词需要 position（建筑锚点格）" {
		t.Fatalf("缺 position 必须报明确原因，got %+v", r)
	}

	// building_no_alert_since：只看该建筑、该类型、且 tick >= 起点 的告警。
	record := func(buildingID string, atTick int64, alertType model.ProductionAlertType) {
		core.AlertHistory().Record([]*model.ProductionAlert{{
			AlertID: fmt.Sprintf("a-%s-%d", buildingID, atTick), Tick: atTick, Active: true, PlayerID: "p1",
			BuildingID: buildingID, BuildingType: model.BuildingTypeConveyorBeltMk1,
			AlertType: alertType, Severity: model.AlertSeverityWarning,
		}})
	}
	noAlert := func(x, y int, alertType string, sinceTick int64) checkpoint.ContractResult {
		return eval(checkpoint.ContractCheck{Kind: "building_no_alert_since", Player: "p1",
			AlertType: alertType, Tick: sinceTick, Position: &model.Position{X: x, Y: y}})
	}
	if r := noAlert(30, 30, "belt_blocked", 0); !r.Passed || r.Actual != "0" {
		t.Fatalf("没有告警时应通过，got %+v", r)
	}
	record("depot-1", 100, model.AlertTypeBeltBlocked)
	record("depot-1", 200, model.AlertTypeThroughputDrop)
	record("depot-2", 300, model.AlertTypeBeltBlocked) // 别人的建筑，不该算
	if r := noAlert(30, 30, "belt_blocked", 0); r.Passed || r.Actual != "1" {
		t.Fatalf("tick 100 的 belt_blocked 应让该落点失败，got %+v", r)
	}
	if r := noAlert(30, 30, "belt_blocked", 150); !r.Passed {
		t.Fatalf("tick 150 之后没有 belt_blocked，应通过，got %+v", r)
	}
	if r := noAlert(30, 30, "", 0); r.Passed || r.Actual != "2" {
		t.Fatalf("alert_type 为空时数全部类型（2 条），got %+v", r)
	}
	if r := noAlert(30, 30, "power_shortage", 0); !r.Passed {
		t.Fatalf("别的告警类型不影响，got %+v", r)
	}

	// 已解除的老告警不算「现在还堵着」：告警条目按 (行星,建筑,类型) 复用，
	// 首次出现 tick 不会被改写；如果按首次 tick 判，产线配齐前堵过一次就会让
	// 契约永远失败（试玩 1016 报告问题 1 的 cp-logistics：belt_blocked 首次
	// 14588、15079 解除，之后一直通畅）。
	core.AlertHistory().Resolve("p1", "", "depot-1", model.AlertTypeBeltBlocked, 500)
	if r := noAlert(30, 30, "belt_blocked", 0); !r.Passed || r.Actual != "0" {
		t.Fatalf("已解除的 belt_blocked 不该再让契约失败，got %+v", r)
	}
	// 同一建筑再次出现同类告警（Record 复用条目、恢复 active）后仍要能抓到。
	record("depot-1", 600, model.AlertTypeBeltBlocked)
	if r := noAlert(30, 30, "belt_blocked", 0); r.Passed || r.Actual != "1" {
		t.Fatalf("重新出现的告警必须重新判失败，got %+v", r)
	}
	if r := noAlert(30, 30, "belt_blocked", 550); !r.Passed {
		t.Fatalf("重新出现的告警首次 tick 是 600（条目复用不改 Tick），自 550 起应通过，got %+v", r)
	}
	// building_alert_since：与 building_no_alert_since 相反，要求「确实出现过
	// 一条仍成立的该类型告警」。cp-haul-unreachable 用它断言 haul_unreachable
	// 真的发了出来。
	hasAlert := func(x, y int, alertType string, sinceTick int64) checkpoint.ContractResult {
		return eval(checkpoint.ContractCheck{Kind: "building_alert_since", Player: "p1",
			AlertType: alertType, Tick: sinceTick, Position: &model.Position{X: x, Y: y}})
	}
	if r := hasAlert(30, 30, "throughput_drop", 0); !r.Passed || r.Actual != "1" {
		t.Fatalf("tick 200 的 throughput_drop 仍成立，应通过，got %+v", r)
	}
	if r := hasAlert(30, 30, "throughput_drop", 300); r.Passed || r.Actual != "0" {
		t.Fatalf("自 tick 300 起没有新出现的 throughput_drop，应失败，got %+v", r)
	}
	if r := hasAlert(30, 30, "haul_unreachable", 0); r.Passed || r.Actual != "0" {
		t.Fatalf("没发过的告警类型必须失败，got %+v", r)
	}
	if r := hasAlert(40, 40, "belt_blocked", 0); r.Passed || r.Actual != "(none)" {
		t.Fatalf("别人家的建筑不算，got %+v", r)
	}
	_ = player
}
