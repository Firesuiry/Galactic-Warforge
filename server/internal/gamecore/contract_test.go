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
	placeBuilding(ws, newBuilding("plant-c", model.BuildingTypeWindTurbine, "p1", model.Position{X: 20, Y: 20}))
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
		{"building_count_gte pass", checkpoint.ContractCheck{Kind: "building_count_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 1}, true, "1"},
		{"building_count_gte fail", checkpoint.ContractCheck{Kind: "building_count_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 2}, false, "1"},
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
