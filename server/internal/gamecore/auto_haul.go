package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 运输机器人（§2.1）全局自动模式：机器人自己找「缺料的建筑」和「有货的建筑」，
// 在两者之间往返，玩家不需要指定任何路线。
//
// 与本文件同目录的 transport_robot_settlement.go 是两种模式共用的行程状态机：
//   - 移动/装卸/等待/端点消失收尾的规则完全一致（绝不复制第二套）；
//   - 区别只在「任务从哪来」——route 模式来自玩家写的路线，auto 模式来自本文件的派单。
//
// 规则（设计文档 §2.1）：
//   - 需求：本行星己方、已通电、设了配方的生产建筑，按配方每种原料算
//     缺口 = 目标库存 − (主库存 + 输入缓冲 + 已认领在途量)，目标库存 = 2 批用量
//     （受产出预留后的可用容量封顶）。缺口 > 0 即一条需求；建筑当前因缺料停工
//     的需求优先（打分距离 ×0.5）。
//   - 供给：仓储类建筑的主库存，以及生产/采集建筑的**输出缓冲**（只取成品，
//     绝不从生产建筑主库存拿它自己的原料，避免来回倒腾）；供给同样扣掉已认领量。
//   - 派单：每 10 tick 给空闲机器人打分选单，分 = 到需求建筑距离 + 已服务该建筑的
//     机器人数 × 30 cell（缺料停工的距离 ×0.5）；同一建筑最多 2 台同时服务。
//   - 收尾：端点消失、取到 0 件、需求已满 → 释放认领；带着的货优先送给另一台
//     缺同种原料的机器，否则送回最近的仓储，都没有就带着货待命。
//
// 认领（Claim）存在机器人自己的 haul 状态里，随单位快照存读档；读档后结算按
// 每台机器人当前的 Claim 重建需求/供给的已认领量，因此与存档前一致。

const (
	// haulDispatchIntervalTicks 派单间隔（tick）：§2.1「每 10 tick 派单一次」。
	haulDispatchIntervalTicks = 10
	// haulClaimPenaltyCells 同一需求建筑每多一台在服务的机器人的距离惩罚（cell）。
	haulClaimPenaltyCells = 30
	// haulMaxRobotsPerDemand 同一建筑同时最多几台机器人服务（§2.1）。
	haulMaxRobotsPerDemand = 2
	// haulDemandBatchMultiple 目标库存 = 该原料多少批用量（§2.1「2 批用量」）。
	haulDemandBatchMultiple = 2
	// haulDeliverReturnCap 端点消失后把货送回仓储时的目标库存（件）。
	haulDeliverReturnCap = 8
)

// haulDemand 一条「缺料」需求：某建筑缺某原料。
type haulDemand struct {
	buildingID string
	itemID     string
	quantity   int // 未认领缺口（>0）
	starved    bool
}

// haulSupply 一处可取货的供给。
type haulSupply struct {
	buildingID string
	itemID     string
	quantity   int // 未认领余量（>0）
}

// settleAutoHaul 自动模式运输机器人的每 tick 结算（在 settleTransportRobots 里调用）。
//
// 只在派单 tick 上做全行星扫描：其余 tick 什么都不做，机器人靠共用状态机自己走。
func settleAutoHaul(ws *model.WorldState, robots []*model.Unit) []*model.GameEvent {
	if ws == nil || len(robots) == 0 || ws.Tick%haulDispatchIntervalTicks != 0 {
		return nil
	}
	// 每台机器人的结算顺序只依赖它自己的状态与世界的确定快照，
	// 不依赖其它机器人本轮的选择——派单对世界的唯一影响是各机器人的 Claim，
	// 而同一台机器人一轮只派一次，因此逐台处理与「同时决策」等价。
	var events []*model.GameEvent
	for _, robot := range robots {
		events = append(events, autoHaulAssign(ws, robot)...)
	}
	return events
}

