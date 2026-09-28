package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/surface"
)

// 遭遇战 bot（A1）：服务端确定性 AI，走与玩家完全相同的命令接口
// （QueuedRequest 入队 → 命令日志 → 回放/审计一致）。
// 运营循环：采矿/补能 → 电力 → 矿机 → 制造台 → 出兵 → 进攻/防守。
// 决策是"世界状态 + tick"的纯函数（少量记忆可从状态重建），对局可重放。

// botTuning bot 难度参数。
type botTuning struct {
	cadence      int64 // 决策间隔（tick）
	maxCmds      int   // 每次决策最多下发的命令数
	attackAt     int   // 进攻兵力阈值
	armyCap      int   // 兵力上限
	minerTarget  int   // 目标矿机数
	powerTarget  int   // 目标发电建筑数
	craftBatch   int   // 单批手搓数量上限
	defendRadius int   // 基地防御拉扯半径
}

func botTuningFor(difficulty string) botTuning {
	switch difficulty {
	case "easy":
		return botTuning{cadence: 60, maxCmds: 1, attackAt: 6, armyCap: 8, minerTarget: 1, powerTarget: 2, craftBatch: 4, defendRadius: 14}
	case "hard":
		return botTuning{cadence: 15, maxCmds: 3, attackAt: 14, armyCap: 22, minerTarget: 3, powerTarget: 4, craftBatch: 10, defendRadius: 20}
	default: // normal
		return botTuning{cadence: 30, maxCmds: 2, attackAt: 10, armyCap: 14, minerTarget: 2, powerTarget: 3, craftBatch: 6, defendRadius: 16}
	}
}

// settleBots 每 tick 驱动全部 bot 玩家（pipeline 调用）。
func (gc *GameCore) settleBots() {
	if gc == nil || gc.cfg == nil {
		return
	}
	for _, pc := range gc.cfg.Players {
		if pc.Bot == "" {
			continue
		}
		ws := gc.botWorldFor(pc.PlayerID)
		if ws == nil || ws.Tick <= 0 {
			continue
		}
		tuning := botTuningFor(pc.Bot)
		if (ws.Tick+botStagger(pc.PlayerID))%tuning.cadence != 0 {
			continue
		}
		gc.runBotBrain(ws, pc.PlayerID, tuning)
	}
}

// botStagger 按玩家错开决策 tick，避免多 bot 同拍行动。
func botStagger(playerID string) int64 {
	h := int64(0)
	for _, c := range playerID {
		h = h*31 + int64(c)
	}
	if h < 0 {
		h = -h
	}
	return h
}

// botWorldFor bot 的作战世界：有其执行体或建筑的已加载世界。
func (gc *GameCore) botWorldFor(playerID string) *model.WorldState {
	worldIDs := make([]string, 0, len(gc.worlds))
	for id := range gc.worlds {
		worldIDs = append(worldIDs, id)
	}
	sort.Strings(worldIDs)
	for _, id := range worldIDs {
		ws := gc.worlds[id]
		if ws == nil {
			continue
		}
		player := ws.Players[playerID]
		if player == nil {
			continue
		}
		for _, u := range ws.Units {
			if u != nil && u.OwnerID == playerID && u.HP > 0 && u.Mecha != nil {
				return ws
			}
		}
		for _, b := range ws.Buildings {
			if b != nil && b.OwnerID == playerID && b.HP > 0 {
				return ws
			}
		}
	}
	return nil
}

// botIssue 以 bot 名义把命令放入玩家相同的命令队列；队列不可用时直接执行（测试便利）。
func (gc *GameCore) botIssue(ws *model.WorldState, playerID string, cmd model.Command) {
	req := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  fmt.Sprintf("bot-%s-%s-%d-%d", playerID, ws.PlanetID, ws.Tick, botHashCmd(cmd)),
			IssuerType: "bot",
			IssuerID:   playerID,
			Commands:   []model.Command{cmd},
		},
		PlayerID:    playerID,
		EnqueueTick: ws.Tick,
	}
	if gc.queue != nil {
		gc.queue.Enqueue(req)
		return
	}
	gc.executeRequest(req)
}

// botHashCmd 生成 bot 请求的去重序号（同一 tick 同类型命令只发一次的语义由调用方保证）。
func botHashCmd(cmd model.Command) int {
	h := 0
	for _, c := range string(cmd.Type) + cmd.Target.EntityID {
		h = h*131 + int(c)
	}
	if h < 0 {
		h = -h
	}
	return h % 1000
}

