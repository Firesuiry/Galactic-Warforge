package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/surface"
)

// 遭遇战 bot（A1）：服务端确定性 AI，走与玩家完全相同的命令接口
// （QueuedRequest 入队 → 命令日志 → 回放/审计一致）。
// 运营循环：采矿/补能 → 电力 → 矿机 → 制造台 → 研究 → 混合出兵 → 进攻/回防/炮塔。
// 决策是世界状态的纯函数（无 wall-clock、无随机；平局按实体 ID 排序）。

// botTuning bot 难度参数。
type botTuning struct {
	cadence             int64   // 决策间隔（tick）
	maxCmds             int     // 每次决策最多下发的命令数
	attackAt            int     // 进攻兵力阈值（编成军团 + 军团出击的最小兵力；也是单支军团规模 = 首波规模）
	squadCap            int     // 同时存在的军团上限（低难度只留 1 支：首波只有 attackAt 个兵，不会 2 支同时压家）
	armyCap             int     // 兵力上限（士兵+mecha）
	waveCooldown        int64   // 波次冷却（tick）：上一波军团出发后至少隔这么久才编下一波
	minerTarget         int     // 目标矿机数
	powerTarget         int     // 目标发电建筑数
	assemblerTarget     int     // 目标制造台数（研究矩阵链与弹药链并行需要多台）
	smelterTarget       int     // 目标电弧熔炉数（铁/铜/磁铁并行冶炼）
	matrixMachineTarget int     // 目标电磁矩阵制造台数（研究站备料的专用产线）
	craftBatch          int     // 单批手搓数量上限
	defendRadius        int     // 基地防御拉扯半径
	mechaEvery          int     // 每多少名士兵配一台 mecha
	mechaMinSoldiers    int     // 第一台 mecha 前至少有多少士兵；0 表示可先出 mecha
	turretCap           int     // 基地炮塔上限（含在建）
	turretThreat        int     // 威胁进入该半径才造炮塔（越大越早）
	researchMaxLevel    int     // >0 时只研究不超过该等级的科技
	researchMainOnly    bool    // 只推进主线科技（easy 少研究）
	researchTarget      string  // 主攻科技 ID（hard 优先冲这条链；空=按等级序）
	researchReserve     int     // 研究站矩阵库存低于该值就补料
	raidSupply          bool    // 进攻优先袭扰敌方补给站/弹药厂
	supportAt           int     // 兵力达到该数量后才配补给车
	heavyAt             int     // 兵力达到该数量后才补火炮/导弹车/维修车/无人机
	retreatBelowHP      float64 // 军团平均血量比低于该值即撤退（越高越谨慎）
	resupplyBelowAmmo   float64 // 军团平均弹药比低于该值即回补给站
}

// botCoalReserve 手搓期间背包煤低于该值就先去采煤（约够 300 点能量，足以完成一次采煤任务）。
const botCoalReserve = 16