// autoHaulAssign 给一台空闲的自动模式机器人派一单（无单可派时原地待命）。
func autoHaulAssign(ws *model.WorldState, robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	if haul == nil || haul.Mode != model.HaulModeAuto {
		return nil
	}
	// 有任务（在路上/在装卸/在等）的机器人不重新派单：等它跑完这一趟。
	if haul.ToBuildingID != "" {
		return nil
	}
	if haul.Phase != model.HaulPhaseIdle && haul.Phase != "" {
		return nil
	}

	claims := haulClaims(ws)
	pruneHaulCooldowns(ws, haul)
	if claim := assignHaulFromCargo(ws, robot, claims); claim != nil {
		haul.Claim = claim
		haul.FromBuildingID = ""
		haul.ToBuildingID = claim.DemandBuildingID
		haul.ItemID = claim.ItemID
		haul.Phase = model.HaulPhaseToTarget
		return []*model.GameEvent{haulTaskEvent(robot, "auto_haul_deliver")}
	}
	// 车上有货但眼下无处可送：只允许「带货改派」，绝不派普通单——普通单会去
	// 起点装另一种物品，装货逻辑与车上货种不符时货会凭空消失（试玩 1016 复审）。
	// 带着货待命，等下一次派单或其它建筑出现需求。
	if haul.CargoQuantity() > 0 {
		haulClearTask(robot)
		return nil
	}

	demands := haulDemands(ws, claims)
	if len(demands) == 0 {
		haulClearTask(robot)
		return nil
	}
	supplies := haulSupplies(ws, claims)

	served := haulServedCounts(ws)
	bestDemand := -1
	bestScore := 0
	bestSupply := -1
	for di, demand := range demands {
		// 到不了的建筑在冷却期内跳过：让这台机器人去服务别的需求。
		if haulCooldownActive(haul, demand.buildingID, ws.Tick) {
			continue
		}
		if served[demand.buildingID] >= haulMaxRobotsPerDemand {
			continue
		}
		supply := nearestHaulSupply(ws, supplies, demand, func(id string) bool {
			return haulCooldownActive(haul, id, ws.Tick)
		})
		if supply < 0 {
			continue
		}
		score := haulDemandScore(ws, robot, demand, served)
		if bestDemand < 0 || score < bestScore {
			bestDemand, bestScore, bestSupply = di, score, supply
		}
	}
	if bestDemand < 0 {
		haulClearTask(robot)
		return nil
	}
	demand := demands[bestDemand]
	supply := supplies[bestSupply]
	quantity := min(haulCargoCapacity, min(demand.quantity, supply.quantity))
	haul.Claim = &model.HaulClaim{
		SupplyBuildingID: supply.buildingID,
		DemandBuildingID: demand.buildingID,
		ItemID:           demand.itemID,
		Quantity:         quantity,
	}
	haul.FromBuildingID = supply.buildingID
	haul.ToBuildingID = demand.buildingID
	haul.ItemID = demand.itemID
	haul.Phase = model.HaulPhaseToSource
	return []*model.GameEvent{haulTaskEvent(robot, "auto_haul_assigned")}
}

// assignHaulFromCargo 车上有货且还有别的建筑缺同种原料时，直接改送过去。
// 这是「上一条任务结束时货没送出去」的优先去向（§2.1 收尾规则）。
// 本机器人到不了的建筑（冷却期内）跳过，避免刚放弃又送回去。
func assignHaulFromCargo(ws *model.WorldState, robot *model.Unit, claims *haulClaimBook) *model.HaulClaim {
	haul := robot.Haul
	quantity := haul.CargoQuantity()
	if quantity <= 0 || haul.Cargo.ItemID == "" {
		return nil
	}
	itemID := haul.Cargo.ItemID
	if _, ok := model.Item(itemID); !ok {
		return nil
	}
	demands := haulDemands(ws, claims)
	for _, demand := range demands {
		if demand.itemID != itemID {
			continue
		}
		if haulCooldownActive(haul, demand.buildingID, ws.Tick) {
			continue
		}
		if accepted, _ := haulDepositPreview(ws.Buildings[demand.buildingID], itemID, quantity); accepted <= 0 {
			continue
		}
		return &model.HaulClaim{DemandBuildingID: demand.buildingID, ItemID: itemID, Quantity: quantity}
	}
	return nil
}

// haulClearTask 回到「空闲待命」：清掉任务字段与认领，停在原地不乱跑。
func haulClearTask(robot *model.Unit) {
	if robot == nil || robot.Haul == nil {
		return
	}
	robot.Haul.ClearRoute()
	robot.Haul.Phase = model.HaulPhaseIdle
	if robot.Stance != model.UnitStanceMoving {
		return
	}
	if robot.HasPath() && robot.PathIntent == model.PathIntentTask {
		robot.ClearMovement()
		robot.Stance = model.UnitStanceIdle
	}
}