// runBotBrain 一次 bot 决策：按优先级检查各项需求并下发最多 maxCmds 条命令。
func (gc *GameCore) runBotBrain(ws *model.WorldState, playerID string, tuning botTuning) {
	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		return
	}
	ctx := gc.surveyBotWorld(ws, playerID)
	if ctx.home == nil {
		return
	}
	cmds := 0
	issue := func(cmd model.Command) bool {
		if cmds >= tuning.maxCmds {
			return false
		}
		gc.botIssue(ws, playerID, cmd)
		cmds++
		return true
	}

	// 按优先级逐项检查：每项最多一条命令，总量受 maxCmds 限制（issue 内部计数）。
	// 0. 战斗：兵力达标就进攻，全军覆没就重建。
	gc.botMilitary(ws, playerID, tuning, ctx, issue)
	// 1. 执行体经济：补能 → 采矿（缺什么采什么）。
	gc.botEconomy(ws, playerID, tuning, ctx, issue)
	// 2. 电力。
	gc.botPower(ws, playerID, tuning, ctx, issue)
	// 3. 矿机（抽象 minerals 来源）。
	gc.botMiners(ws, playerID, tuning, ctx, issue)
	// 4. 制造台（出兵前置：手搓齿轮/电路板）。
	gc.botAssembler(ws, playerID, tuning, ctx, issue)
	// 5. 出兵。
	gc.botProduce(ws, playerID, tuning, ctx, issue)
}

// botSurvey 一次世界态势扫描（bot 的"眼睛"）。
type botSurvey struct {
	home         *model.Position
	executor     *model.Unit
	soldiers     []*model.Unit
	buildings    []*model.Building
	powerCount   int
	minerCount   int
	assemblers   []*model.Building
	enemyPlayers map[string][]*model.Building
	nests        []*model.EnemyForce
}

func (gc *GameCore) surveyBotWorld(ws *model.WorldState, playerID string) *botSurvey {
	survey := &botSurvey{enemyPlayers: make(map[string][]*model.Building)}
	buildingIDs := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		buildingIDs = append(buildingIDs, id)
	}
	sort.Strings(buildingIDs)
	for _, id := range buildingIDs {
		b := ws.Buildings[id]
		if b == nil || b.HP <= 0 {
			continue
		}
		if b.OwnerID == playerID {
			survey.buildings = append(survey.buildings, b)
			if b.Runtime.Functions.Energy != nil && b.Runtime.Functions.Energy.OutputPerTick > 0 {
				survey.powerCount++
			}
			if isMinerBuilding(b) {
				survey.minerCount++
			}
			def, ok := model.BuildingDefinitionByID(b.Type)
			if ok && def.CanProduceUnits {
				survey.assemblers = append(survey.assemblers, b)
			}
			if b.Type == model.BuildingTypeBattlefieldAnalysisBase && survey.home == nil {
				pos := b.Position
				survey.home = &pos
			}
			continue
		}
		if b.OwnerID != "" && hostile(ws, playerID, b.OwnerID) {
			survey.enemyPlayers[b.OwnerID] = append(survey.enemyPlayers[b.OwnerID], b)
		}
	}
	unitIDs := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		unitIDs = append(unitIDs, id)
	}
	sort.Strings(unitIDs)
	for _, id := range unitIDs {
		u := ws.Units[id]
		if u == nil || u.HP <= 0 || u.OwnerID != playerID {
			continue
		}
		if u.Mecha != nil {
			survey.executor = u
			continue
		}
		if u.Type == model.UnitTypeSoldier || u.Type == model.UnitTypeMecha {
			survey.soldiers = append(survey.soldiers, u)
		}
	}
	if survey.home == nil && survey.executor != nil {
		pos := survey.executor.Position
		survey.home = &pos
	}
	if ws.EnemyForces != nil {
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Type == model.EnemyForceTypeHive && force.Strength > 0 {
				survey.nests = append(survey.nests, force)
			}
		}
	}
	return survey
}

func isMinerBuilding(b *model.Building) bool {
	def, ok := model.BuildingDefinitionByID(b.Type)
	return ok && def.RequiresResourceNode
}