func botTuningFor(difficulty string) botTuning {
	switch difficulty {
	case "easy":
		return botTuning{cadence: 60, maxCmds: 1, attackAt: 3, squadCap: 1, armyCap: 6, waveCooldown: 12000, minerTarget: 1, powerTarget: 2, assemblerTarget: 1, smelterTarget: 1, matrixMachineTarget: 1, craftBatch: 4, defendRadius: 42, mechaEvery: 8, mechaMinSoldiers: 6, turretCap: 1, turretThreat: 18, researchMaxLevel: 1, researchMainOnly: true, raidSupply: false, supportAt: 6, heavyAt: 10, retreatBelowHP: 0.25, resupplyBelowAmmo: 0.15}
	case "hard":
		return botTuning{cadence: 10, maxCmds: 3, attackAt: 14, squadCap: 4, armyCap: 22, waveCooldown: 2000, minerTarget: 3, powerTarget: 4, assemblerTarget: 4, smelterTarget: 3, matrixMachineTarget: 2, craftBatch: 10, defendRadius: 60, mechaEvery: 2, mechaMinSoldiers: 0, turretCap: 3, turretThreat: 66, researchMaxLevel: 0, researchMainOnly: false, researchTarget: "weapon_system", researchReserve: 40, raidSupply: true, supportAt: 3, heavyAt: 6, retreatBelowHP: 0.5, resupplyBelowAmmo: 0.4}
	default: // normal
		return botTuning{cadence: 30, maxCmds: 2, attackAt: 6, squadCap: 1, armyCap: 14, waveCooldown: 6000, minerTarget: 2, powerTarget: 3, assemblerTarget: 3, smelterTarget: 2, matrixMachineTarget: 1, craftBatch: 6, defendRadius: 48, mechaEvery: 4, mechaMinSoldiers: 3, turretCap: 2, turretThreat: 36, researchMaxLevel: 0, researchMainOnly: false, researchTarget: "weapon_system", researchReserve: 40, raidSupply: true, supportAt: 5, heavyAt: 7, retreatBelowHP: 0.4, resupplyBelowAmmo: 0.3}
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
		// 只判「有没有」，map 迭代顺序不影响结果。
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

// runBotBrain 一次 bot 决策：计划命令后走与玩家相同的队列。
func (gc *GameCore) runBotBrain(ws *model.WorldState, playerID string, tuning botTuning) {
	for _, cmd := range gc.planBotCommands(ws, playerID, tuning) {
		gc.botIssue(ws, playerID, cmd)
	}
}

// planBotCommands 决策纯函数：同一世界状态两次调用结果一致。
func (gc *GameCore) planBotCommands(ws *model.WorldState, playerID string, tuning botTuning) []model.Command {
	if gc == nil || ws == nil {
		return nil
	}
	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		return nil
	}
	ctx := gc.surveyBotWorld(ws, playerID)
	// 首攻门槛未开（BotFirstAttackTick 之前）：bot 只守不攻。这里在**决策输入**上
	// 关掉进攻——「远征目标」的来源（敌方玩家建筑）与「来袭敌情」（含敌建筑）
	// 一并清空，于是所有进攻出口（散兵 attack_move、军团 attack、编队）都无目标
	// 可打，而防区内的防守反击不受影响（见 botMayAdvanceTo 与 botLegions）。
	// 试玩 1015 §6-1：旧实现只有军团看门槛，散兵 attack_move 在首攻前就拆家；
	// 门槛只堵一条路径必然漏（1014 的 bug-1014-lost-first-attack 是同一根因面）。
	gc.applyBotOffenseGate(ws, ctx)
	if ctx.home == nil {
		return nil
	}
	cmds := make([]model.Command, 0, tuning.maxCmds)
	issue := func(cmd model.Command) bool {
		if len(cmds) >= tuning.maxCmds {
			return false
		}
		cmds = append(cmds, cmd)
		return true
	}

	// 按优先级逐项检查：每项最多一条命令，总量受 maxCmds 限制。
	gc.botMilitary(ws, playerID, tuning, ctx, issue)
	gc.botProduce(ws, playerID, tuning, ctx, issue)
	if !gc.botIndustry(ws, playerID, tuning, ctx, issue) {
		gc.botEconomy(ws, playerID, tuning, ctx, issue)
	}
	gc.botPower(ws, playerID, tuning, ctx, issue)
	gc.botMiners(ws, playerID, tuning, ctx, issue)
	gc.botAssembler(ws, playerID, tuning, ctx, issue)
	gc.botResearch(ws, playerID, tuning, ctx, issue)
	return cmds
}

// botSurvey 一次世界态势扫描（bot 的"眼睛"）。
type botSurvey struct {
	home         *model.Position
	executor     *model.Unit
	soldiers     []*model.Unit // 士兵与 mecha，按实体 ID 排序
	soldierCount int
	mechaCount   int
	buildings    []*model.Building
	powerCount   int
	minerCount   int
	turretCount  int
	labCount     int
	assemblers   []*model.Building
	producers    []*model.Building
	enemyPlayers map[string][]*model.Building
	nests        []*model.EnemyForce
	squads       []*model.CombatSquad // 己方军团，按 ID 排序
	loose        []*model.Unit        // 未编入军团的作战单位
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
			if botIsTurretType(b.Type) {
				survey.turretCount++
			}
			if b.Type == model.BuildingTypeMatrixLab || b.Type == model.BuildingTypeSelfEvolutionLab || isResearchLab(b) {
				survey.labCount++
			}
			def, ok := model.BuildingDefinitionByID(b.Type)
			if ok && def.CanProduceUnits {
				survey.producers = append(survey.producers, b)
			}
			if b.Runtime.Functions.Production != nil {
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
		switch u.Type {
		case model.UnitTypeSoldier:
			survey.soldierCount++
			survey.soldiers = append(survey.soldiers, u)
		case model.UnitTypeMecha:
			survey.mechaCount++
			survey.soldiers = append(survey.soldiers, u)
		default:
			if def, ok := model.UnitDefinitionByID(u.Type); ok && def.Public && u.Type != model.UnitTypeWorker {
				survey.soldiers = append(survey.soldiers, u)
			}
		}
	}
	if survey.home == nil && survey.executor != nil {
		pos := survey.executor.Position
		survey.home = &pos
	}
	for _, u := range survey.soldiers {
		if u.SquadID == "" {
			survey.loose = append(survey.loose, u)
		}
	}
	if ws.CombatRuntime != nil {
		for _, squad := range ws.CombatRuntime.Squads {
			if squad != nil && squad.OwnerID == playerID && squad.State != model.CombatSquadStateDestroyed {
				survey.squads = append(survey.squads, squad)
			}
		}
		sort.Slice(survey.squads, func(i, j int) bool { return survey.squads[i].ID < survey.squads[j].ID })
	}
	// bot 不主动招惹黑雾：只有黑雾已对 bot 敌对时，巢穴才算威胁/进攻目标。
	if ws.EnemyForces != nil && hostile(ws, playerID, model.DarkFogOwnerID) {
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

// botThreat 接近基地的敌情（单位/巢穴/小队）。
type botThreat struct {
	id   string
	kind string
	pos  model.Position
	dist int
}

// botMilitary 兵力管理：来袭回防优先，其次炮塔，再达标进攻。
func (gc *GameCore) botMilitary(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	scan := tuning.defendRadius
	if tuning.turretThreat > scan {
		scan = tuning.turretThreat
	}
	threats := botIncomingThreats(ws, playerID, *ctx.home, scan, ctx.nests)
	// 散兵的进攻移动也要过首攻门槛（试玩 1015 §6-1：旧实现只有军团看
	// BotFirstAttackTick，botRecallIDs 的 attack_move 不看，首攻前就能被派出去）。
	if ids, dest, ok := botRecallIDs(ws, ctx.loose, threats, tuning.defendRadius); ok &&
		gc.botMayAdvanceTo(ws, *ctx.home, dest, tuning.defendRadius) {
		pos := dest
		return issue(model.Command{
			Type:    model.CmdUnitOrder,
			Target:  model.CommandTarget{Layer: "planet", EntityIDs: ids, Position: &pos},
			Payload: map[string]any{"order": "attack_move"},
		})
	}
	if gc.botTurret(ws, playerID, tuning, ctx, threats, issue) {
		return true
	}
	return gc.botLegions(ws, playerID, tuning, ctx, threats, issue)
}

// botOffenseGateOpen 首攻门槛是否已开：BotFirstAttackTick 之前一律关闭
// （开局发育期只守不攻）。这是「门槛」的唯一定义处，进攻路径都从这里取。
func (gc *GameCore) botOffenseGateOpen(ws *model.WorldState) bool {
	if gc == nil || gc.cfg == nil || ws == nil {
		return true
	}
	return ws.Tick >= gc.cfg.Battlefield.BotFirstAttackTick
}

// botMayAdvanceTo 统一的进攻门控：门槛未开时，只有落在己方防区（home 为圆心、
// defendRadius 为半径）内的目标才算防守反击，防区外的进攻性移动一律不得下发。
// 散兵的 attack_move 与军团的 attack 都走这里——门槛只堵一条路径时，另一条
// 就能在首攻前拆家（试玩 1015 §6-1，1014 的 bug-1014-lost-first-attack 同一根因面）。
func (gc *GameCore) botMayAdvanceTo(ws *model.WorldState, home, target model.Position, defendRadius int) bool {
	if gc.botOffenseGateOpen(ws) {
		return true
	}
	return ws.SurfaceDistance(home, target) <= defendRadius
}

// applyBotOffenseGate 门槛未开时剥掉决策里的进攻输入（就地改 ctx）：
// 敌方玩家建筑是「远征目标」的唯一来源（botAttackObjective 的基地目标与
// raidSupply 的袭扰目标都从 enemyPlayers 取），清空它，进攻分支就没有目标可打。
// 防守输入（ctx.nests 与来袭单位）保持原样：防区内的防守反击不受门槛影响。
func (gc *GameCore) applyBotOffenseGate(ws *model.WorldState, ctx *botSurvey) {
	if gc.botOffenseGateOpen(ws) {
		return
	}
	ctx.enemyPlayers = nil
}

// botIncomingThreats 收集半径内的敌对单位（含已敌对的黑雾巢穴）。
// 排序：距离，然后实体 ID，再 kind。
func botIncomingThreats(ws *model.WorldState, playerID string, home model.Position, radius int, nests []*model.EnemyForce) []botThreat {
	if ws == nil || radius < 0 {
		return nil
	}
	threats := make([]botThreat, 0)
	unitIDs := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		unitIDs = append(unitIDs, id)
	}
	sort.Strings(unitIDs)
	for _, id := range unitIDs {
		u := ws.Units[id]
		if u == nil || u.HP <= 0 || u.OwnerID == playerID {
			continue
		}
		if !hostile(ws, playerID, u.OwnerID) {
			continue
		}
		d := ws.SurfaceDistance(u.Position, home)
		if d > radius {
			continue
		}
		threats = append(threats, botThreat{id: u.ID, kind: "unit", pos: u.Position, dist: d})
	}
	for _, nest := range nests {
		if nest == nil || nest.Strength <= 0 {
			continue
		}
		d := ws.SurfaceDistance(nest.Position, home)
		if d > radius {
			continue
		}
		threats = append(threats, botThreat{id: nest.ID, kind: "nest", pos: nest.Position, dist: d})
	}
	sort.Slice(threats, func(i, j int) bool {
		if threats[i].dist != threats[j].dist {
			return threats[i].dist < threats[j].dist
		}
		if threats[i].id != threats[j].id {
			return threats[i].id < threats[j].id
		}
		return threats[i].kind < threats[j].kind
	})
	return threats
}

// botRecallIDs 把尚未迎击最近威胁的部队拉回去。目标按距离然后 ID 已经排好。
func botRecallIDs(ws *model.WorldState, units []*model.Unit, threats []botThreat, defendRadius int) ([]string, model.Position, bool) {
	var dest model.Position
	found := false
	for _, threat := range threats {
		if threat.dist > defendRadius {
			continue
		}
		dest = threat.pos
		found = true
		break
	}
	if !found || len(units) == 0 {
		return nil, dest, false
	}
	ids := make([]string, 0, len(units))
	for _, u := range units {
		if ws.SurfaceDistance(u.Position, dest) <= 36 {
			continue
		}
		if u.Stance == model.UnitStanceAttackMove && u.OrderPos != nil && ws.SurfaceDistance(*u.OrderPos, dest) <= 3 {
			continue
		}
		ids = append(ids, u.ID)
	}
	if len(ids) == 0 {
		return nil, dest, false
	}
	return ids, dest, true
}

// botTurret 威胁接近且未达上限时，造已解锁、付得起、成本最低的炮塔。
func (gc *GameCore) botTurret(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, threats []botThreat, issue func(model.Command) bool) bool {
	if tuning.turretCap <= 0 || ctx.turretCount+botPendingTurrets(ws, playerID) >= tuning.turretCap {
		return false
	}
	closeEnough := false
	for _, threat := range threats {
		if threat.dist <= tuning.turretThreat {
			closeEnough = true
			break
		}
	}
	if !closeEnough {
		return false
	}
	player := ws.Players[playerID]
	btype, ok := botCheapestTurret(player, true)
	if !ok {
		return false
	}
	pos := botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, playerID, ctx), btype, playerID)
	if pos == nil {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: map[string]any{"building_type": string(btype)},
	})
}

