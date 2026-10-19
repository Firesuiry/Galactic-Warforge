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
//	research_in_progress {tech_id?}
//	research_progress_gte {tech_id?, n}   进行中的研究进度 >= n
//	building_count_gte  {type, n}
//	building_running_gte {type, n}      只统计 Runtime.State == running 的存活建筑
//	building_item_gte   {type, item_id, n}  玩家该类建筑库存里的该物品总数 >= n
//	building_item_at_gte {position, item_id, n}  该落点上的玩家建筑里该物品 >= n
//	building_item_at_lt  {position, item_id, n}  该落点上的玩家建筑里该物品 < n
//	building_no_alert_since {position, alert_type?, tick}  该落点建筑自 tick 起无该类告警
//	building_alert_since {position, alert_type, tick}     该落点建筑自 tick 起出现过且仍成立的该类告警 >= 1
//	unit_count_gte      {type, n}
//	unit_near           {position, radius, type?, n}  该玩家在 position 半径内的存活单位数 >= n
//	item_gte            {item_id, n}
//	mecha_count_gte     {n}             机甲档案数 >= n（含阵亡待复活）
//	mecha_operator_count {operator, n}  绑定到该操作者的机甲数 == n（operator 空串 = 空闲）
//	no_alert_since      {alert_type, tick, type?}  自 tick 起没有该类生产告警（type 非空时只看该建筑类型）
//	dark_fog_hostile    {bool}
//	dark_fog_calmed     {tick}   自 tick 起该玩家出现过 dark_fog_calmed 事件
//	enemy_attack_seen   {bool}
//
// 「玩家可用物资」口径：所有机甲背包之和（采矿/手搓/战利品都落这里，
// 也是 transfer/build 的扣料来源）。第 16 轮去掉资金维度后建造/升级只扣背包物品，
// 玩家级资源池只剩 resources.energy（电网结余的只读展示）。

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
	case "no_alert_since":
		// 未指定 player 时是「全局」口径：只要求没有该类告警，不做「或」展开。
		count := gc.alertCountSince(check.AlertType, check.Type, check.Tick, "")
		if count == 0 {
			return pass("0", "")
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("自 tick %d 起有 %d 条 %s 告警", check.Tick, count, check.AlertType))
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
	case "research_in_progress":
		// 试玩 1014 层 09 P1：研究层无法用契约自证——tech_researched 只认已完成。
		// 进行中的研究在 PlayerState.Tech.CurrentResearch（State == in_progress）。
		current := player.Tech.CurrentResearch
		if current == nil || current.State != model.ResearchInProgress {
			return fail("false", "当前没有进行中的研究")
		}
		if check.TechID == "" || current.TechID == check.TechID {
			return pass(current.TechID)
		}
		return fail(current.TechID, fmt.Sprintf("要求正在研究 %s", check.TechID))
	case "research_progress_gte":
		// 研究进度：只有真的在消耗矩阵推进时才 > 0。卡在 waiting_matrix 时进度不动，
		// 这条谓词就是「研究确实在跑」的可执行断言（cp-research-start 用）。
		current := player.Tech.CurrentResearch
		if current == nil {
			return fail("0", "当前没有进行中的研究")
		}
		if check.TechID != "" && current.TechID != check.TechID {
			return fail(fmt.Sprintf("%d", current.Progress), fmt.Sprintf("要求正在研究 %s", check.TechID))
		}
		if current.Progress >= int64(check.N) {
			return pass(fmt.Sprintf("%d", current.Progress))
		}
		return fail(fmt.Sprintf("%d", current.Progress), fmt.Sprintf("要求研究进度 >= %d（当前 %s）", check.N, current.BlockedReason))
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
	case "building_running_gte":
		// 只认真正在运行的建筑：断电（no_power）、停工（paused/idle）、
		// 出错（error）都不算。试玩报告 1013 第 5 节：cp-lab 第一版的研究站
		// 建在电塔供电范围外，整局 no_power，但 building_count_gte 照样通过，
		// 坏层因此被存进了接力链。
		count := 0
		for _, world := range gc.sortedWorlds() {
			world.RLock()
			for _, building := range world.Buildings {
				if building != nil && building.OwnerID == player.PlayerID && building.HP > 0 && string(building.Type) == check.Type && building.Runtime.State == model.BuildingWorkRunning {
					count++
				}
			}
			world.RUnlock()
		}
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求运行中的 %s >= %d（只统计 state=running）", check.Type, check.N))
	case "building_item_gte":
		// 建筑库存口径：玩家「该类建筑」的主库存 + 输入/输出缓冲里的该物品总数。
		// 用来断言「产线真的把货送到了那台机器」（item_gte 只看背包，看不到机器里）。
		count := 0
		for _, world := range gc.sortedWorlds() {
			world.RLock()
			for _, building := range world.Buildings {
				if building == nil || building.OwnerID != player.PlayerID || building.HP <= 0 {
					continue
				}
				if string(building.Type) != check.Type || building.Storage == nil {
					continue
				}
				count += building.Storage.ItemQuantity(check.ItemID)
			}
			world.RUnlock()
		}
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求 %s 里的 %s >= %d", check.Type, check.ItemID, check.N))
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
	case "unit_near":
		// 「军团开到了巢穴外」这类契约不能只数 total：unit_count_gte 在单位还蹲在
		// 基地时也通过（cp-near-hive 的 move 被拒也能满足 ≥6）。这里按 cube-sphere
		// 图距数落点半径内的存活单位；type 为空时数所有单位（含机甲）。
		if check.Position == nil {
			return fail("(none)", "unit_near 需要 position")
		}
		if check.Radius < 0 {
			return fail("(none)", "unit_near 的 radius 不能为负")
		}
		count := 0
		for _, world := range gc.sortedWorlds() {
			world.RLock()
			for _, unit := range world.Units {
				if unit == nil || unit.OwnerID != player.PlayerID || unit.HP <= 0 {
					continue
				}
				if check.Type != "" && string(unit.Type) != check.Type {
					continue
				}
				if world.SurfaceWithin(unit.Position, *check.Position, check.Radius) {
					count++
				}
			}
			world.RUnlock()
		}
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求 (%d,%d) 半径 %d 内的单位 >= %d",
			check.Position.X, check.Position.Y, check.Radius, check.N))
	case "building_item_at_gte", "building_item_at_lt":
		// 按落点定位一台建筑（而不是建筑 ID）：契约要能断言「这一格上的机器里
		// 有多少货」——分拣器送到的仓储非空、紧贴传送带但没有分拣器的仓储必须
		// 空着（第 16 轮直接 IO 已移除）。建筑 ID 是运行时分配的，换一次重建就变。
		building, result := gc.contractBuildingAt(player, check.Position)
		if building == nil {
			return result
		}
		count := building.Storage.ItemQuantity(check.ItemID)
		wantLess := check.Kind == "building_item_at_lt"
		ok := count >= check.N
		if wantLess {
			ok = count < check.N
		}
		actual := fmt.Sprintf("%d", count)
		if ok {
			return pass(actual)
		}
		op := ">="
		if wantLess {
			op = "<"
		}
		return fail(actual, fmt.Sprintf("要求 (%d,%d) 上 %s 里的 %s %s %d",
			check.Position.X, check.Position.Y, building.Type, check.ItemID, op, check.N))
	case "building_no_alert_since":
		// 某台建筑自 tick 起没有「仍成立」的该类生产告警（已解除的老条目不算）：
		// 断言「这条产线没被堵住」时，
		// 既不能只看世界状态里有没有存量告警（告警是历史记录），也不能只看
		// 全服告警（别的产线堵了不该让这一层挂）。所以按落点定位建筑再按
		// building_id + alert_type 过滤历史告警。
		building, result := gc.contractBuildingAt(player, check.Position)
		if building == nil {
			return result
		}
		count := gc.buildingAlertCountSince(building.ID, check.AlertType, check.Tick)
		if count == 0 {
			return pass("0")
		}
		kind := check.AlertType
		if kind == "" {
			kind = "生产"
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("(%d,%d) 上的 %s 自 tick %d 起有 %d 条 %s 告警",
			check.Position.X, check.Position.Y, building.Type, check.Tick, count, kind))
	case "building_alert_since":
		// 与 building_no_alert_since 相反：要求某台建筑自 tick 起确实出现过
		// 一条「此刻仍成立」的该类告警（用于断言「这种告警真的会发出来」，
		// 例如 cp-haul-unreachable 的 haul_unreachable）。
		building, result := gc.contractBuildingAt(player, check.Position)
		if building == nil {
			return result
		}
		count := gc.buildingAlertCountSince(building.ID, check.AlertType, check.Tick)
		if count >= 1 {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail("0", fmt.Sprintf("(%d,%d) 上的 %s 自 tick %d 起没有仍成立的 %s 告警",
			check.Position.X, check.Position.Y, building.Type, check.Tick, check.AlertType))
	case "item_gte":
		count := player.TotalItems(check.ItemID)
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求背包中 %s >= %d", check.ItemID, check.N))
	case "mecha_count_gte":
		// 机甲档案数（不是存活单位数）：阵亡待复活的机甲仍有档案，背包也还在，
		// 下游层读档后照样能改绑 / 查看，所以按档案计数。
		count := len(player.Mechas)
		if count >= check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求机甲档案 >= %d", check.N))
	case "mecha_operator_count":
		// 绑定到某个操作者（issuer_id）的机甲数必须恰好等于 n：operator 空串数空闲机甲。
		// 用相等而不是 >=，因为「一台空闲、一台绑给 builder-a」这种局面要能断言
		// 「没有多出来的空闲机甲」——多绑一台同样是坏层。
		count := 0
		for _, mecha := range player.Mechas {
			if mecha != nil && mecha.Operator == check.Operator {
				count++
			}
		}
		if count == check.N {
			return pass(fmt.Sprintf("%d", count))
		}
		label := check.Operator
		if label == "" {
			label = "(空闲)"
		}
		return fail(fmt.Sprintf("%d", count), fmt.Sprintf("要求绑定到 %s 的机甲数 = %d", label, check.N))
	case "dark_fog_hostile":
		hostile := player.DarkFog.Hostile
		if hostile == check.Boolean {
			return pass(fmt.Sprintf("%t", hostile))
		}
		return fail(fmt.Sprintf("%t", hostile), fmt.Sprintf("要求黑雾敌对 = %t", check.Boolean))
	case "dark_fog_calmed":
		// 「冷静期到期、恢复中立」的可执行断言：只看该玩家的 dark_fog_calmed 事件
		// （settleDarkFogCalm 发，payload.player_id），不把别家玩家的事件算进来。
		// 事件按类型各留一个环（默认 2000 条），本局黑雾只被激怒一次，足够覆盖。
		count := gc.darkFogCalmedCountSince(player.PlayerID, check.Tick)
		if count >= 1 {
			return pass(fmt.Sprintf("%d", count))
		}
		return fail("0", fmt.Sprintf("自 tick %d 起没有该玩家的 dark_fog_calmed 事件", check.Tick))
	case "enemy_attack_seen":
		seen := enemyAttackSeen(player, gc.opponentKills(player.PlayerID))
		if seen == check.Boolean {
			return pass(fmt.Sprintf("%t", seen))
		}
		return fail(fmt.Sprintf("%t", seen), fmt.Sprintf("要求已遭敌方玩家攻击 = %t", check.Boolean))
	}
	return checkpoint.ContractResult{Check: check, Passed: false, Actual: "(unknown)", Detail: fmt.Sprintf("未知谓词 %q", check.Kind)}
}