// botMilitary 兵力管理：达标进攻、覆灭重建、回防。
func (gc *GameCore) botMilitary(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	// 出击状态由部队自身姿态推导（无记忆，回放/读档天然一致）：
	// 任一士兵在交火或攻击移动途中即视为已出击。
	armyEngaged := false
	for _, u := range ctx.soldiers {
		if u.AttackTarget != "" || (u.Stance == model.UnitStanceAttackMove && u.HasPath()) {
			armyEngaged = true
			break
		}
	}
	// 进攻：兵力达标且尚未出击。
	if !armyEngaged && len(ctx.soldiers) >= tuning.attackAt {
		target := gc.botAttackObjective(ws, playerID, ctx)
		if target != nil {
			ids := make([]string, 0, len(ctx.soldiers))
			for _, u := range ctx.soldiers {
				ids = append(ids, u.ID)
			}
			return issue(model.Command{
				Type:    model.CmdUnitOrder,
				Target:  model.CommandTarget{Layer: "planet", EntityIDs: ids, Position: target},
				Payload: map[string]any{"order": "attack_move"},
			})
		}
	}
	// 回防：基地近旁出现敌对实体且部队未出击时，把士兵拉回家。
	if !armyEngaged && len(ctx.soldiers) > 0 {
		for _, nest := range ctx.nests {
			if ws.SurfaceDistance(nest.Position, *ctx.home) <= tuning.defendRadius {
				ids := make([]string, 0, len(ctx.soldiers))
				for _, u := range ctx.soldiers {
					if ws.SurfaceDistance(u.Position, *ctx.home) > 4 {
						ids = append(ids, u.ID)
					}
				}
				if len(ids) > 0 {
					return issue(model.Command{
						Type:    model.CmdUnitOrder,
						Target:  model.CommandTarget{Layer: "planet", EntityIDs: ids, Position: ctx.home},
						Payload: map[string]any{"order": "attack_move"},
					})
				}
			}
		}
	}
	return false
}

// botAttackObjective 进攻目标：优先最近的敌方玩家建筑中心，其次最近的黑雾巢穴。
func (gc *GameCore) botAttackObjective(ws *model.WorldState, playerID string, ctx *botSurvey) *model.Position {
	bestDist := -1
	var best *model.Position
	for _, buildings := range ctx.enemyPlayers {
		if len(buildings) == 0 {
			continue
		}
		center := buildingCentroid(ws, buildings)
		d := ws.SurfaceDistance(*ctx.home, center)
		if bestDist < 0 || d < bestDist {
			c := center
			best = &c
			bestDist = d
		}
	}
	if best != nil {
		return best
	}
	for _, nest := range ctx.nests {
		d := ws.SurfaceDistance(*ctx.home, nest.Position)
		if bestDist < 0 || d < bestDist {
			pos := nest.Position
			best = &pos
			bestDist = d
		}
	}
	return best
}

func buildingCentroid(ws *model.WorldState, buildings []*model.Building) model.Position {
	if len(buildings) == 1 {
		return buildings[0].Position
	}
	var sum [3]float64
	for _, b := range buildings {
		v := ws.Surface().Normal(surface.Tile{X: b.Position.X, Y: b.Position.Y})
		for i := range sum {
			sum[i] += v[i]
		}
	}
	t := ws.Surface().FromVector(sum[0], sum[1], sum[2])
	return model.Position{X: t.X, Y: t.Y}
}

// botEconomy 执行体经济：低能补能，缺料采矿，无事采铁。
func (gc *GameCore) botEconomy(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	exec := ctx.executor
	if exec == nil || exec.Mecha == nil {
		return false
	}
	player := ws.Players[playerID]
	// 半能即补（手搓/移动都耗能；饿死后再启动代价大得多）。
	if exec.Mecha.Energy*2 < exec.Mecha.MaxEnergy {
		if qty := player.Inventory[model.ItemCoal]; qty > 0 {
			return issue(model.Command{
				Type:    model.CmdRefuelMecha,
				Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
				Payload: map[string]any{"item_id": model.ItemCoal, "quantity": min(qty, 8)},
			})
		}
	}
	if exec.Mecha.Job != nil {
		return false
	}
	// 缺料清单：当前建设目标所需物品。
	missing := gc.botMaterialNeeds(ws, playerID, tuning, ctx)
	// 燃料不多：提前采煤（手搓链随时会饿死在半路）。
	if player.Inventory[model.ItemCoal] < 12 {
		if cmd, ok := gc.botMineKind(ws, playerID, exec, model.ItemCoal, ctx); ok {
			return issue(cmd)
		}
	}
	if len(missing) > 0 {
		// 先可手搓的直接手搓（原料够）。
		if cmd, ok := gc.botCraftFor(ws, playerID, missing, tuning); ok {
			return issue(cmd)
		}
		// 否则去采最缺的矿石。
		if cmd, ok := gc.botMineFor(ws, playerID, exec, missing[0], ctx); ok {
			return issue(cmd)
		}
		return false
	}
	// 无明确缺口：采煤/铁备用（背包留空位时）。
	if cmd, ok := gc.botMineKind(ws, playerID, exec, model.ItemCoal, ctx); ok {
		return issue(cmd)
	}
	if cmd, ok := gc.botMineKind(ws, playerID, exec, model.ItemIronOre, ctx); ok {
		return issue(cmd)
	}
	return false
}