// botCheapestTurret 目录里可建、已解锁的炮塔；requireAfford 时还要付得起。平局取 ID 较小者。
func botCheapestTurret(player *model.PlayerState, requireAfford bool) (model.BuildingType, bool) {
	bestScore := -1
	var best model.BuildingType
	for _, def := range model.AllBuildingDefinitions() {
		if !def.Buildable || !botIsTurretType(def.ID) {
			continue
		}
		if !CanBuildTech(player, model.TechUnlockBuilding, string(def.ID)) {
			continue
		}
		if requireAfford && !botCanAffordBuild(player, def) {
			continue
		}
		// 第 16 轮起成本只有物品：按物品总件数排序（越便宜越优先）。
		score := 0
		for _, item := range def.BuildCost.Items {
			score += item.Quantity
		}
		if bestScore < 0 || score < bestScore || (score == bestScore && def.ID < best) {
			bestScore = score
			best = def.ID
		}
	}
	return best, bestScore >= 0
}

func botIsTurretType(btype model.BuildingType) bool {
	profile := model.BuildingProfileFor(btype, 1)
	combat := profile.Runtime.Functions.Combat
	return combat != nil && combat.Attack > 0
}

func botPendingTurrets(ws *model.WorldState, playerID string) int {
	if ws == nil || ws.Construction == nil {
		return 0
	}
	n := 0
	ids := make([]string, 0, len(ws.Construction.Tasks))
	for id := range ws.Construction.Tasks {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		task := ws.Construction.Tasks[id]
		if task == nil || task.PlayerID != playerID {
			continue
		}
		if task.State == model.ConstructionCancelled || task.State == model.ConstructionCompleted {
			continue
		}
		if botIsTurretType(task.BuildingType) {
			n++
		}
	}
	return n
}

func botPendingBuilds(ws *model.WorldState, playerID string, btype model.BuildingType) int {
	if ws == nil || ws.Construction == nil {
		return 0
	}
	n := 0
	ids := make([]string, 0, len(ws.Construction.Tasks))
	for id := range ws.Construction.Tasks {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		task := ws.Construction.Tasks[id]
		if task == nil || task.PlayerID != playerID || task.BuildingType != btype {
			continue
		}
		if task.State == model.ConstructionCancelled || task.State == model.ConstructionCompleted {
			continue
		}
		n++
	}
	return n
}

// botFloodSlack 进攻目标连通洪泛相对"最近敌方基地质心"的额外余量（cell）：
// 目标是基地外圈的落点，比质心还要远一个基地半径（37 座建筑铺开约 30 cell），
// 再留一点球面绕行的余量。实测（skirmish-seed-001，质心距 177 cell）：
// slack 40 → 8.6 万格 / 15ms，slack 120 → 14 万格 / 17ms，无上限 → 38 万格 / 100ms。
const botFloodSlack = 64

// botAttackObjective 进攻目标：优先最近的敌方玩家建筑中心，其次最近的（已敌对的）黑雾巢穴。
// 距离相同时按玩家 ID / 巢穴 ID 取较小者。
func (gc *GameCore) botAttackObjective(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey) *model.Position {
	if tuning.raidSupply {
		// 袭扰：断掉对方前线的补给比强攻基地更划算；攻击移动本身也会优先打补给设施。
		// 只挑走得到的：目标在孤岛/被切断时军团会白跑一趟（试玩报告 C/G2 的教训）。
		if raid := botNearestEnemySupply(ws, *ctx.home, ctx); raid != nil {
			return raid
		}
	}
	bestDist := -1
	bestOwner := ""
	var best *model.Position
	owners := make([]string, 0, len(ctx.enemyPlayers))
	for owner := range ctx.enemyPlayers {
		owners = append(owners, owner)
	}
	sort.Strings(owners)
	// 先把敌方基地按"到出发点"的直线距离排序，取最近一座的距离作为洪泛上限。
	// 连通判定只需要回答"最近的这座基地够不够得着"，没必要把整张图都洪泛一遍：
	// 细分网格后一张 864×576 的图有 49.8 万格，无上限的一次洪泛实测 100ms
	// （整局 8 个 >100ms 的 tick 全出在这里）；按最近基地的距离封顶后洪泛只
	// 覆盖 ~6 万格、单次 ~15ms。更远的敌方基地直接判为够不着——bot 只打最近的
	// 那座，够不着最近的基地时去打更远的没有意义。
	from := *ctx.home
	if ctx.executor != nil {
		from = ctx.executor.Position
	}
	type enemyBase struct {
		owner  string
		center model.Position
		dist   int
	}
	bases := make([]enemyBase, 0, len(owners))
	for _, owner := range owners {
		buildings := ctx.enemyPlayers[owner]
		if len(buildings) == 0 {
			continue
		}
		center := buildingCentroid(ws, buildings)
		bases = append(bases, enemyBase{owner: owner, center: center, dist: ws.SurfaceDistance(from, center)})
	}
	limit := 0
	for _, b := range bases {
		if limit == 0 || b.dist < limit {
			limit = b.dist
		}
	}
	limit += botFloodSlack
	floodReady := false
	// 只做**一次**连通洪泛，本拍内所有"目标格走不走得到"都按它判定。
	// 旧实现每座敌建筑一次 pocketReach（质心 + 逐个外圈格），37 座建筑 × 17 格
	// 全都要走满 4000 格预算时单拍 400ms+（实测 tick 13998 = 219ms）。
	reachable := func(pos model.Position) bool {
		if !ws.InBounds(from.X, from.Y) || !ws.InBounds(pos.X, pos.Y) {
			return false
		}
		if ws.SurfaceDistance(from, pos) > limit {
			return false
		}
		if !floodReady {
			pathFlood(ws, from, "", false, limit+botFloodSlack, nil)
			floodReady = true
		}
		return floodVisited(ws, int32(pos.Y*ws.MapWidth+pos.X))
	}
	for _, base := range bases {
		owner, center := base.owner, base.center
		// 目标点必须"走得过去"：基地中心通常是某座建筑占地的中心格（多格占地后
		// 建筑变密，37 座建筑的质心必落在占地里），而连通判定只认空着的目标格，
		// 于是质心永远不可达、bot 整局选不出进攻目标（实测首攻 tick=-1、逼近=0）。
		// 质心走不到时退到"最近的、外圈有可达空格的建筑"——攻击目标仍是这座基地，
		// 只是落点取基地外圈能站人的地方。
		if !reachable(center) {
			alt := botReachableBuildingObjective(ws, center, ctx.enemyPlayers[owner], reachable)
			if alt == nil {
				continue
			}
			center = *alt
		}
		d := ws.SurfaceDistance(*ctx.home, center)
		if bestDist < 0 || d < bestDist || (d == bestDist && (bestOwner == "" || owner < bestOwner)) {
			c := center
			best = &c
			bestDist = d
			bestOwner = owner
		}
	}
	if best != nil {
		return best
	}
	bestNest := ""
	for _, nest := range ctx.nests {
		if nest == nil {
			continue
		}
		if !gc.botTargetReachable(ws, *ctx.home, nest.Position, ctx) {
			continue
		}
		d := ws.SurfaceDistance(*ctx.home, nest.Position)
		if bestDist < 0 || d < bestDist || (d == bestDist && (bestNest == "" || nest.ID < bestNest)) {
			pos := nest.Position
			best = &pos
			bestDist = d
			bestNest = nest.ID
		}
	}
	return best
}

