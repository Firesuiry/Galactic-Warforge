package gamecore

import (
	"fmt"
	"strings"

	"siliconworld/internal/model"
)

type configureMechaLogisticsPayload struct {
	Requests map[string]mechaLogisticsRequestPayload `json:"requests" payload:"required"`
}

type mechaLogisticsRequestPayload struct {
	Min *int `json:"min" payload:"required"`
	Max *int `json:"max" payload:"required"`
}

func (gc *GameCore) execConfigureMechaLogistics(ws *model.WorldState, playerID string, cmd model.Command, p configureMechaLogisticsPayload) (model.CommandResult, []*model.GameEvent) {
	unit, _, failure := mechaJobTarget(ws, playerID, cmd)
	if unit == nil {
		return failure, nil
	}
	fail := func(message string) (model.CommandResult, []*model.GameEvent) {
		return mechaJobFailed(model.CodeValidationFailed, message)
	}
	if len(p.Requests) > 8 {
		return fail("requests 必须是最多含 8 个物品槽位的对象")
	}
	requests := make(map[string]model.MechaLogisticsRequest, len(p.Requests))
	for itemID, entry := range p.Requests {
		if item, ok := model.Item(itemID); !ok || item.Form != model.ResourceSolid {
			return fail("未知的物流请求物品：" + itemDisplayName(itemID))
		}
		minimum, maximum := *entry.Min, *entry.Max
		if minimum < 0 || maximum < 1 || maximum > 1000 || minimum > maximum {
			return fail("请求范围须满足 0 <= min <= max <= 1000 且 max 为正数")
		}
		requests[itemID] = model.MechaLogisticsRequest{Min: minimum, Max: maximum}
	}
	unit.Mecha.LogisticsRequests = requests
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "机甲物流请求已更新"}, []*model.GameEvent{mechaStateEvent(unit)}
}

type transferItemPayload struct {
	buildingRef
	ItemID    string  `json:"item_id" payload:"required"`
	Quantity  int     `json:"quantity" payload:"required"`
	Direction *string `json:"direction"`
}