// botMaterialNeeds 当前建设目标的物料缺口（按建设优先级：电力→矿机→制造台）。
func (gc *GameCore) botMaterialNeeds(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey) []string {
	player := ws.Players[playerID]
	need := func(btype model.BuildingType) []string {
		def, ok := model.BuildingDefinitionByID(btype)
		if !ok {
			return nil
		}
		var missing []string
		for _, item := range def.BuildCost.Items {
			if player.Inventory[item.ItemID] < item.Quantity {
				missing = append(missing, item.ItemID)
			}
		}
		return missing
	}
	if ctx.powerCount < tuning.powerTarget {
		if missing := need(model.BuildingTypeWindTurbine); len(missing) > 0 {
			return missing
		}
	}
	if ctx.minerCount < tuning.minerTarget {
		if missing := need(model.BuildingTypeMiningMachine); len(missing) > 0 {
			return missing
		}
	}
	if len(ctx.assemblers) == 0 {
		if missing := need(model.BuildingTypeAssemblingMachineMk1); len(missing) > 0 {
			return missing
		}
	}
	return nil
}

// botCraftFor 原料足够时手搓缺口物品（齿轮/电路板/锭的二级链）。
func (gc *GameCore) botCraftFor(ws *model.WorldState, playerID string, missing []string, tuning botTuning) (model.Command, bool) {
	player := ws.Players[playerID]
	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		return model.Command{}, false
	}
	exec := ws.Units[execState.UnitID]
	if exec == nil || exec.Mecha == nil {
		return model.Command{}, false
	}
	for _, itemID := range missing {
		recipeID, ingredients := botCraftChain(itemID)
		if recipeID == "" {
			continue
		}
		// 原料不足时先搓原料（仅一级下钻）。
		if cmd, ok := gc.botCraftIngredient(ws, playerID, ingredients, tuning); ok {
			return cmd, true
		}
		qty := tuning.craftBatch
		if !botHasIngredients(player.Inventory, ingredients, qty) {
			qty = 1
			if !botHasIngredients(player.Inventory, ingredients, qty) {
				continue
			}
		}
		return model.Command{
			Type:    model.CmdCraftItem,
			Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
			Payload: map[string]any{"recipe_id": recipeID, "quantity": qty},
		}, true
	}
	return model.Command{}, false
}

// botCraftChain bot 手搓知识：目标物品 → (配方, 每份原料)。
func botCraftChain(itemID string) (recipeID string, ingredients []model.ItemAmount) {
	switch itemID {
	case model.ItemGear:
		return "gear", []model.ItemAmount{{ItemID: model.ItemIronIngot, Quantity: 1}}
	case model.ItemCircuitBoard:
		return "circuit_board", []model.ItemAmount{{ItemID: model.ItemIronIngot, Quantity: 1}, {ItemID: model.ItemCopperIngot, Quantity: 1}}
	case model.ItemIronIngot:
		return "smelt_iron", []model.ItemAmount{{ItemID: model.ItemIronOre, Quantity: 1}}
	case model.ItemCopperIngot:
		return "smelt_copper", []model.ItemAmount{{ItemID: model.ItemCopperOre, Quantity: 1}}
	case model.ItemMagneticCoil:
		return "magnetic_coil", []model.ItemAmount{{ItemID: model.ItemMagnet, Quantity: 2}, {ItemID: model.ItemCopperIngot, Quantity: 1}}
	case model.ItemMagnet:
		return "smelt_magnet", []model.ItemAmount{{ItemID: model.ItemIronOre, Quantity: 1}}
	}
	return "", nil
}

