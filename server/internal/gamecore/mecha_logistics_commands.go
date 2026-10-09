package gamecore

import (
	"fmt"

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
		used := 0
		for _, amount := range player.Inventory {
			used += amount
		}
		quantity = min(quantity, max(0, unit.Mecha.InventoryCapacity-used))
		quantity = min(quantity, building.Storage.OutputQuantity(itemID))
		if quantity <= 0 {
			return mechaJobFailed(model.CodeInsufficientResource, "无可取出物品或背包已满")
		}
		taken, _, err := building.Storage.Provide(itemID, quantity)
		if err != nil {
			return mechaJobFailed(model.CodeValidationFailed, err.Error())
		}
		player.EnsureInventory()[itemID] += taken
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
	if remaining > 0 {
		res.Message = fmt.Sprintf("已传输 %d 个「%s」至%s（剩余 %d 个）", accepted, itemDisplayName(itemID), buildingDisplayName(building), remaining)
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