// contractBuildingAt 按锚点格找出该玩家的建筑（不要求它正好在锚点上，
// 只要它占着这一格——多格建筑的契约写中心格最直观）。
//
// 找不到时返回的 ContractResult 已经带好了失败原因（没写 position / 该格没有
// 玩家的建筑），调用方直接把它当结果返回。
func (gc *GameCore) contractBuildingAt(player *model.PlayerState, pos *model.Position) (*model.Building, checkpoint.ContractResult) {
	check := checkpoint.ContractCheck{}
	fail := func(detail string) (*model.Building, checkpoint.ContractResult) {
		return nil, checkpoint.ContractResult{Check: check, Passed: false, Actual: "(none)", Detail: detail}
	}
	if pos == nil {
		return fail("该谓词需要 position（建筑锚点格）")
	}
	for _, world := range gc.sortedWorlds() {
		world.RLock()
		id := world.TileBuilding[model.TileKey(pos.X, pos.Y)]
		building := world.Buildings[id]
		if building != nil && building.OwnerID == player.PlayerID && building.HP > 0 {
			world.RUnlock()
			return building, checkpoint.ContractResult{}
		}
		world.RUnlock()
	}
	return fail(fmt.Sprintf("(%d,%d) 上没有该玩家的建筑", pos.X, pos.Y))
}