// botCraftIngredient 原料缺口时先搓原料（铁锭/铜锭）。
func (gc *GameCore) botCraftIngredient(ws *model.WorldState, playerID string, ingredients []model.ItemAmount, tuning botTuning) (model.Command, bool) {
	player := ws.Players[playerID]
	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		return model.Command{}, false
	}
	exec := ws.Units[execState.UnitID]
	if exec == nil || exec.Mecha == nil {
		return model.Command{}, false
	}
	for _, ing := range ingredients {
		if player.Inventory[ing.ItemID] > 0 {
			continue
		}
		recipeID, sub := botCraftChain(ing.ItemID)
		if recipeID == "" {
			continue
		}
		qty := tuning.craftBatch
		if !botHasIngredients(player.Inventory, sub, qty) {
			qty = 1
			if !botHasIngredients(player.Inventory, sub, qty) {
				continue
			}
		}
		return model.Command{
			Type:    model.CmdCraftItem,
			Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
			Payload: map[string]any{"recipe_id": recipeID, "quantity": qty},
		}, true
	}
	return model.Command{}, false
}

func botHasIngredients(inv model.ItemInventory, ingredients []model.ItemAmount, multiplier int) bool {
	for _, ing := range ingredients {
		if inv[ing.ItemID] < ing.Quantity*multiplier {
			return false
		}
	}
	return true
}

// botMineFor 按缺口物品反推矿种并前往开采。
func (gc *GameCore) botMineFor(ws *model.WorldState, playerID string, exec *model.Unit, missingItem string, ctx *botSurvey) (model.Command, bool) {
	oreKind := ""
	switch missingItem {
	case model.ItemGear, model.ItemIronIngot, model.ItemMagnet:
		oreKind = model.ItemIronOre
	case model.ItemCircuitBoard, model.ItemCopperIngot, model.ItemMagneticCoil:
		oreKind = model.ItemCopperOre
	default:
		oreKind = model.ItemIronOre
	}
	return gc.botMineKind(ws, playerID, exec, oreKind, ctx)
}

// botMineKind 前往最近的指定矿种节点开采；不在操作范围时先移动过去。
func (gc *GameCore) botMineKind(ws *model.WorldState, playerID string, exec *model.Unit, oreKind string, ctx *botSurvey) (model.Command, bool) {
	node := botNearestNode(ws, exec.Position, oreKind)
	if node == nil {
		// 没有该矿种：退而采铁（通用原料）。
		if oreKind != model.ItemIronOre {
			node = botNearestNode(ws, exec.Position, model.ItemIronOre)
		}
		if node == nil {
			return model.Command{}, false
		}
	}
	execState := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		return model.Command{}, false
	}
	if ws.SurfaceDistance(exec.Position, node.Position) > execState.OperateRange {
		// 先移动到矿点邻格。
		dest := botAdjacentFreeTile(ws, node.Position, exec.ID)
		if dest == nil {
			return model.Command{}, false
		}
		return model.Command{
			Type:   model.CmdMove,
			Target: model.CommandTarget{Layer: "planet", EntityID: exec.ID, Position: dest},
		}, true
	}
	return model.Command{
		Type:    model.CmdMineResource,
		Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
		Payload: map[string]any{"resource_id": node.ID, "quantity": 20},
	}, true
}

// botNearestNode 最近的未枯竭指定矿种节点。
func botNearestNode(ws *model.WorldState, from model.Position, kind string) *model.ResourceNodeState {
	var best *model.ResourceNodeState
	bestDist := -1
	for _, node := range ws.Resources {
		if node == nil || node.Kind != kind || node.Remaining <= 0 || node.Depleted {
			continue
		}
		d := ws.SurfaceDistance(from, node.Position)
		if bestDist < 0 || d < bestDist {
			best = node
			bestDist = d
		}
	}
	return best
}

// botAdjacentFreeTile 目标格附近的可站立格。
func botAdjacentFreeTile(ws *model.WorldState, center model.Position, selfID string) *model.Position {
	for _, candidate := range ws.SurfaceDisc(center, 2) {
		if candidate == center {
			continue
		}
		if tileWalkableForUnit(ws, candidate, selfID) {
			c := candidate
			return &c
		}
	}
	return nil
}