// haulTaskEvent 自动模式派单/改派的一条事件（客户端据此更新路线与胶囊文案）。
func haulTaskEvent(robot *model.Unit, order string) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":   robot.ID,
			"entity_kind": "unit",
			"order":       order,
			"haul":        robot.Haul.Clone(),
		},
	}
}

// haulClaimBook 本轮派单时「已被认领」的量（按需求建筑 / 供给建筑分组）。
type haulClaimBook struct {
	demand map[string]map[string]int
	supply map[string]map[string]int
}

func (b *haulClaimBook) demandQuantity(buildingID, itemID string) int {
	if b == nil {
		return 0
	}
	return b.demand[buildingID][itemID]
}

func (b *haulClaimBook) supplyQuantity(buildingID, itemID string) int {
	if b == nil {
		return 0
	}
	return b.supply[buildingID][itemID]
}

// haulClaims 汇总所有自动模式机器人在途认领的数量（§2.1「已被机器人认领在途量」）。
func haulClaims(ws *model.WorldState) *haulClaimBook {
	book := &haulClaimBook{demand: map[string]map[string]int{}, supply: map[string]map[string]int{}}
	if ws == nil {
		return book
	}
	for _, robot := range ws.Units {
		if robot == nil || robot.HP <= 0 || robot.Haul == nil || robot.Haul.Mode != model.HaulModeAuto {
			continue
		}
		claim := robot.Haul.Claim
		if claim == nil || claim.ItemID == "" || claim.Quantity <= 0 {
			continue
		}
		if claim.DemandBuildingID != "" {
			addHaulClaim(book.demand, claim.DemandBuildingID, claim.ItemID, claim.Quantity)
		}
		if claim.SupplyBuildingID != "" {
			addHaulClaim(book.supply, claim.SupplyBuildingID, claim.ItemID, claim.Quantity)
		}
	}
	return book
}

func addHaulClaim(book map[string]map[string]int, buildingID, itemID string, quantity int) {
	if book[buildingID] == nil {
		book[buildingID] = map[string]int{}
	}
	book[buildingID][itemID] += quantity
}

// haulServedCounts 每座需求建筑当前有几台自动机器人正在服务（含已到点装卸的）。
func haulServedCounts(ws *model.WorldState) map[string]int {
	counts := map[string]int{}
	if ws == nil {
		return counts
	}
	for _, robot := range ws.Units {
		if robot == nil || robot.HP <= 0 || robot.Haul == nil || robot.Haul.Mode != model.HaulModeAuto {
			continue
		}
		if target := robot.Haul.ToBuildingID; target != "" {
			counts[target]++
		}
	}
	return counts
}

