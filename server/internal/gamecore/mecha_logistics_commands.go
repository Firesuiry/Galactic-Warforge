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
		return fail("requests must be an object with at most 8 item slots")
	}
	requests := make(map[string]model.MechaLogisticsRequest, len(p.Requests))
	for itemID, entry := range p.Requests {
		if item, ok := model.Item(itemID); !ok || item.Form != model.ResourceSolid {
			return fail("unknown logistics request item: " + itemID)
		}
		minimum, maximum := *entry.Min, *entry.Max
		if minimum < 0 || maximum < 1 || maximum > 1000 || minimum > maximum {
			return fail("request bounds require 0 <= min <= max <= 1000 and positive max")
		}
		requests[itemID] = model.MechaLogisticsRequest{Min: minimum, Max: maximum}
	}
	unit.Mecha.LogisticsRequests = requests
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "mecha logistics requests replaced"}, []*model.GameEvent{mechaStateEvent(unit)}
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
		res.Message = "payload.quantity must be positive"
		return res, nil
	}
	if _, ok := model.Item(itemID); !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown item: %s", itemID)
		return res, nil
	}

	building, ok := ws.Buildings[buildingID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	if building.Storage == nil && !(model.IsGroundLogisticsBuilding(building.Type) && building.LogisticsStation != nil) {
		res.Code = model.CodeValidationFailed
		res.Message = "target building has no storage"
		return res, nil
	}

	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		res.Code = model.CodeValidationFailed
		res.Message = "player not found or not alive"
		return res, nil
	}
	direction := "to_building"
	if p.Direction != nil {
		direction = *p.Direction
		if direction != "to_building" && direction != "to_player" {
			return mechaJobFailed(model.CodeValidationFailed, "direction must be to_building or to_player")
		}
	}
	if direction == "to_player" {
		if building.Storage == nil {
			return mechaJobFailed(model.CodeInvalidTarget, "take items from a storage building")
		}
		executor := player.ExecutorForPlanet(ws.PlanetID)
		if executor == nil || ws.Units[executor.UnitID] == nil || ws.Units[executor.UnitID].Mecha == nil {
			return mechaJobFailed(model.CodeInvalidTarget, "living executor required to receive items")
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
			return mechaJobFailed(model.CodeInsufficientResource, "no output available or inventory full")
		}
		taken, _, err := building.Storage.Provide(itemID, quantity)
		if err != nil {
			return mechaJobFailed(model.CodeValidationFailed, err.Error())
		}
		player.EnsureInventory()[itemID] += taken
		return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("collected %d %s from %s", taken, itemID, buildingID)}, []*model.GameEvent{{
			EventType: model.EvtEntityUpdated, VisibilityScope: playerID,
			Payload: map[string]any{"building_id": buildingID, "item_id": itemID, "transferred": taken, "source": "building_storage", "inventory_qty": player.Inventory[itemID]},
		}}
	}
	if player.Inventory[itemID] < quantity {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d %s in inventory, have %d", quantity, itemID, player.Inventory[itemID])
		return res, nil
	}

	if building.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			res.Code = model.CodeValidationFailed
			res.Message = "spray coater storage accepts proliferator only; route cargo through its west belt"
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
		res.Message = fmt.Sprintf("building %s cannot accept %s", buildingID, itemID)
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
		res.Message = fmt.Sprintf("transferred %d %s into %s (%d remaining)", accepted, itemID, buildingID, remaining)
	} else {
		res.Message = fmt.Sprintf("transferred %d %s into %s", accepted, itemID, buildingID)
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