// botPower 电力建设：发电建筑不足时在基地附近补风机。
func (gc *GameCore) botPower(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	if ctx.powerCount >= tuning.powerTarget {
		return false
	}
	player := ws.Players[playerID]
	cost := model.BuildCost{}
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeWindTurbine)
	if !ok {
		return false
	}
	cost = def.BuildCost
	if player.Resources.Minerals < cost.Minerals || player.Resources.Energy < cost.Energy {
		return false
	}
	missing, short := missingItem(player.Inventory, cost.Items)
	if short {
		_ = missing
		return false
	}
	pos := botBuildSpotNear(ws, *ctx.home, playerID)
	if pos == nil {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
}

// botMiners 矿机建设：目标数量内且附近有未覆盖矿点。
func (gc *GameCore) botMiners(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	if ctx.minerCount >= tuning.minerTarget {
		return false
	}
	player := ws.Players[playerID]
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
	if !ok {
		return false
	}
	if player.Resources.Minerals < def.BuildCost.Minerals || player.Resources.Energy < def.BuildCost.Energy {
		return false
	}
	if _, short := missingItem(player.Inventory, def.BuildCost.Items); short {
		return false
	}
	// 找一台附近没有己方矿机的矿点（必须在建造可达范围内：基地半径或执行体操作范围）。
	execRange := 6
	if ctx.executor != nil {
		if execState := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID); execState != nil {
			execRange = execState.OperateRange
		}
	}
	for _, kind := range []string{model.ItemIronOre, model.ItemCopperOre, model.ItemCoal, "stone"} {
		for _, node := range ws.Resources {
			if node == nil || node.Kind != kind || node.Remaining <= 0 || node.Depleted {
				continue
			}
			homeDist := ws.SurfaceDistance(*ctx.home, node.Position)
			inRange := homeDist <= 24
			if !inRange && ctx.executor != nil && ws.SurfaceDistance(ctx.executor.Position, node.Position) <= execRange {
				inRange = true
			}
			if !inRange {
				continue
			}
			covered := false
			for _, b := range ctx.buildings {
				if isMinerBuilding(b) && ws.SurfaceDistance(b.Position, node.Position) <= 4 {
					covered = true
					break
				}
			}
			if covered {
				continue
			}
			pos := node.Position
			return issue(model.Command{
				Type:    model.CmdBuild,
				Target:  model.CommandTarget{Layer: "planet", Position: &pos},
				Payload: map[string]any{"building_type": string(model.BuildingTypeMiningMachine)},
			})
		}
	}
	return false
}

// botAssembler 制造台建设：物料齐了就在基地附近建一台。
func (gc *GameCore) botAssembler(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	if len(ctx.assemblers) > 0 {
		return false
	}
	player := ws.Players[playerID]
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeAssemblingMachineMk1)
	if !ok {
		return false
	}
	if player.Resources.Minerals < def.BuildCost.Minerals || player.Resources.Energy < def.BuildCost.Energy {
		return false
	}
	if _, short := missingItem(player.Inventory, def.BuildCost.Items); short {
		return false
	}
	pos := botBuildSpotNear(ws, *ctx.home, playerID)
	if pos == nil {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: map[string]any{"building_type": string(model.BuildingTypeAssemblingMachineMk1)},
	})
}

// botProduce 出兵：资源够就在制造台排队士兵。
func (gc *GameCore) botProduce(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	if len(ctx.assemblers) == 0 || len(ctx.soldiers) >= tuning.armyCap {
		return false
	}
	player := ws.Players[playerID]
	mCost, eCost := model.UnitCost(model.UnitTypeSoldier)
	if player.Resources.Minerals < mCost*2 || player.Resources.Energy < eCost*2 {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdProduce,
		Target:  model.CommandTarget{Layer: "planet", EntityID: ctx.assemblers[0].ID},
		Payload: map[string]any{"unit_type": string(model.UnitTypeSoldier)},
	})
}

// botBuildSpotNear 基地附近的可建格（由内向外扫描）。
func botBuildSpotNear(ws *model.WorldState, home model.Position, playerID string) *model.Position {
	for radius := 3; radius <= 20; radius++ {
		for _, candidate := range ws.SurfaceDisc(home, radius) {
			d := ws.SurfaceDistance(home, candidate)
			if d != radius {
				continue
			}
			if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
				continue
			}
			c := candidate
			return &c
		}
	}
	return nil
}