// botReachableBuildingObjective 在敌方建筑里挑一座「外圈有可达空格」的，
// 返回那个空格作为进攻落点（多格占地后基地中心常落在占地内、走不进去）。
// 建筑按到基地的距离排序，取最近的一座。reachable 由调用方给出：它背后是
// 一次按拍缓存的连通洪泛（见 botAttackObjective），本函数不再自己洪泛。
func botReachableBuildingObjective(ws *model.WorldState, home model.Position, buildings []*model.Building, reachable func(model.Position) bool) *model.Position {
	if ws == nil || len(buildings) == 0 {
		return nil
	}
	sorted := make([]*model.Building, 0, len(buildings))
	for _, b := range buildings {
		if b != nil && b.HP > 0 {
			sorted = append(sorted, b)
		}
	}
	sort.Slice(sorted, func(i, j int) bool {
		di, dj := ws.SurfaceDistance(home, sorted[i].Position), ws.SurfaceDistance(home, sorted[j].Position)
		if di != dj {
			return di < dj
		}
		return sorted[i].ID < sorted[j].ID
	})
	for _, b := range sorted {
		ring, err := ws.BuildingRingCells(b)
		if err != nil {
			continue
		}
		for _, cell := range ring {
			if !ws.InBounds(cell.X, cell.Y) {
				continue
			}
			if ws.TileBuilding[model.TileKey(cell.X, cell.Y)] != "" || !ws.Grid[cell.Y][cell.X].Terrain.Buildable() {
				continue
			}
			if reachable(cell) {
				c := cell
				return &c
			}
		}
	}
	return nil
}

// botTargetReachable 目标是否走得到：预算内从 bot 执行体（缺省用基地）做一次
// 连通区检查。走不到的目标直接跳过，bot 不会无限重复下令去打一个到不了的地方
// （试玩报告 C/G2：玩家在孤岛上，bot 军团不该反复空跑）；结果按 tick 缓存，
// 避免每拍都为同一目标重复洪泛。
func (gc *GameCore) botTargetReachable(ws *model.WorldState, home, target model.Position, ctx *botSurvey) bool {
	if ws == nil {
		return false
	}
	key := model.TileKey(target.X, target.Y)
	if gc.botReachCacheTick != ws.Tick || gc.botReachCache == nil {
		gc.botReachCache = make(map[string]bool, 8)
		gc.botReachCacheTick = ws.Tick
	} else if v, ok := gc.botReachCache[key]; ok {
		return v
	}
	from := home
	if ctx != nil && ctx.executor != nil {
		from = ctx.executor.Position
	}
	ok := false
	if ws.InBounds(from.X, from.Y) {
		ok = pocketReach(ws, from, target, nil)
	}
	gc.botReachCache[key] = ok
	return ok
}

