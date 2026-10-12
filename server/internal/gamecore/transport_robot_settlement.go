package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// 运输机器人（§2）：在玩家指定的两座建筑之间往返搬运单一物品。
//
// 与配送器（distributor）的区别：路线由玩家用 unit_order order=haul 显式指定，
// 不消耗能量、不占配送器槽位，运力必须远小于传送带（一趟 4 件、往返几十 tick）。
//
// 规则（设计文档 §2）：
//   - 起点/终点都是己方同行星建筑；起点要能取货，终点要能收货；
//   - 走到建筑**占地外圈的相邻空 cell** 才能装卸（细分网格后建筑是多格占地）；
//   - 装货走 ExportableItemQuantity（输出缓存 + 主库存，反馈料除外）；
//   - 卸货走与 transfer_item to_building 完全相同的接收规则（产出预留、
//     研究站只收矩阵、物流站需先配槽位）——本文件不复制那套判定，只复用；
//   - 起点无货在起点等（waiting_source），终点收不下在终点等（waiting_target）；
//   - 任一端建筑消失：清空路线、停下、发一条中文事件。
//
// 移动本身由 settleUnitMovement 负责（机器人就是普通世界单位，按路径逐 tick
// 前进）；本文件只做「到没到外圈」的判定与装卸。

// haulCargoCapacity 每趟载量（件）：设计文档 §2「每趟 4 件、单一物品」。
const haulCargoCapacity = 4

// maxHaulPerPlayer 每玩家运输机器人上限（台）：设计文档 §2「每玩家 20 台」。
const maxHaulPerPlayer = 20

// haulRetryTicks 装卸/重试节流（tick）：建筑暂时没货或收不下时每 tick 重试
// 是纯开销（存储与生产结算每 tick 才推进一次）。
const haulRetryTicks = 5

// haulWaitPollTicks 等待状态（waiting_source / waiting_target）的轮询间隔（tick）。
const haulWaitPollTicks = 10