// haulDemands 本行星己方、已通电、设了配方的生产建筑的未认领缺料清单（稳定顺序）。
func haulDemands(ws *model.WorldState, claims *haulClaimBook) []haulDemand {
	if ws == nil {
		return nil
	}
	// 供电视图取一次（同一 tick 内复用）：逐建筑重复构建快照在 50 座建筑的
	// 场景里是纯浪费（CurrentPowerSettlementSnapshot 在快照缺失时会整表重建）。
	power := model.CurrentPowerSettlementSnapshot(ws)
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if building == nil || building.HP <= 0 || building.Storage == nil {
			continue
		}
		if building.Production == nil || building.Production.RecipeID == "" {
			continue
		}
		if building.Runtime.Functions.Production == nil {
			continue
		}
		// 已通电：暂停、停工、断电、故障的建筑都不派单（§2.1「已通电」）。
		switch building.Runtime.State {
		case model.BuildingWorkNoPower, model.BuildingWorkError, model.BuildingWorkPaused, model.BuildingWorkIdle:
			continue
		}
		if powered, _, _ := buildingPowerAvailability(building, power.Coverage, power.Allocations); !powered {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var demands []haulDemand
	for _, id := range ids {
		building := ws.Buildings[id]
		recipe, ok := model.Recipe(building.Production.RecipeID)
		if !ok {
			continue
		}
		for _, input := range recipe.Inputs {
			itemID := input.ItemID
			if itemID == "" || input.Quantity <= 0 {
				continue
			}
			if _, known := model.Item(itemID); !known {
				continue
			}
			gap := haulDemandGap(building, input, claims.demandQuantity(id, itemID))
			if gap <= 0 {
				continue
			}
			demands = append(demands, haulDemand{
				buildingID: id,
				itemID:     itemID,
				quantity:   gap,
			})
		}
	}
	// 缺料停工的建筑优先救：只在真正有需求的建筑里判定（见 haulStarvedBuildings）。
	starved := haulStarvedBuildings(ws, demands)
	for i := range demands {
		demands[i].starved = starved[demands[i].buildingID]
	}
	return demands
}
// haulDemandGap 单种原料的未认领缺口：目标库存 −（主库存 + 输入缓冲 + 已认领）。
// 目标库存 = 2 批用量，且不超过「产出预留后的可用容量 + 输入缓冲空位」。
func haulDemandGap(building *model.Building, input model.ItemAmount, claimed int) int {
	storage := building.Storage
	target := input.Quantity * haulDemandBatchMultiple
	if room := storage.AvailableInventory() + storage.InputBufferSpace(); room < target {
		target = room
	}
	held := storage.ItemQuantity(input.ItemID) + claimed
	if held >= target {
		return 0
	}
	return target - held
}

// haulStarvedBuildings 当前因缺料停工的建筑集合：有配方、状态 running、
// 生产进度停在 0（原料不足时 collectRecipeInputs 会整批拒绝，进度不会推进），
// 且主库存 + 输入缓冲里确实凑不齐配方原料。这类需求优先救（§2.1）。
func haulStarvedBuildings(ws *model.WorldState, demands []haulDemand) map[string]bool {
	starved := map[string]bool{}
	if ws == nil {
		return starved
	}
	for _, demand := range demands {
		building := ws.Buildings[demand.buildingID]
		if building == nil || building.Storage == nil {
			continue
		}
		state := building.Production
		if state == nil || state.RecipeID == "" || state.RemainingTicks > 0 {
			continue
		}
		if len(state.PendingOutputs) > 0 || len(state.PendingByproducts) > 0 {
			continue
		}
		if building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		recipe, ok := model.Recipe(state.RecipeID)
		if !ok || len(recipe.Inputs) == 0 {
			continue
		}
		if _, ok := collectRecipeInputs(building.Storage, recipe); ok {
			continue
		}
		starved[demand.buildingID] = true
	}
	return starved
}

// haulSupplies 本行星的未认领供给清单（稳定顺序）：
//   - 仓储类建筑（储物仓/储液罐、物流站库存）的主库存；
//   - 生产/采集建筑的输出缓冲成品（只取成品，绝不从生产建筑主库存拿原料）。
func haulSupplies(ws *model.WorldState, claims *haulClaimBook) []haulSupply {
	if ws == nil {
		return nil
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if building == nil || building.HP <= 0 || building.Storage == nil {
			continue
		}
		if building.Job != nil && building.Job.Type == model.BuildingJobDemolish {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var supplies []haulSupply
	for _, id := range ids {
		building := ws.Buildings[id]
		if haulIsStorageBuilding(building) {
			for _, itemID := range building.Storage.OutputCandidates() {
				if _, known := model.Item(itemID); !known {
					continue
				}
				if quantity := building.Storage.Inventory[itemID] - claims.supplyQuantity(id, itemID); quantity > 0 {
					supplies = append(supplies, haulSupply{buildingID: id, itemID: itemID, quantity: quantity})
				}
			}
			continue
		}
		// 生产/采集建筑：只认输出缓冲里的成品（ExportableItemQuantity 对反馈料
		// 也只算输出缓冲，语义一致）。
		for _, itemID := range building.Storage.OutputCandidates() {
			if _, known := model.Item(itemID); !known {
				continue
			}
			if building.Storage.OutputBuffer[itemID] <= 0 {
				continue
			}
			quantity := building.ExportableItemQuantity(itemID) - claims.supplyQuantity(id, itemID)
			if quantity > 0 {
				supplies = append(supplies, haulSupply{buildingID: id, itemID: itemID, quantity: quantity})
			}
		}
	}
	return supplies
}

// haulIsStorageBuilding 仓储类建筑：储物仓 / 储液罐 / 物流站。它们的整仓库存
// 都是「给别人用的」，取货不受「只取成品」约束。
func haulIsStorageBuilding(building *model.Building) bool {
	if building == nil {
		return false
	}
	if model.IsGroundLogisticsBuilding(building.Type) {
		return true
	}
	def, ok := model.BuildingDefinitionByID(building.Type)
	return ok && def.Category == model.BuildingCategoryStorage
}

// nearestHaulSupply 该需求最近的可用供给（按供给建筑到需求建筑的距离，稳定顺序）。
// blocked 非 nil 时跳过它判定为「到不了」的供给建筑。
func nearestHaulSupply(ws *model.WorldState, supplies []haulSupply, demand haulDemand, blocked func(buildingID string) bool) int {
	target := ws.Buildings[demand.buildingID]
	if target == nil {
		return -1
	}
	best, bestDistance := -1, 0
	for i, supply := range supplies {
		if supply.itemID != demand.itemID {
			continue
		}
		if blocked != nil && blocked(supply.buildingID) {
			continue
		}
		source := ws.Buildings[supply.buildingID]
		if source == nil || source.OwnerID != target.OwnerID {
			continue
		}
		distance := ws.SurfaceDistance(source.Position, target.Position)
		if best < 0 || distance < bestDistance {
			best, bestDistance = i, distance
		}
	}
	return best
}

// haulDemandScore 派单打分：机器人到需求建筑的距离 + 已服务该建筑的机器人数 × 30，
// 缺料停工的需求距离按 0.5 倍计（优先救停工，§2.1）。
func haulDemandScore(ws *model.WorldState, robot *model.Unit, demand haulDemand, served map[string]int) int {
	distance := ws.SurfaceDistance(robot.Position, ws.Buildings[demand.buildingID].Position)
	if demand.starved {
		distance = distance / 2
	}
	return distance + served[demand.buildingID]*haulClaimPenaltyCells
}

// haulDeliveryFallback 端点消失后带在身上的货去哪（§2.1）：先给另一台缺同种原料
// 的建筑（供给端为空 = 货已在车上），否则送回最近的仓储（最多 haulDeliverReturnCap 件），
// 都没有就 nil（带着货待命）。
func haulDeliveryFallback(ws *model.WorldState, robot *model.Unit, itemID string) *model.HaulClaim {
	quantity := robot.Haul.CargoQuantity()
	if ws == nil || quantity <= 0 || itemID == "" {
		return nil
	}
	book := haulClaims(ws)
	for _, demand := range haulDemands(ws, book) {
		if demand.itemID != itemID {
			continue
		}
		if haulCooldownActive(robot.Haul, demand.buildingID, ws.Tick) {
			continue
		}
		if accepted, _ := haulDepositPreview(ws.Buildings[demand.buildingID], itemID, quantity); accepted <= 0 {
			continue
		}
		return &model.HaulClaim{DemandBuildingID: demand.buildingID, ItemID: itemID, Quantity: quantity}
	}
	target := haulNearestStorage(ws, robot, itemID, quantity)
	if target == "" {
		return nil
	}
	return &model.HaulClaim{
		DemandBuildingID: target,
		ItemID:           itemID,
		Quantity:         min(quantity, haulDeliverReturnCap),
	}
}

// haulNearestStorage 离机器人最近、能收下该物品的己方仓储建筑。
func haulNearestStorage(ws *model.WorldState, robot *model.Unit, itemID string, quantity int) string {
	if ws == nil || robot == nil {
		return ""
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if building == nil || building.HP <= 0 || building.OwnerID != robot.OwnerID {
			continue
		}
		if !haulIsStorageBuilding(building) {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	best, bestDistance := "", 0
	for _, id := range ids {
		// 到不了的仓储同样跳过：否则放弃这一单后 fallback 又把它派回同一座，
		// 形成「放弃 → 改派回原目标 → 再放弃」的无限循环。
		if haulCooldownActive(robot.Haul, id, ws.Tick) {
			continue
		}
		building := ws.Buildings[id]
		if accepted, _ := haulDepositPreview(building, itemID, quantity); accepted <= 0 {
			continue
		}
		distance := ws.SurfaceDistance(robot.Position, building.Position)
		if best == "" || distance < bestDistance {
			best, bestDistance = id, distance
		}
	}
	return best
}