// botNearestEnemySupply 距离最近的敌方补给站/弹药厂（同距按建筑 ID）。
func botNearestEnemySupply(ws *model.WorldState, from model.Position, ctx *botSurvey) *model.Position {
	var best *model.Building
	bestDist := 0
	for _, buildings := range ctx.enemyPlayers {
		for _, b := range buildings {
			if !militarySupplyTarget(b) {
				continue
			}
			d := ws.SurfaceDistance(from, b.Position)
			if best == nil || d < bestDist || (d == bestDist && b.ID < best.ID) {
				best, bestDist = b, d
			}
		}
	}
	if best == nil {
		return nil
	}
	pos := best.Position
	return &pos
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
	if job := exec.Mecha.Job; job != nil {
		// 手搓链耗煤快于回补：煤将尽时打断手搓去采煤。否则能量归零后连采煤都做不了，
		// 执行体永久卡在 no_energy（遭遇战 bot 曾因此在开局 3 分钟后再无建设）。
		if job.Kind == "craft" && player.Inventory[model.ItemCoal] < botCoalReserve {
			return issue(model.Command{
				Type:   model.CmdCancelMechaJob,
				Target: model.CommandTarget{Layer: "planet", EntityID: exec.ID},
			})
		}
		// 采集作业因离矿点太远而停摆（例如被挤走/目标失效）：取消后下一拍
		// 会先移动再开矿，否则执行体永远钉在 out_of_range、bot 全线停摆
		// （试玩报告 D：bot 的机甲在 tick 20000 后一直不动）。
		if job.Kind == "mine" && job.State == "out_of_range" {
			return issue(model.Command{
				Type:   model.CmdCancelMechaJob,
				Target: model.CommandTarget{Layer: "planet", EntityID: exec.ID},
			})
		}
		return false
	}
	// 缺料清单：当前建设目标所需物品。
	missing := gc.botMaterialNeeds(ws, playerID, tuning, ctx)
	// 燃料不多：提前采煤（手搓链随时会饿死在半路）。
	if player.Inventory[model.ItemCoal] < 40 {
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
	// 必须设上限：无限"备用采煤"会把机甲 200 格背包塞满煤，
	// 之后所有物品转移都报「背包已满」，矩阵链/研究站供料全线卡死
	// （试玩报告 D：bot 的电磁学在 tick 20000 后不再推进）。
	if player.Inventory[model.ItemCoal] < botSpareCoalCap && botInventoryHasRoom(player, ctx.executor) {
		if cmd, ok := gc.botMineKind(ws, playerID, exec, model.ItemCoal, ctx); ok {
			return issue(cmd)
		}
	}
	if botInventoryHasRoom(player, ctx.executor) {
		if cmd, ok := gc.botMineKind(ws, playerID, exec, model.ItemIronOre, ctx); ok {
			return issue(cmd)
		}
	}
	return false
}

// botSpareCoalCap 备用采煤的库存上限（块）：够长期手搓与补能即可。
const botSpareCoalCap = 80

// botInventoryHasRoom 机甲背包是否还有余量（留 1/4 空间给其它物料）。
func botInventoryHasRoom(player *model.PlayerState, exec *model.Unit) bool {
	if player == nil || exec == nil || exec.Mecha == nil || exec.Mecha.InventoryCapacity <= 0 {
		return true
	}
	return player.InventoryCount() < exec.Mecha.InventoryCapacity*3/4
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
	if ctx.labCount == 0 && botPendingBuilds(ws, playerID, model.BuildingTypeMatrixLab) == 0 {
		if missing := need(model.BuildingTypeMatrixLab); len(missing) > 0 {
			return missing
		}
	}
	if botWantsTurret(ws, playerID, tuning, ctx) {
		if btype, ok := botCheapestTurret(player, false); ok {
			if missing := need(btype); len(missing) > 0 {
				return missing
			}
		}
	}
	return nil
}

func botWantsTurret(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey) bool {
	if ctx == nil || ctx.home == nil || tuning.turretCap <= 0 {
		return false
	}
	if ctx.turretCount+botPendingTurrets(ws, playerID) >= tuning.turretCap {
		return false
	}
	threats := botIncomingThreats(ws, playerID, *ctx.home, tuning.turretThreat, ctx.nests)
	return len(threats) > 0
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
	case model.ItemGlass:
		// 玻璃是研究站建造成本里的关键一环；不在手搓链里时 bot 会一直
		// 缺玻璃、建不出研究站、整局不研究（试玩报告 D）。
		return "glass", []model.ItemAmount{{ItemID: model.ItemStoneOre, Quantity: 2}}
	case model.ItemStoneBrick:
		return "smelt_stone", []model.ItemAmount{{ItemID: model.ItemStoneOre, Quantity: 1}}
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
		// 够一份配方才算备齐：magnet 只有 1、磁线圈要 2 时也得继续搓（曾因 >0 判定卡死在采铁矿）。
		if player.Inventory[ing.ItemID] >= ing.Quantity {
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
// 复合物品（如电路板 = 铁锭 + 铜锭）要沿手搓链找到背包里真正不足的那种原矿，
// 否则会一直采同一种矿（遭遇战 bot 曾因此把铜矿采到 2770 却没有铁）。
func (gc *GameCore) botMineFor(ws *model.WorldState, playerID string, exec *model.Unit, missingItem string, ctx *botSurvey) (model.Command, bool) {
	oreKind := botRawOreFor(ws.Players[playerID].Inventory, missingItem)
	if oreKind == "" {
		oreKind = model.ItemIronOre
	}
	return gc.botMineKind(ws, playerID, exec, oreKind, ctx)
}

// botRawOreFor 沿手搓链找出制造 itemID 时背包里首个不足的原矿；链上原料都够则返回空。
// 认任何"可直接开采的固体原矿"（iron_ore / copper_ore / stone_ore / coal…），
// 否则玻璃（石矿）这类新入链的物品会被当成无矿可采、退回去采铁
// （试玩报告 D：bot 缺玻璃建不出研究站）。
func botRawOreFor(inv model.ItemInventory, itemID string) string {
	recipeID, ingredients := botCraftChain(itemID)
	if recipeID == "" {
		if isManuallyMinableOre(itemID) {
			return itemID
		}
		return ""
	}
	for _, ing := range ingredients {
		if inv[ing.ItemID] >= ing.Quantity {
			continue
		}
		if ore := botRawOreFor(inv, ing.ItemID); ore != "" {
			return ore
		}
	}
	return ""
}

// isManuallyMinableOre 该物品是否是可直接开采的固体原矿（机甲手采口径）。
func isManuallyMinableOre(itemID string) bool {
	def, ok := model.Item(itemID)
	return ok && def.Form == model.ResourceSolid && def.Category == model.ItemCategoryOre
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
	if ws.SurfaceDistance(exec.Position, node.Position) > 6 {
		// 先移动到矿点邻格。
		dest := botAdjacentFreeTile(ws, node.Position, exec.ID)
		if dest == nil {
			return model.Command{}, false
		}
		path, reachable := computeUnitPath(ws, exec.Position, *dest, exec.ID)
		if !reachable || len(path) < 2 {
			return model.Command{}, false
		}
		// 移动不再受 move_range 限制：直接下达完整路径，实时移动逐 tick 走完。
		step := path[len(path)-1]
		return model.Command{
			Type:   model.CmdMove,
			Target: model.CommandTarget{Layer: "planet", EntityID: exec.ID, Position: &step},
		}, true
	}
	// 一次开采量受背包剩余空间限制：请求量超过空位会让作业停在
	// inventory_full 等玩家腾位置，而 bot 腾不出空位就整局停摆
	// （背包上限成为硬约束后暴露：新开局只有 200 格，采 20 个往往放不下）。
	quantity := min(20, mechaInventoryFree(ws.Players[playerID], mechaInventoryCapacity(ws, exec, ws.Players[playerID]), 20))
	if quantity <= 0 {
		return model.Command{}, false
	}
	return model.Command{
		Type:    model.CmdMineResource,
		Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
		Payload: map[string]any{"resource_id": node.ID, "quantity": quantity},
	}, true
}

// botNearestNode 最近的未枯竭指定矿种节点。距离相同取较小 ID。
func botNearestNode(ws *model.WorldState, from model.Position, kind string) *model.ResourceNodeState {
	var best *model.ResourceNodeState
	bestDist := -1
	ids := make([]string, 0, len(ws.Resources))
	for id := range ws.Resources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		node := ws.Resources[id]
		if node == nil || node.Kind != kind || node.Remaining <= 0 || node.Depleted {
			continue
		}
		// 先用带上限的判定剪掉比当前最优更远的矿点：全图几百个矿点逐个算
		// 无上限的跨面距离（每次一个小 A*）曾让一次 bot 决策耗时 25ms。
		if bestDist >= 0 && !ws.SurfaceWithin(from, node.Position, bestDist) {
			continue
		}
		d := ws.SurfaceDistance(from, node.Position)
		if bestDist < 0 || d < bestDist || (d == bestDist && (best == nil || node.ID < best.ID)) {
			best = node
			bestDist = d
		}
	}
	return best
}

// botAdjacentFreeTile 目标格附近的可站立格（细分网格下搜索半径 ×3）。
func botAdjacentFreeTile(ws *model.WorldState, center model.Position, selfID string) *model.Position {
	for _, candidate := range ws.SurfaceDisc(center, 18) {
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

// botPower 电力建设：发电建筑不足，或有带电接口的建筑长期断电时补风机。
//
// 只数"已建成"的发电建筑是不够的：电网里发电量够了，但一座建在电网外的
// 用电建筑（电弧熔炉）会长期 no_power，而 bot 看发电数已达标就再也不补电——
// 试玩节奏下 easy bot 的电弧熔炉 tick 25000 起一直断电，矩阵链整局 0 产出。
// 因此只要还有**带供电接口**的建筑拿不到电，就继续补风机；材料不足时走
// botEnsureBuilding 的缺料链（铁块/齿轮/磁线圈都能手搓）。
//
// 选址：补的风机必须落进"己方已带电电网"的无线覆盖内。细分网格后
// botBuildSpotNear 从半径 9 起扫，风机（2×2）会落在 HQ 的电感应塔覆盖（12）之外，
// 发出来的电送不进电网 → HQ 长期 no_power → starved 恒真 → bot 无限补风机
// （实测旧局 332 座风机、能源池归零，而电网里始终 0 供电）。
func (gc *GameCore) botPower(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	starved := false
	for _, b := range ctx.buildings {
		if b.Runtime.State != model.BuildingWorkNoPower || b.Type == model.BuildingTypeWindTurbine {
			continue
		}
		for _, cp := range b.Runtime.Params.ConnectionPoints {
			if cp.Kind == model.ConnectionPower {
				starved = true
				break
			}
		}
		if starved {
			break
		}
	}
	if ctx.powerCount >= tuning.powerTarget && !starved {
		return false
	}
	pos := gc.botPoweredSpot(ws, playerID, ctx, model.BuildingTypeWindTurbine)
	if pos == nil {
		return false
	}
	if cmd, ok := gc.botEnsureBuildingAt(ws, playerID, ctx, model.BuildingTypeWindTurbine, "", map[string]bool{}, pos); ok {
		return issue(cmd)
	}
	return false
}

// botPoweredSpot 在"己方已带电电网"的无线覆盖内选一格可建位：覆盖内没有可建位时
// 返回 nil，宁可不补也不要发一座电送不出去的风机（否则 starved 恒真、无限补电）。
//
// 只在覆盖圈（电感应塔 12 / 无线输电塔 18 / 卫星配电站 30）内挑格子，不走
// botBuildSpotNear 的大半径扫描：后者从半径 9 扫到建造半径 72，逐锚点各扫一遍
// 会让单拍 bot 决策变成 anchors×（半径² 的 SurfaceDisc），实测 37 座建筑时单拍
// 400ms+（整局回归因此出现上百个 >100ms 的 tick）。
func (gc *GameCore) botPoweredSpot(ws *model.WorldState, owner string, ctx *botSurvey, btype model.BuildingType) *model.Position {
	if ws == nil || ctx == nil || ctx.home == nil {
		return nil
	}
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return nil
	}
	footprint := model.RotatedFootprint(def.Footprint, model.PlanRotation0)

	powered := botPoweredGrid(ws, ctx)
	anchors := make([]*model.Building, 0, len(ctx.buildings))
	for _, b := range ctx.buildings {
		if b != nil && powered[b.ID] {
			anchors = append(anchors, b)
		}
	}
	if len(anchors) == 0 {
		// 电网里还没有发电建筑（第一座风机）：仍按常规选址贴基地建，
		// 它的供电接口在电感应塔无线范围内就能把电送进电网。
		return botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, owner, ctx), btype, owner)
	}
	sort.Slice(anchors, func(i, j int) bool {
		di, dj := ws.SurfaceDistance(*ctx.home, anchors[i].Position), ws.SurfaceDistance(*ctx.home, anchors[j].Position)
		if di != dj {
			return di < dj
		}
		return anchors[i].ID < anchors[j].ID
	})

	// 候选 = 各带电锚点无线覆盖圈的并集。逐锚点分别扫描再挑最近会让单拍决策变成
	// anchors×（Disc(cover) 的排序与距离计算）；这里先把并集去重成一张候选表，
	// 对每个候选只算一次到基地的球面距离，再按距离排序逐格校验（实测锚点多时
	// 单拍 400ms+ → 每拍 ≤ 2 万次距离计算）。
	seen := make(map[model.Position]struct{})
	candidates := make([]model.Position, 0, 256)
	for _, anchor := range anchors {
		cover := model.DefaultPowerLineRange
		if runtimeDef, ok := model.BuildingRuntimeDefinitionByID(anchor.Type); ok && runtimeDef.Functions.PowerGrid != nil {
			cover = runtimeDef.Functions.PowerGrid.WirelessRange
		}
		for _, tile := range ws.SurfaceDisc(anchor.Position, cover) {
			if !ws.InBounds(tile.X, tile.Y) {
				continue
			}
			if _, ok := seen[tile]; ok {
				continue
			}
			seen[tile] = struct{}{}
			candidates = append(candidates, tile)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		di, dj := ws.SurfaceDistance(*ctx.home, candidates[i]), ws.SurfaceDistance(*ctx.home, candidates[j])
		if di != dj {
			return di < dj
		}
		if candidates[i].Y != candidates[j].Y {
			return candidates[i].Y < candidates[j].Y
		}
		return candidates[i].X < candidates[j].X
	})
	for _, candidate := range candidates {
		if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
			continue
		}
		if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
			continue
		}
		if ws.Construction != nil && ws.Construction.IsTileReserved(model.TileKey(candidate.X, candidate.Y)) {
			continue
		}
		if !ws.FootprintFits(candidate, footprint, btype, "") {
			continue
		}
		if buildingEnclosure(ws, btype, model.PlanRotation0, candidate) != nil {
			continue
		}
		// 占地同样不能罩住自家地面单位（与 botBuildSpotNear 同一口径）。
		if spotCoversGroundUnit(ws, candidate, footprint, owner) {
			continue
		}
		c := candidate
		return &c
	}
	return nil
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
	if !botCanAffordBuild(player, def) {
		return false
	}
	// 找一台附近没有己方矿机的矿点（必须在建造可达范围内：基地半径或执行体操作范围）。
	execRange := 18
	if ctx.executor != nil {
		if execState := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID); execState != nil {
			execRange = execState.OperateRange
		}
	}
	// 候选矿点按「先近后远、矿种按 铁→铜→煤→石」排序（同类同距再按 ID 字典序，
	// 保证可复现）。旧实现按节点 ID 字典序取第一个候选：基地旁的开局补矿簇 ID 形如
	// `res-4`，字典序排在最后，而远处大矿簇 ID 形如 `planet-1-1-res-1843` 排在前面，
	// 于是矿机被丢到 24 格外的远矿点上——见下面的选址注释。
	//
	// 距离优先还让开局矿机落在基地旁的开局补矿簇上（地图生成时放在 HQ 边上、
	// 天然接进基地电网），不必先拉一串电塔；矿机产出的矿石实物由传送带/分拣器
	// 送进熔炉，成为后续建造的料。
	kindRank := map[string]int{
		model.ItemIronOre:   0,
		model.ItemCopperOre: 1,
		model.ItemCoal:      2,
		model.ItemStoneOre:  3,
	}
	type minerCandidate struct {
		kind string
		dist int
		id   string
		node *model.ResourceNodeState
	}
	// 候选先用**带上限**的 SurfaceWithin 预筛，再对幸存者算精确距离：
	// 全图有上万个矿点 cell，逐个算无上限的跨面 A* 距离在 face 288 上要 ~200ms
	// （实测：11050 个矿点 198ms），而带上限的判定只要 15ms。预筛半径取
	// 「基地半径 72 + 基地到执行体的距离 + 执行体操作范围」：三角形不等式保证
	// 被滤掉的矿点既超出基地半径、也超出执行体操作范围，不可能进入 inRange。
	prefilter := 72 + execRange
	if ctx.executor != nil {
		prefilter += ws.SurfaceDistance(*ctx.home, ctx.executor.Position)
	}
	candidates := make([]minerCandidate, 0, 64)
	for id, node := range ws.Resources {
		if node == nil || node.Remaining <= 0 || node.Depleted {
			continue
		}
		if _, ok := kindRank[node.Kind]; !ok {
			continue
		}
		if !ws.SurfaceWithin(*ctx.home, node.Position, prefilter) {
			continue
		}
		candidates = append(candidates, minerCandidate{
			kind: node.Kind,
			dist: ws.SurfaceDistance(*ctx.home, node.Position),
			id:   id,
			node: node,
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		ri, rj := kindRank[candidates[i].kind], kindRank[candidates[j].kind]
		if ri != rj {
			return ri < rj
		}
		if candidates[i].dist != candidates[j].dist {
			return candidates[i].dist < candidates[j].dist
		}
		return candidates[i].id < candidates[j].id
	})
	var fallback *model.Position
	for _, cand := range candidates {
		node := cand.node
		homeDist := cand.dist
		inRange := homeDist <= 72
		if !inRange && ctx.executor != nil && ws.SurfaceDistance(ctx.executor.Position, node.Position) <= execRange {
			inRange = true
		}
		if !inRange {
			continue
		}
		// 建造半径 ≠ 电力半径：矿机只有 line 接口，落在电塔无线覆盖之外会一直
		// no_power 就完全不产矿，只能靠 botPowerLink 一座座塔
		// 拉过去。这里**不能**直接跳过够不着的矿点：botIndustry 在
		// `minerCount < minerTarget` 时提前返回，而 botPowerLink 就在 botIndustry
		// 里——跳过会让「没矿机 → 不拉线 → 永远够不着 → 没矿机」死锁
		// （实测 seed 001 上 p2 冻结在 tick 9000：矿物 10000 却一座塔都不建）。
		// 因此仍然选最近的矿点建机，由 botPowerLink 负责把电网推过去。
		covered := false
		for _, b := range ctx.buildings {
			if isMinerBuilding(b) && ws.SurfaceDistance(b.Position, node.Position) <= 12 {
				covered = true
				break
			}
		}
		if covered {
			continue
		}
		// 复用与 execBuild 相同的围死校验：矿机同样不能把基地封死
		// （试玩报告 1010 阻断 A 的修法——否则 bot 会反复发注定被拒的建造命令，
		// 整局卡在"矿机建不起来"上）。
		// 细分网格：矿机是 3×3 占地，矿点格本身空着不代表放得下——开局 HQ（5×5）
		// 与风机（2×2）就压在矿脉边上，按矿点格下锚点会被"占地重叠"拒绝（实测
		// 开局链第一台矿机被拒 83–112 次，整局卡死在"没矿机"）。这里按与 execBuild
		// 相同的整块落位求锚点，并确认锚点仍覆盖这个矿点。
		def, ok := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
		if !ok {
			return false
		}
		fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
		origin, ok := ws.FindFootprintOrigin(node.Position, fp, model.BuildingTypeMiningMachine, "")
		if !ok || !ws.FootprintFits(origin, fp, model.BuildingTypeMiningMachine, "") {
			continue
		}
		if model.ValidateCollectorSite(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, origin) != nil {
			continue
		}
		if buildingEnclosure(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, origin) != nil {
			continue
		}
		// 占地里不能站着自家地面单位（落成时会被推到占地外，但选点就该避开）。
		if spotCoversGroundUnit(ws, origin, fp, playerID) {
			continue
		}
		// 矿机只采一种矿（DSP 口径，试玩 1016 报告 B2）：落点覆盖框里矿种最多的
		// 那种才是实际产出。落点覆盖框里最多的不是候选矿种时（混合矿簇），先记下
		// 这个兜底落点、继续找真正能采到目标矿的位置；全都找不到才用它，保证
		// bot 不会因为「找不到纯矿落点」而永远建不出矿机。
		mined := model.MiningItemAt(ws, model.BuildingTypeMiningMachine, model.PlanRotation0, origin)
		if mined == node.Kind {
			return issue(model.Command{
				Type:    model.CmdBuild,
				Target:  model.CommandTarget{Layer: "planet", Position: &origin},
				Payload: map[string]any{"building_type": string(model.BuildingTypeMiningMachine)},
			})
		}
		// 兜底落点：优先「这台矿机会采目标矿种」的落点（哪怕它离候选矿点远一点），
		// 只有在完全找不到时（覆盖框里根本没有该矿种）才退而求其次。
		// 判据必须是「落点采到的 == 目标矿」，不能只看覆盖框里有没有该矿种：
		// 混合矿簇里矿机按平票规则可能选中另一种矿，矿机就成了永远产错矿的死资产
		// （实测 pt1010 局：p2 三台矿机里两台卡在采不到铁，整局产线停摆）。
		if mined != "" && fallback == nil {
			fallback = &origin
		}
	}
	if fallback != nil {
		return issue(model.Command{
			Type:    model.CmdBuild,
			Target:  model.CommandTarget{Layer: "planet", Position: fallback},
			Payload: map[string]any{"building_type": string(model.BuildingTypeMiningMachine)},
		})
	}
	return false
}