// haulIDs 列出世界上所有运输机器人（稳定顺序）。
func haulIDs(ws *model.WorldState) []string {
	ids := make([]string, 0, len(ws.Units))
	for id, u := range ws.Units {
		if u != nil && u.Type == model.UnitTypeTransportRobot {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// countTransportRobots 统计该玩家存活 + 在生产队列里的运输机器人（每玩家上限口径）。
func countTransportRobots(ws *model.WorldState, playerID string) (alive, queued int) {
	if ws == nil {
		return 0, 0
	}
	for _, u := range ws.Units {
		if u != nil && u.Type == model.UnitTypeTransportRobot && u.OwnerID == playerID && u.HP > 0 {
			alive++
		}
	}
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID {
			continue
		}
		for _, order := range b.UnitQueue {
			if order.UnitType == model.UnitTypeTransportRobot {
				queued++
			}
		}
	}
	return alive, queued
}

// settleTransportRobots 推进所有运输机器人的装卸与路线循环。
func settleTransportRobots(ws *model.WorldState) []*model.GameEvent {
	if ws == nil || len(ws.Units) == 0 {
		return nil
	}
	var events []*model.GameEvent
	for _, id := range haulIDs(ws) {
		robot := ws.Units[id]
		if robot == nil || robot.HP <= 0 || robot.Haul == nil {
			continue
		}
		events = append(events, settleTransportRobot(ws, robot)...)
	}
	return events
}

// settleTransportRobot 结算一台运输机器人的一 tick。
func settleTransportRobot(ws *model.WorldState, robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	if haul.FromBuildingID == "" || haul.ToBuildingID == "" {
		return nil
	}
	source := ws.Buildings[haul.FromBuildingID]
	target := ws.Buildings[haul.ToBuildingID]
	if reason := haulEndpointLost(source, target, robot.OwnerID); reason != "" {
		return abortHaul(robot, reason)
	}

	switch haul.Phase {
	case model.HaulPhaseToSource:
		return haulTravelTo(ws, robot, source, model.HaulPhaseToSource, model.HaulPhaseLoading)
	case model.HaulPhaseToTarget:
		return haulTravelTo(ws, robot, target, model.HaulPhaseToTarget, model.HaulPhaseUnloading)
	case model.HaulPhaseLoading:
		if !ringHasBuilding(ws, source, robot.Position) {
			haul.Phase = model.HaulPhaseToSource
			return nil
		}
		if ws.Tick%haulRetryTicks != 0 {
			return nil
		}
		return haulLoadAtSource(ws, robot)
	case model.HaulPhaseUnloading:
		if !ringHasBuilding(ws, target, robot.Position) {
			haul.Phase = model.HaulPhaseToTarget
			return nil
		}
		if ws.Tick%haulRetryTicks != 0 {
			return nil
		}
		return haulUnloadAtTarget(ws, robot)
	case model.HaulPhaseWaitingSource:
		return haulResumeFromWait(ws, robot, source, model.HaulPhaseToSource, model.HaulPhaseLoading)
	case model.HaulPhaseWaitingTarget:
		return haulResumeFromWait(ws, robot, target, model.HaulPhaseToTarget, model.HaulPhaseUnloading)
	default:
		// 路线刚下达（或阶段丢失）：车上还有货就先去终点，否则从起点开始。
		if haul.CargoQuantity() > 0 {
			haul.Phase = model.HaulPhaseToTarget
		} else {
			haul.Phase = model.HaulPhaseToSource
		}
		return nil
	}
}

// haulEndpointLost 检查路线两端是否仍然可用，返回中文原因（空串表示正常）。
func haulEndpointLost(source, target *model.Building, ownerID string) string {
	if source == nil {
		return "运输起点建筑已不存在（拆除或被摧毁），运输路线已清空"
	}
	if target == nil {
		return "运输终点建筑已不存在（拆除或被摧毁），运输路线已清空"
	}
	if source.OwnerID != ownerID || target.OwnerID != ownerID {
		return "运输路线的起点或终点已不属于本玩家，运输路线已清空"
	}
	if source.HP <= 0 || target.HP <= 0 {
		return "运输路线的起点或终点已被摧毁，运输路线已清空"
	}
	if source.ID == target.ID {
		return "运输起点与终点是同一座建筑，运输路线已清空"
	}
	return ""
}

// abortHaul 端点消失：清空路线、停下机器人并发一条中文事件。
// 车上的货留在车上（不凭空消失），玩家重新指定路线后继续用。
func abortHaul(robot *model.Unit, reason string) []*model.GameEvent {
	robot.Haul.ClearHaul()
	robot.ClearMovement()
	robot.ClearEngagement()
	robot.Stance = model.UnitStanceIdle
	return []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":   robot.ID,
			"entity_kind": "unit",
			"order":       "haul_aborted",
			"reason":      reason,
			"message":     fmt.Sprintf("%s：%s", unitDisplayName(robot), reason),
		},
	}}
}

// haulTravelTo 行进阶段：到达建筑占地外圈即切到装卸阶段，否则按需重规划路径。
// 路径推进由 settleUnitMovement 完成，这里只在「没路可走」时重新规划。
func haulTravelTo(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase, arrivalPhase model.HaulPhase) []*model.GameEvent {
	if ringHasBuilding(ws, building, robot.Position) {
		robot.ClearMovement()
		robot.Stance = model.UnitStanceIdle
		robot.Haul.Phase = arrivalPhase
		return nil
	}
	if robot.HasPath() {
		return nil
	}
	if ws.Tick%haulRetryTicks != 0 {
		return nil
	}
	return haulRouteTo(ws, robot, building, travelPhase)
}

// haulRouteTo 让机器人前往建筑占地外圈的相邻空 cell。
func haulRouteTo(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase model.HaulPhase) []*model.GameEvent {
	dest, ok := haulApproachCell(ws, robot, building)
	if !ok {
		// 外圈一圈都被占满：停下等（waiting 阶段轮询重试）。
		robot.Haul.Phase = haulWaitingPhaseFor(travelPhase)
		robot.ClearMovement()
		robot.Stance = model.UnitStanceIdle
		return nil
	}
	path, pathOK := computeUnitPath(ws, robot.Position, dest, robot.ID)
	if !pathOK || len(path) < 2 {
		robot.Haul.Phase = haulWaitingPhaseFor(travelPhase)
		robot.ClearMovement()
		robot.Stance = model.UnitStanceIdle
		return nil
	}
	robot.ClearEngagement()
	robot.Path = path
	robot.PathIndex = 1
	robot.PathIntent = model.PathIntentTask
	robot.MoveProgress = 0
	robot.BlockedTicks = 0
	robot.OrderPos = nil
	robot.Stance = model.UnitStanceMoving
	return []*model.GameEvent{{
		EventType:       model.EvtEntityMoved,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":   robot.ID,
			"entity_kind": "unit",
			"from":        robot.Position,
			"to":          dest,
			"path":        path,
			"move_speed":  robot.MoveSpeed,
			"stance":      robot.Stance,
		},
	}}
}

