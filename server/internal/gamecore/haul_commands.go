package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// haul 指令（§2）：给运输机器人指定「起点建筑 → 终点建筑（可选单一物品）」的往返路线。
//
// 校验（全部中文回执）：
//   - 机器人类型必须是 transport_robot（其它单位下 haul 一律拒绝）；
//   - 起点/终点都必须存在、属于本玩家、且与机器人同行星（行星路由已保证同行星，
//     跨行星的 ID 在本世界上查不到，按「不存在」拒绝）；
//   - 起点要能取货（有存储或物流站库存）；
//   - 终点要能收货（有存储或物流站；喷涂机只收增产剂、研究站只收矩阵）；
//   - 指定 item_id 时必须是目录里的已知物品，且终点在结构上能收这类物品
//     （研究站只收矩阵、喷涂机只收增产剂、物流站先配槽位）——「终点暂时满了」
//     不算校验失败，机器人到点后等（waiting_target）。
//
// 「起点暂时没货 / 终点暂时收不下」不是校验失败：机器人到点后进入
// waiting_source / waiting_target 等待（见 transport_robot_settlement.go）。
//
// 校验通过时返回给玩家的中文回执（单台机器人的路线描述）。
func assignHaulRoute(ws *model.WorldState, playerID string, robot *model.Unit, p unitOrderPayload) (string, *model.CommandResult) {
	fail := func(code model.ResultCode, message string) (string, *model.CommandResult) {
		return "", &model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	if robot.Type != model.UnitTypeTransportRobot || robot.Haul == nil {
		return fail(model.CodeInvalidTarget, fmt.Sprintf("%s不是运输机器人，只有运输机器人可以执行 haul（运输）指令", unitDisplayName(robot)))
	}
	if p.FromBuildingID == "" || p.ToBuildingID == "" {
		return fail(model.CodeValidationFailed, "haul 指令缺少 payload.from_building_id 或 payload.to_building_id")
	}
	if p.FromBuildingID == p.ToBuildingID {
		return fail(model.CodeInvalidTarget, "运输起点与终点不能是同一座建筑")
	}
	source := ws.Buildings[p.FromBuildingID]
	if source == nil {
		return fail(model.CodeEntityNotFound, "未找到运输起点建筑（可能已拆除或不在本行星）")
	}
	target := ws.Buildings[p.ToBuildingID]
	if target == nil {
		return fail(model.CodeEntityNotFound, "未找到运输终点建筑（可能已拆除或不在本行星）")
	}
	if source.OwnerID != playerID || target.OwnerID != playerID {
		return fail(model.CodeNotOwner, "运输起点与终点都必须是自己（或本队）的建筑")
	}
	if source.HP <= 0 || target.HP <= 0 {
		return fail(model.CodeInvalidTarget, "运输起点或终点已被摧毁")
	}
	if !buildingCanProvideItems(source) {
		return fail(model.CodeInvalidTarget, fmt.Sprintf("%s没有可取出物品的存储（需要储物仓、生产建筑或物流站）", buildingDisplayName(source)))
	}
	if !buildingCanReceiveItems(target) {
		return fail(model.CodeInvalidTarget, fmt.Sprintf("%s没有可装入物品的存储（需要储物仓、生产建筑或物流站）", buildingDisplayName(target)))
	}
	itemID := p.ItemID
	if itemID != "" {
		if _, ok := model.Item(itemID); !ok {
			return fail(model.CodeValidationFailed, fmt.Sprintf("未知物品：%s", itemDisplayName(itemID)))
		}
		if reason := haulItemIntakeRejection(target, itemID); reason != "" {
			return fail(model.CodeInvalidTarget, reason)
		}
	}

	robot.Haul.FromBuildingID = source.ID
	robot.Haul.ToBuildingID = target.ID
	robot.Haul.ItemID = itemID
	robot.Haul.DeliveredTotal = 0
	if robot.Haul.CargoQuantity() > 0 {
		robot.Haul.Phase = model.HaulPhaseToTarget
	} else {
		robot.Haul.Phase = model.HaulPhaseToSource
	}
	robot.ClearEngagement()
	robot.Stance = model.UnitStanceMoving
	robot.OrderPos = nil
	robot.GuardTargetID = ""

	itemLabel := "任意可取物品"
	if itemID != "" {
		itemLabel = itemDisplayName(itemID)
	}
	return fmt.Sprintf("%s已开始运输：%s → %s（%s，每趟最多 %d 件）",
		unitDisplayName(robot), buildingDisplayName(source), buildingDisplayName(target), itemLabel, haulCargoCapacity), nil
}

// haulItemIntakeRejection 结构性拒收原因：终点「永远收不下」这种物品。
// 与「暂时满了」区分开——后者不是校验失败，机器人到点等（waiting_target）。
func haulItemIntakeRejection(target *model.Building, itemID string) string {
	if target == nil {
		return "运输终点建筑不存在"
	}
	if reason := researchLabIntakeRejection(target, itemID); reason != "" {
		return reason
	}
	if target.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			return fmt.Sprintf("%s只接受增产剂，「%s」请送到制造台或仓库", buildingDisplayName(target), itemDisplayName(itemID))
		}
		return ""
	}
	if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
		if !target.LogisticsStation.ConfiguredItem(itemID) {
			return fmt.Sprintf("%s尚未为「%s」配置物流槽位，先配置槽位再运输", buildingDisplayName(target), itemDisplayName(itemID))
		}
		return ""
	}
	if target.Storage != nil && !target.Storage.CanAcceptNewItem(itemID) {
		return fmt.Sprintf("%s只接受固定几种物品（%d 个槽位已满），「%s」放不进去", buildingDisplayName(target), target.Storage.Slots, itemDisplayName(itemID))
	}
	return ""
}

// buildingCanProvideItems 该建筑是否有可取货的存储。
func buildingCanProvideItems(b *model.Building) bool {
	if b == nil {
		return false
	}
	if b.Storage != nil {
		return true
	}
	return model.IsGroundLogisticsBuilding(b.Type) && b.LogisticsStation != nil
}

// buildingCanReceiveItems 该建筑是否有可收货的存储（不看当前是否装满）。
func buildingCanReceiveItems(b *model.Building) bool {
	return buildingCanProvideItems(b)
}