// buildingAlertCountSince 数「自 tick 起出现过、且此刻仍成立」的、属于某台建筑的
// 生产告警。alertType 为空时数全部类型。
//
// 为什么只看仍成立（Active）：告警历史按 (行星, 建筑, 类型) 聚合，同一条目复用
// alert_id，重复出现只刷新 last_tick。如果按「首次出现 tick」判，一条在产线配齐
// 之前就出现、随后被解除的老告警会永远让契约失败——它证明的是「历史上堵过」，
// 不是「现在堵着」。契约要断言的是「自本层开始，产线没有处于堵塞状态」。
// 仍成立的条目 Tick 不会被改写（Record 只刷新 LastTick），所以「自 tick 起」的
// 口径对 active 条目依然准确。
func (gc *GameCore) buildingAlertCountSince(buildingID, alertType string, tick int64) int {
	if gc == nil || gc.alertHistory == nil {
		return 0
	}
	count := 0
	for _, alert := range gc.alertHistory.All() {
		if alert == nil || !alert.Active || alert.Tick < tick || alert.BuildingID != buildingID {
			continue
		}
		if alertType != "" && string(alert.AlertType) != alertType {
			continue
		}
		count++
	}
	return count
}

// alertCountSince 数自 tick 起（含）的记录在案的生产告警：alertType 为空时数全部类型，
// buildingType 非空时只看该建筑类型，playerID 非空时只看该玩家的建筑。
func (gc *GameCore) alertCountSince(alertType, buildingType string, tick int64, playerID string) int {
	if gc == nil || gc.alertHistory == nil {
		return 0
	}
	count := 0
	for _, alert := range gc.alertHistory.All() {
		if alert == nil || alert.Tick < tick {
			continue
		}
		if alertType != "" && string(alert.AlertType) != alertType {
			continue
		}
		if buildingType != "" && string(alert.BuildingType) != buildingType {
			continue
		}
		if playerID != "" && alert.PlayerID != playerID {
			continue
		}
		count++
	}
	return count
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

// darkFogCalmedCountSince 数自 tick 起该玩家收到过几条 dark_fog_calmed 事件。
// 事件历史按类型各留一个环（默认 2000 条），黑雾每局被激怒的次数远小于这个量级。
func (gc *GameCore) darkFogCalmedCountSince(playerID string, tick int64) int {
	if gc == nil || gc.eventHistory == nil || playerID == "" {
		return 0
	}
	events, _, _, _ := gc.eventHistory.Snapshot([]model.EventType{model.EvtDarkFogCalmed}, "", tick, 0)
	count := 0
	for _, evt := range events {
		if evt == nil || evt.Tick < tick {
			continue
		}
		if owner, _ := evt.Payload["player_id"].(string); owner == playerID {
			count++
		}
	}
	return count
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