// botWirelessRange 建筑的无线送电半径（0 = 不是无线电网节点，只能贴线连接）。
func botWirelessRange(b *model.Building) int {
	if b == nil || b.Runtime.Functions.PowerGrid == nil {
		return 0
	}
	return b.Runtime.Functions.PowerGrid.WirelessRange
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
	if !botCanAffordBuild(player, def) {
		return false
	}
	pos := botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, playerID, ctx), model.BuildingTypeAssemblingMachineMk1, playerID)
	if pos == nil {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: map[string]any{"building_type": string(model.BuildingTypeAssemblingMachineMk1)},
	})
}

// botSmelterRecipes 冶炼产线的配方顺序：铁→铜→磁铁→石材。
var botSmelterRecipes = []string{"smelt_iron", "smelt_copper", "smelt_magnet", "smelt_stone"}

// botResearch 有研究站就开一条付得起矩阵的科技；没有就建矩阵研究站。
// 缺矩阵会失败的研究本决策直接跳过，不空转同一条命令。
func (gc *GameCore) botResearch(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	hasLab := ctx.labCount > 0 ||
		botPendingBuilds(ws, playerID, model.BuildingTypeMatrixLab) > 0 ||
		botPendingBuilds(ws, playerID, model.BuildingTypeSelfEvolutionLab) > 0
	if !hasLab {
		return gc.botBuildLab(ws, playerID, ctx, issue)
	}
	techID, ok := gc.botNextResearchTech(ws.Players[playerID], tuning)
	if !ok {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": techID},
	})
}
func (gc *GameCore) botBuildLab(ws *model.WorldState, playerID string, ctx *botSurvey, issue func(model.Command) bool) bool {
	player := ws.Players[playerID]
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeMatrixLab)
	if !ok || !def.Buildable || !CanBuildTech(player, model.TechUnlockBuilding, string(def.ID)) {
		return false
	}
	if !botCanAffordBuild(player, def) {
		return false
	}
	pos := botBuildSpotNear(ws, *ctx.home, botConstructRadius(ws, playerID, ctx), model.BuildingTypeMatrixLab, playerID)
	if pos == nil {
		return false
	}
	return issue(model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: map[string]any{"building_type": string(model.BuildingTypeMatrixLab)},
	})
}