func haulWaitingPhaseFor(phase model.HaulPhase) model.HaulPhase {
	if phase == model.HaulPhaseToTarget {
		return model.HaulPhaseWaitingTarget
	}
	return model.HaulPhaseWaitingSource
}

// haulResumeFromWait 等待状态的轮询：还在外圈就直接重试装卸，被挤开就重新走过去。
func haulResumeFromWait(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase, workPhase model.HaulPhase) []*model.GameEvent {
	if ws.Tick%haulWaitPollTicks != 0 {
		return nil
	}
	if !ringHasBuilding(ws, building, robot.Position) {
		robot.Haul.Phase = travelPhase
		return nil
	}
	robot.Haul.Phase = workPhase
	switch workPhase {
	case model.HaulPhaseLoading:
		return haulLoadAtSource(ws, robot)
	case model.HaulPhaseUnloading:
		return haulUnloadAtTarget(ws, robot)
	}
	return nil
}

// haulLoadAtSource 在起点装货：未指定物品时选「起点当前可取且终点当前能接收」的第一种。
func haulLoadAtSource(ws *model.WorldState, robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	source := ws.Buildings[haul.FromBuildingID]
	if source == nil {
		return nil
	}
	capacity := haulCargoCapacity - haul.CargoQuantity()
	if capacity <= 0 {
		haul.Phase = model.HaulPhaseToTarget
		return nil
	}
	itemID := haul.ItemID
	if itemID == "" {
		itemID = selectHaulPickupItem(ws, robot)
	}
	if itemID == "" {
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	available := haulPickupQuantity(source, itemID)
	if available <= 0 {
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	taken, _, err := source.Storage.Provide(itemID, min(capacity, available))
	if err != nil || taken <= 0 {
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	haul.Load(itemID, taken)
	haul.Phase = model.HaulPhaseToTarget
	return []*model.GameEvent{haulCargoEvent(robot, taken)}
}

// haulUnloadAtTarget 在终点卸货：接收规则与 transfer_item to_building 完全一致。
func haulUnloadAtTarget(ws *model.WorldState, robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	target := ws.Buildings[haul.ToBuildingID]
	if target == nil {
		return nil
	}
	if haul.CargoQuantity() <= 0 {
		haul.Phase = model.HaulPhaseToSource
		return nil
	}
	itemID := haul.Cargo.ItemID
	accepted, remaining := haulDepositIntoBuilding(target, itemID, haul.Cargo.Quantity)
	if accepted <= 0 {
		// 终点暂时收不下（满、产出预留顶住、槽位不符）：留在车上等。
		haul.Phase = model.HaulPhaseWaitingTarget
		return nil
	}
	haul.Unload(accepted)
	haul.DeliveredTotal += accepted
	events := []*model.GameEvent{haulCargoEvent(robot, accepted)}
	if remaining > 0 {
		// 卸不完的留在车上，等终点腾出空间后继续卸。
		haul.Phase = model.HaulPhaseWaitingTarget
		return events
	}
	haul.Phase = model.HaulPhaseToSource
	return events
}

// haulCargoEvent 装/卸一条事件（客户端据此更新车顶货物与进度）。
func haulCargoEvent(robot *model.Unit, quantity int) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":       robot.ID,
			"entity_kind":     "unit",
			"order":           "haul_cargo",
			"quantity":        quantity,
			"haul":            robot.Haul.Clone(),
			"delivered_total": robot.Haul.DeliveredTotal,
		},
	}
}

