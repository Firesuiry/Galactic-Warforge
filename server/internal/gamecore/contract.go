package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/model"
)

// 状态契约（checkpoint contract）：创建存档点时对当前世界做一次结构化断言，
// regression 存档点要求逐条通过，bug 存档点只记录结果。
//
// 谓词词表保持小而实用（每条可选 player 字段；缺省针对全体玩家，任一玩家满足即通过）：
//
//	tick_gte            {tick}
//	tick_lt             {tick}
//	game_not_finished   {}
//	player_alive        {}
//	tech_researched     {tech_id}
//	building_count_gte  {type, n}
//	unit_count_gte      {type, n}
//	item_gte            {item_id, n}
//	dark_fog_hostile    {bool}
//	enemy_attack_seen   {bool}
//
// 「玩家可用物资」口径：PlayerState.Inventory（就是机甲背包，采矿/手搓/战利品都落这里，
// 也是 transfer/build 的扣料来源）；minerals/energy 是电力与建造用的资源池，不在物品背包里。

// EvaluateContract 在当前世界上评估契约；空契约视为通过。
func (gc *GameCore) EvaluateContract(contract checkpoint.Contract) checkpoint.ContractReport {
	report := checkpoint.ContractReport{Passed: true}
	for _, check := range contract.Checks {
		result := gc.evaluateContractCheck(check)
		if !result.Passed {
			report.Passed = false
		}
		report.Results = append(report.Results, result)
	}
	return report
}

func (gc *GameCore) evaluateContractCheck(check checkpoint.ContractCheck) checkpoint.ContractResult {
	pass := func(actual string, detail string) checkpoint.ContractResult {
		return checkpoint.ContractResult{Check: check, Passed: true, Actual: actual, Detail: detail}
	}
	fail := func(actual string, detail string) checkpoint.ContractResult {
		return checkpoint.ContractResult{Check: check, Passed: false, Actual: actual, Detail: detail}
	}

	// 非玩家谓词先处理，避免为空玩家集合判 false。
	switch check.Kind {
	case "tick_gte":
		tick := gc.CurrentTick()
		if tick >= check.Tick {
			return pass(fmt.Sprintf("%d", tick), "")
		}
		return fail(fmt.Sprintf("%d", tick), fmt.Sprintf("要求 tick >= %d", check.Tick))
	case "tick_lt":
		tick := gc.CurrentTick()
		if tick < check.Tick {
			return pass(fmt.Sprintf("%d", tick), "")
		}
		return fail(fmt.Sprintf("%d", tick), fmt.Sprintf("要求 tick < %d", check.Tick))
	case "game_not_finished":
		if !gc.Finished() {
			return pass("running", "")
		}
		return fail("finished", "对局已宣判结束")
	}

	players := gc.contractPlayers(check.Player)
	if len(players) == 0 {
		return fail("(none)", fmt.Sprintf("找不到玩家 %q", check.Player))
	}
	// 多玩家（未指定 player）时任一玩家满足即通过；逐玩家求值并取「或」。
	var firstFail *checkpoint.ContractResult
	for _, player := range players {
		result := gc.evaluatePlayerCheck(check, player)
		if result.Passed {
			return result
		}
		if firstFail == nil {
			copied := result
			firstFail = &copied
		}
	}
	return *firstFail
}