func (gc *GameCore) execTransferItem(ws *model.WorldState, playerID string, cmd model.Command, p transferItemPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, itemID, quantity := p.BuildingID, p.ItemID, p.Quantity
	if quantity <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.quantity 必须为正数"
		return res, nil
	}
	if _, ok := model.Item(itemID); !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("未知物品：%s", itemDisplayName(itemID))
		return res, nil
	}

	building, ok := ws.Buildings[buildingID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到建筑（可能已被拆除）"
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能使用其他玩家的建筑"
		return res, nil
	}
	if building.Storage == nil && !(model.IsGroundLogisticsBuilding(building.Type) && building.LogisticsStation != nil) {
		res.Code = model.CodeValidationFailed
		res.Message = "目标建筑没有存储"
		return res, nil
	}

	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		res.Code = model.CodeValidationFailed
		res.Message = "玩家不存在或已阵亡"
		return res, nil
	}
	direction := "to_building"
	if p.Direction != nil {
		direction = *p.Direction
		if direction != "to_building" && direction != "to_player" {
			return mechaJobFailed(model.CodeValidationFailed, "direction 必须为 to_building 或 to_player")
		}
	}
	if direction == "to_player" {
		if building.Storage == nil {
			return mechaJobFailed(model.CodeInvalidTarget, "只能从存储建筑取出物品")
		}
		executor := player.ExecutorForPlanet(ws.PlanetID)
		if executor == nil || ws.Units[executor.UnitID] == nil || ws.Units[executor.UnitID].Mecha == nil {
			return mechaJobFailed(model.CodeInvalidTarget, "需要存活的执行者来接收物品")
		}
		unit := ws.Units[executor.UnitID]
		model.SyncMechaCapabilities(unit, player)
		used := player.InventoryCount()
		// 试玩报告 1013 C：「无可取出物品或背包已满」把两种完全不同的原因混在
		// 一起，玩家看不出是建筑里没货还是自己装不下。分开报，并给出背包占用。
		stored := building.Storage.OutputQuantity(itemID)
		if stored <= 0 {
			return mechaJobFailed(model.CodeInsufficientResource,
				fmt.Sprintf("%s里没有可取出的「%s」", buildingDisplayName(building), itemDisplayName(itemID)))
		}
		capacity := unit.Mecha.InventoryCapacity
		if capacity-used <= 0 {
			return mechaJobFailed(model.CodeInsufficientResource,
				fmt.Sprintf("背包已满（%d/%d），装不下取出的「%s」：先腾出空位或改送到别的建筑",
					used, capacity, itemDisplayName(itemID)))
		}
		quantity = min(quantity, capacity-used)
		quantity = min(quantity, stored)
		if quantity <= 0 {
			return mechaJobFailed(model.CodeInsufficientResource,
				fmt.Sprintf("背包已满（%d/%d），装不下取出的「%s」：先腾出空位或改送到别的建筑",
					used, capacity, itemDisplayName(itemID)))
		}
		taken, _, err := building.Storage.Provide(itemID, quantity)
		if err != nil {
			return mechaJobFailed(model.CodeValidationFailed, err.Error())
		}
		// 上限兜底：真正入包的数量仍由 AddItems 裁剪（容量科技在取出过程中变化也不会超）。
		// 上面已按剩余空间裁剪过，正常不会少收；万一少收，多拿出来的部分退回建筑，
		// 不能凭空消失。
		if accepted := player.AddItems([]model.ItemAmount{{ItemID: itemID, Quantity: taken}}, capacity); accepted < taken {
			_, _, _ = building.Storage.Load(itemID, taken-accepted)
			taken = accepted
		}
		return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("已取出 %d 个「%s」（来自%s）", taken, itemDisplayName(itemID), buildingDisplayName(building))}, []*model.GameEvent{{
			EventType: model.EvtEntityUpdated, VisibilityScope: playerID,
			Payload: map[string]any{"building_id": buildingID, "item_id": itemID, "transferred": taken, "source": "building_storage", "inventory_qty": player.Inventory[itemID]},
		}}
	}
	if player.Inventory[itemID] < quantity {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("背包需有 %d 个「%s」，当前 %d 个", quantity, itemDisplayName(itemID), player.Inventory[itemID])
		return res, nil
	}

	if building.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			res.Code = model.CodeValidationFailed
			res.Message = "喷涂机存储仅接受增产剂，其他货物请经其西侧传送带送入"
			return res, nil
		}
	}
	// 研究模式的研究站只吃矩阵：普通制造建筑收下原料但永远用不上，会把
	// 机甲背包里的料卡在站里（试玩报告 1013：玩家把电路板/磁线圈塞进研究站
	// 后只看到「已传输」，完全不知道它们不会被消耗）。与其收下，不如拒绝并
	// 说清该往哪里送。
	if rejected := researchLabIntakeRejection(building, itemID); rejected != "" {
		res.Code = model.CodeValidationFailed
		res.Message = rejected
		return res, nil
	}
	var accepted, remaining int
	var err error
	if model.IsGroundLogisticsBuilding(building.Type) && building.LogisticsStation != nil {
		accepted, remaining, err = building.LogisticsStation.ReceiveItem(itemID, quantity)
	} else {
		accepted, remaining, err = building.Storage.Load(itemID, quantity)
	}
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if accepted <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("%s无法接收「%s」", buildingDisplayName(building), itemDisplayName(itemID))
		return res, nil
	}

	inv := player.EnsureInventory()
	inv[itemID] -= accepted
	if inv[itemID] <= 0 {
		delete(inv, itemID)
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	// 回执必须说清「实际装入多少、为什么装不下」（试玩 1014 层 04 P1：装入 60 铁矿只
	// 显示「已受理」，实际只收 29，玩家完全不知道差额去哪了）。剩余量仍在背包里，
	// 未装入不扣背包。
	if remaining > 0 {
		res.Message = fmt.Sprintf("已装入 %d 个「%s」至%s，%d 个留在背包（%s）",
			accepted, itemDisplayName(itemID), buildingDisplayName(building), remaining, transferLoadBlockReason(building, itemID))
	} else {
		res.Message = fmt.Sprintf("已传输 %d 个「%s」至%s", accepted, itemDisplayName(itemID), buildingDisplayName(building))
	}

	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"building_id":   buildingID,
			"item_id":       itemID,
			"transferred":   accepted,
			"source":        "player_inventory",
			"remaining":     remaining,
			"inventory_qty": inv[itemID],
		},
	}}
}

// transferLoadBlockReason 解释「装入为什么没全收」：优先说产出预留（玩家最难看懂的
// 那一类——建筑明明没满却收不下），否则给主库存/输入缓冲的占用情况。
func transferLoadBlockReason(building *model.Building, itemID string) string {
	if building == nil || building.Storage == nil {
		return "建筑暂存已满"
	}
	storage := building.Storage
	if storage.Reserve > 0 && storage.UsedInventory() >= storage.Capacity-storage.Reserve {
		return fmt.Sprintf("主库存 %d/%d 已到产出预留线（预留 %d 个空位给成品「%s」，先取出成品再装入）",
			storage.UsedInventory(), storage.Capacity, storage.Reserve, transferReservedItemNames(building))
	}
	if storage.Capacity > 0 && storage.UsedInventory() >= storage.Capacity {
		return fmt.Sprintf("主库存已满 %d/%d，先取出部分物品", storage.UsedInventory(), storage.Capacity)
	}
	if storage.InputBufferSpace() <= 0 && storage.UsedInputBuffer() > 0 {
		return "输入缓冲已满，等建筑消耗后再装入"
	}
	if !storage.CanAcceptNewItem(itemID) {
		return fmt.Sprintf("建筑只接受 %d 种物品，槽位已满", storage.Slots)
	}
	return "建筑暂存已满"
}

// transferReservedItemNames 列出产出预留服务的成品中文名（预留来自当前配方的一批产出）。
func transferReservedItemNames(building *model.Building) string {
	if building == nil || building.Production == nil || building.Production.RecipeID == "" {
		return "成品"
	}
	recipe, ok := model.Recipe(building.Production.RecipeID)
	if !ok {
		return "成品"
	}
	names := make([]string, 0, len(recipe.Outputs))
	for _, output := range recipe.Outputs {
		if output.ItemID != "" {
			names = append(names, itemDisplayName(output.ItemID))
		}
	}
	if len(names) == 0 {
		return "成品"
	}
	return strings.Join(names, "、")
}