// selectHaulPickupItem 未指定物品时选起点第一种「可取且终点能收」的物品。
func selectHaulPickupItem(ws *model.WorldState, robot *model.Unit) string {
	haul := robot.Haul
	source := ws.Buildings[haul.FromBuildingID]
	target := ws.Buildings[haul.ToBuildingID]
	if source == nil || target == nil || source.Storage == nil {
		return ""
	}
	for _, itemID := range source.Storage.OutputCandidates() {
		if haulPickupQuantity(source, itemID) <= 0 {
			continue
		}
		if _, ok := model.Item(itemID); !ok {
			continue
		}
		if accepted, _ := haulDepositPreview(target, itemID, 1); accepted <= 0 {
			continue
		}
		return itemID
	}
	return ""
}

// haulPickupQuantity 起点当前可取出量（输出缓存 + 主库存，反馈料只算输出缓存）。
func haulPickupQuantity(source *model.Building, itemID string) int {
	if source == nil || source.Storage == nil || itemID == "" {
		return 0
	}
	return source.ExportableItemQuantity(itemID)
}

// haulDepositPreview 终点当前能接收多少件（不落货）。
// 与 transfer_item to_building 同一套规则：研究站只收矩阵、喷涂机只收增产剂、
// 物流站先配槽位，产出预留由 StorageState 自己扣。
func haulDepositPreview(target *model.Building, itemID string, quantity int) (int, int) {
	if target == nil || quantity <= 0 {
		return 0, quantity
	}
	if target.Storage == nil {
		if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
			return target.LogisticsStation.AvailableItemCapacity(itemID), quantity
		}
		return 0, quantity
	}
	if target.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			return 0, quantity
		}
	}
	if researchLabIntakeRejection(target, itemID) != "" {
		return 0, quantity
	}
	if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
		return target.LogisticsStation.AvailableItemCapacity(itemID), quantity
	}
	accepted, remaining, err := target.Storage.PreviewReceive(itemID, quantity)
	if err != nil {
		return 0, quantity
	}
	return accepted, remaining
}

// haulDepositIntoBuilding 实际落货到终点建筑，返回「收下 / 剩余」。
func haulDepositIntoBuilding(target *model.Building, itemID string, quantity int) (int, int) {
	if target == nil || quantity <= 0 {
		return 0, quantity
	}
	if target.Storage == nil {
		if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
			accepted, remaining, _ := target.LogisticsStation.ReceiveItem(itemID, quantity)
			return accepted, remaining
		}
		return 0, quantity
	}
	if target.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			return 0, quantity
		}
	}
	if researchLabIntakeRejection(target, itemID) != "" {
		return 0, quantity
	}
	if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
		accepted, remaining, _ := target.LogisticsStation.ReceiveItem(itemID, quantity)
		return accepted, remaining
	}
	accepted, remaining, err := target.Storage.Load(itemID, quantity)
	if err != nil {
		return 0, quantity
	}
	return accepted, remaining
}

// ringHasBuilding 该格是否属于建筑占地外圈的相邻格。
func ringHasBuilding(ws *model.WorldState, building *model.Building, pos model.Position) bool {
	if building == nil || ws.BuildingOccupies(building, pos) {
		return false
	}
	for _, neighbor := range ws.SurfaceNeighbors(pos) {
		if ws.BuildingOccupies(building, neighbor) {
			return true
		}
	}
	return false
}

// haulApproachCell 选一个建筑外圈的相邻格作为落点：优先离机器人最近的
// 「无建筑、可通行、无同层单位」格（外圈格被别的建筑占着或站了人时换一个）。
func haulApproachCell(ws *model.WorldState, robot *model.Unit, building *model.Building) (model.Position, bool) {
	best := 0
	var dest model.Position
	found := false
	for _, cell := range ws.SurfaceDisc(building.Position, buildingRingSearchRadius(ws, building)) {
		if !ringHasBuilding(ws, building, cell) {
			continue
		}
		if !tileWalkableForUnit(ws, cell, robot.ID) {
			continue
		}
		distance := ws.SurfaceDistance(robot.Position, cell)
		if !found || distance < best {
			dest = cell
			best = distance
			found = true
		}
	}
	return dest, found
}

// buildingRingSearchRadius 覆盖整个占地外圈所需的搜索半径（图距离）。
func buildingRingSearchRadius(ws *model.WorldState, building *model.Building) int {
	tiles, err := ws.BuildingTiles(building)
	if err != nil || len(tiles) == 0 {
		return 1
	}
	radius := 1
	for _, tile := range tiles {
		if d := ws.SurfaceDistance(building.Position, tile); d > radius {
			radius = d
		}
	}
	return radius + 1
}