// botNextResearchTech 选一条前置已解锁、研究站里已有成本物品的科技。
// 备料按本局 pace_research 缩放后的实际成本判断，与结算一致。
// 有 researchTarget（如 weapon_system）时优先沿该科技的前置链推进，
// 避免 bot 在电磁学上把所有矩阵烧光、整局拿不到武器/炮塔；否则按等级、ID 顺序。
func (gc *GameCore) botNextResearchTech(player *model.PlayerState, tuning botTuning) (string, bool) {
	if player == nil || player.Tech == nil || player.Tech.CurrentResearch != nil {
		return "", false
	}
	queued := make(map[string]bool)
	for _, research := range player.Tech.ResearchQueue {
		if research != nil && research.State == model.ResearchPending {
			queued[research.TechID] = true
		}
	}
	labs := runningResearchLabs(gc.worlds, player.PlayerID)
	if len(labs) == 0 {
		return "", false
	}
	storageOf := researchLabStorageResolver(gc.worlds, labs)
	candidates := botResearchCandidates(tuning)
	for _, def := range candidates {
		if def == nil || def.Hidden || queued[def.ID] {
			continue
		}
		if tuning.researchMainOnly && def.Category != model.TechCategoryMain {
			continue
		}
		if tuning.researchMaxLevel > 0 && def.Level > tuning.researchMaxLevel {
			continue
		}
		if !player.Tech.HasPrerequisites(def) {
			continue
		}
		if def.MaxLevel == 0 {
			if player.Tech.HasTech(def.ID) {
				continue
			}
		} else if def.MaxLevel > 0 && player.Tech.CompletedTechs[def.ID] >= def.MaxLevel {
			continue
		}
		cost := model.ScaledResearchCost(def.CostForLevel(player.Tech.CompletedTechs[def.ID]+1), player.Tech.ResearchPace)
		if !botLabsCoverCost(labs, cost, storageOf) {
			continue
		}
		return def.ID, true
	}
	return "", false
}