func (gc *GameCore) evaluatePlayerCheck(check checkpoint.ContractCheck, player *model.PlayerState) checkpoint.ContractResult {
	pass := func(actual string) checkpoint.ContractResult {
		return checkpoint.ContractResult{Check: check, Passed: true, Actual: actual}
	}
	fail := func(actual string, detail string) checkpoint.ContractResult {
		return checkpoint.ContractResult{Check: check, Passed: false, Actual: actual, Detail: detail}
	}

	switch check.Kind {
	case "player_alive":
		if player.IsAlive {
			return pass("true")
		}
		return fail("false", "玩家已被淘汰")
	case "tech_researched":
		level := 0
		if player.Tech != nil {
			level = player.Tech.CompletedTechs[check.TechID]
		}
		if level > 0 {
			return pass(fmt.Sprintf("%d", level))
		}
		return fail("0", fmt.Sprintf("未完成科技 %s", check.TechID))
	case "building_count_gte":
		count := 0
		for _, world := range gc.sortedWorlds() {
			world.RLock()
			for _, building := range world.Buildings {
				if building != nil && building.OwnerID == player.PlayerID && building.HP > 0 && string(building.Type) == check.Type {
					count++
				}
			}
			world.RUnlock()
		}
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求 %s >= %d", check.Type, check.N))
	case "unit_count_gte":
		count := 0
		for _, world := range gc.sortedWorlds() {
			world.RLock()
			for _, unit := range world.Units {
				if unit != nil && unit.OwnerID == player.PlayerID && unit.HP > 0 && string(unit.Type) == check.Type {
					count++
				}
			}
			world.RUnlock()
		}
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求 %s >= %d", check.Type, check.N))
	case "item_gte":
		count := player.Inventory[check.ItemID]
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求背包中 %s >= %d", check.ItemID, check.N))
	case "dark_fog_hostile":
		hostile := player.DarkFog.Hostile
		if hostile == check.Boolean {
			return pass(fmt.Sprintf("%t", hostile))
		}
		return fail(fmt.Sprintf("%t", hostile), fmt.Sprintf("要求黑雾敌对 = %t", check.Boolean))
	case "enemy_attack_seen":
		seen := enemyAttackSeen(player, gc.opponentKills(player.PlayerID))
		if seen == check.Boolean {
			return pass(fmt.Sprintf("%t", seen))
		}
		return fail(fmt.Sprintf("%t", seen), fmt.Sprintf("要求已遭敌方玩家攻击 = %t", check.Boolean))
	}
	return checkpoint.ContractResult{Check: check, Passed: false, Actual: "(unknown)", Detail: fmt.Sprintf("未知谓词 %q", check.Kind)}
}

// opponentKills 汇总除 exclude 之外所有玩家的击杀数（敌方战果）。
func (gc *GameCore) opponentKills(exclude string) int {
	ws := gc.World()
	if ws == nil {
		return 0
	}
	ws.RLock()
	defer ws.RUnlock()
	total := 0
	for id, player := range ws.Players {
		if id == exclude || player == nil || player.Stats == nil {
			continue
		}
		total += player.Stats.CombatStats.UnitsKilled + player.Stats.CombatStats.BuildingsDestroyed
	}
	return total
}

// enemyAttackSeen 报告该玩家是否已被敌方玩家造成过伤害/损失。
//
// 口径：PlayerStats.CombatStats 的双边战损计数（war_stats.go 的统一入口：
// killUnit / destroyBuildingCombat / destroySquad）只在该玩家的实体被击杀时累加。
// 黑雾击杀同样累加损失，所以这里要求同时存在「该玩家有战损」与「敌方有战果」
// （kills/buildings_destroyed）：黑雾偷袭不会让任何玩家产生 kills，不会误判为
// 「被敌方玩家攻击」；而敌方玩家击杀该玩家的单位/建筑时，双边计数必然同时成立。
func enemyAttackSeen(player *model.PlayerState, opponentKills int) bool {
	if player == nil || player.Stats == nil || opponentKills <= 0 {
		return false
	}
	return player.Stats.CombatStats.UnitsLost > 0 || player.Stats.CombatStats.BuildingsLost > 0
}

// contractPlayers 取待评估的玩家：指定 player 时只评估该玩家，否则按 ID 稳定排序评估全部。
func (gc *GameCore) contractPlayers(playerID string) []*model.PlayerState {
	ws := gc.World()
	if ws == nil {
		return nil
	}
	ws.RLock()
	defer ws.RUnlock()
	if playerID != "" {
		if player := ws.Players[playerID]; player != nil {
			return []*model.PlayerState{player}
		}
		return nil
	}
	ids := make([]string, 0, len(ws.Players))
	for id := range ws.Players {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*model.PlayerState, 0, len(ids))
	for _, id := range ids {
		if player := ws.Players[id]; player != nil {
			out = append(out, player)
		}
	}
	return out
}