// botResearchCandidates 研究候选顺序：先按 researchTarget 的前置链推进，
// 链上科技全部完成后回到目录默认顺序（等级、ID）。
func botResearchCandidates(tuning botTuning) []*model.TechDefinition {
	all := model.AllTechDefinitions()
	if tuning.researchTarget == "" {
		return all
	}
	chain := botResearchChain(tuning.researchTarget)
	if len(chain) == 0 {
		return all
	}
	inChain := make(map[string]bool, len(chain))
	out := make([]*model.TechDefinition, 0, len(all))
	for _, id := range chain {
		if def, ok := model.TechDefinitionByID(id); ok && def != nil {
			inChain[id] = true
			out = append(out, def)
		}
	}
	for _, def := range all {
		if def != nil && !inChain[def.ID] {
			out = append(out, def)
		}
	}
	return out
}

// botResearchChain 返回 target 及其全部前置（递归），顺序为目标优先、前置随后。
func botResearchChain(target string) []string {
	var chain []string
	seen := make(map[string]bool)
	var walk func(id string)
	walk = func(id string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		def, ok := model.TechDefinitionByID(id)
		if !ok || def == nil {
			return
		}
		chain = append(chain, id)
		for _, prereq := range def.Prerequisites {
			walk(prereq)
		}
	}
	walk(target)
	return chain
}

func botLabsCoverCost(labs []*model.Building, cost []model.ItemAmount, storageOf func(*model.Building) *model.StorageState) bool {
	for _, item := range cost {
		if item.ItemID == "" || item.Quantity <= 0 {
			continue
		}
		total := 0
		for _, lab := range labs {
			storage := storageOf(lab)
			if storage == nil {
				continue
			}
			total += storage.OutputQuantity(item.ItemID)
		}
		if total <= 0 {
			return false
		}
	}
	return true
}

// botProduce 混合出兵。产线不消耗工人，因此不另造 worker。
func (gc *GameCore) botProduce(ws *model.WorldState, playerID string, tuning botTuning, ctx *botSurvey, issue func(model.Command) bool) bool {
	queued := 0
	for _, b := range ctx.producers {
		queued += len(b.UnitQueue)
	}
	if len(ctx.producers) == 0 || len(ctx.soldiers)+queued >= tuning.armyCap {
		return false
	}
	types := botArmyPreference(ctx, tuning)
	for _, utype := range types {
		spec, _ := model.UnitDefinitionByID(utype)
		for _, producer := range ctx.producers {
			if producer.Type != spec.Producer || len(producer.UnitQueue) >= 3 {
				continue
			}
			ready := true
			for _, cost := range spec.Cost {
				missing := cost.Quantity - producer.Storage.ItemQuantity(cost.ItemID)
				if missing <= 0 {
					continue
				}
				ready = false
				if ws.Players[playerID].Inventory[cost.ItemID] >= missing {
					return issue(model.Command{Type: model.CmdTransferItem, Payload: map[string]any{"building_id": producer.ID, "item_id": cost.ItemID, "quantity": missing}})
				}
			}
			if ready {
				return issue(model.Command{Type: model.CmdProduce, Target: model.CommandTarget{Layer: "planet", EntityID: producer.ID}, Payload: map[string]any{"unit_type": string(utype)}})
			}
		}
	}
	return false
}

func botPreferMecha(soldiers, mechas int, tuning botTuning) bool {
	if tuning.mechaEvery <= 0 {
		return false
	}
	if tuning.mechaMinSoldiers == 0 && mechas == 0 {
		return true
	}
	if soldiers < tuning.mechaMinSoldiers {
		return false
	}
	return mechas*tuning.mechaEvery < soldiers
}

// botCanAffordBuild 报告 bot 背包里的物品是否够建这栋建筑（第 16 轮起唯一的门槛：
// 没有矿物/能量货币可查）。不够时调用方应当先去手搓或从自己建筑的输出缓冲取货
// ——bot 的取货重做属于后续任务，这里只保证门槛语义正确。
func botCanAffordBuild(player *model.PlayerState, def model.BuildingDefinition) bool {
	if player == nil {
		return false
	}
	_, short := missingItem(player.Inventory, def.BuildCost.Items)
	return !short
}

func botConstructRadius(ws *model.WorldState, playerID string, ctx *botSurvey) int {
	radius := 0
	if ctx != nil {
		for _, b := range ctx.buildings {
			def, ok := model.BuildingDefinitionByID(b.Type)
			if ok && def.BuildRadius > radius {
				radius = def.BuildRadius
			}
		}
	}
	if radius > 0 {
		return radius
	}
	if ws != nil && ws.Players[playerID] != nil {
		if exec := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID); exec != nil && exec.OperateRange > 0 {
			return exec.OperateRange
		}
	}
	return 6
}

// botBuildSpotNear 基地附近的可建格（由内向外扫描），跳过在建格。
// 两条"别把自家单位关起来"的校验都复用引擎侧实现：
//   - buildingEnclosure：会围死地面单位（含己方机甲）的格子跳过，bot 不再反复发
//     注定被拒的建造命令（试玩报告 I）；
//   - spotCoversGroundUnit：占地**罩住**自家地面单位的格子同样跳过——命令下达后
//     单位会走进即将合拢的占地，落成时虽然会被推到占地外（见
//     displaceFootprintUnits），但推挤会打乱 bot 自己的站位，选点时就该避开
//     （bot 长跑 tick 14440：补给站 3×3 落成时步兵正站在占地里）。
func botBuildSpotNear(ws *model.WorldState, home model.Position, maxRadius int, btype model.BuildingType, owner string) *model.Position {
	if maxRadius < 1 {
		return nil
	}
	start := 9
	if maxRadius < start {
		start = 1
	}
	for radius := start; radius <= maxRadius; radius++ {
		candidates := ws.SurfaceDisc(home, radius)
		sort.SliceStable(candidates, func(i, j int) bool {
			return ws.SurfaceDistance(home, candidates[i]) < ws.SurfaceDistance(home, candidates[j])
		})
		for _, candidate := range candidates {
			d := ws.SurfaceDistance(home, candidate)
			if d != radius {
				continue
			}
			if !ws.InBounds(candidate.X, candidate.Y) {
				continue
			}
			if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
				continue
			}
			if ws.Construction != nil && ws.Construction.IsTileReserved(model.TileKey(candidate.X, candidate.Y)) {
				continue
			}
			// 细分网格：锚点格空 ≠ 放得下。2×2/3×3/5×5 的占地必须整块可落位，
			// 否则发出的建造命令会被"占地与已有建筑重叠"拒绝（脚本化开局实测
			// 风机反复撞在 5×5 的 HQ 上，整局卡死在第一座风机）。
			def, ok := model.BuildingDefinitionByID(btype)
			if !ok {
				continue
			}
			fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
			if !ws.FootprintFits(candidate, fp, btype, "") {
				continue
			}
			// 复用围死校验：跳过会把地面单位四周堵死的格子。
			if buildingEnclosure(ws, btype, model.PlanRotation0, candidate) != nil {
				continue
			}
			// 占地里不能站着自家地面单位：建造**不会**把单位推出去，占地落成后
			// 那台单位就永远卡在建筑格上。实测 bot 长跑 tick 14440：补给站
			// b-86（3×3）落成时步兵 u-74 正站在占地里，此后四邻全堵、永久砌在墙里。
			if spotCoversGroundUnit(ws, candidate, fp, owner) {
				continue
			}
			c := candidate
			return &c
		}
	}
	return nil
}
