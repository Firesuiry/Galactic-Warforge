package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
)

func (gc *GameCore) execProduce(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "production building not found")
	}
	if b.OwnerID != playerID {
		return mechaJobFailed(model.CodeNotOwner, "cannot use another player's producer")
	}
	id, err := payloadStrictString(cmd.Payload, "unit_type")
	if err != nil {
		return mechaJobFailed(model.CodeValidationFailed, err.Error())
	}
	entry, ok := model.PublicWorldProduceUnitByID(id)
	if !ok {
		return mechaJobFailed(model.CodeValidationFailed, "unit is not publicly available for produce")
	}
	if b.Type != entry.Producer {
		return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("%s requires %s", id, entry.Producer))
	}
	if entry.UnlockTech != "" && (ws.Players[playerID].Tech == nil || !ws.Players[playerID].Tech.HasTech(entry.UnlockTech)) {
		return mechaJobFailed(model.CodeValidationFailed, "unit requires research")
	}
	if len(b.UnitQueue) >= 20 {
		return mechaJobFailed(model.CodeInvalidTarget, "production queue is full")
	}
	for _, cost := range entry.Cost {
		if b.Storage.ItemQuantity(cost.ItemID) < cost.Quantity {
			return mechaJobFailed(model.CodeInsufficientResource, fmt.Sprintf("producer needs %d %s", cost.Quantity, cost.ItemID))
		}
	}
	for _, cost := range entry.Cost {
		consumeTurretAmmunition(b.Storage, cost.ItemID, cost.Quantity)
	}
	b.UnitQueue = append(b.UnitQueue, model.UnitProductionOrder{UnitType: model.UnitType(id), RemainingTicks: entry.ProductionTicks, TotalTicks: entry.ProductionTicks})
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("%s queued (%d ticks)", id, entry.ProductionTicks)}, []*model.GameEvent{unitProductionEvent(b)}
}

func unitProductionEvent(b *model.Building) *model.GameEvent {
	return &model.GameEvent{EventType: model.EvtBuildingStateChanged, VisibilityScope: b.OwnerID, Payload: map[string]any{"entity_id": b.ID, "unit_queue": append([]model.UnitProductionOrder(nil), b.UnitQueue...), "rally_point": b.RallyPoint}}
}

func settleUnitProduction(ws *model.WorldState) []*model.GameEvent {
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var events []*model.GameEvent
	for _, id := range ids {
		b := ws.Buildings[id]
		if b == nil || b.HP <= 0 || len(b.UnitQueue) == 0 {
			continue
		}
		if ok, _ := buildingOperationalForCommand(ws, b); !ok {
			continue
		}
		order := &b.UnitQueue[0]
		if order.RemainingTicks > 0 {
			order.RemainingTicks--
		}
		if order.RemainingTicks > 0 {
			continue
		}
		pos := findAdjacentFree(ws, b.Position)
		if pos == nil {
			continue
		}
		u := model.UnitStats(order.UnitType)
		u.ID = ws.NextEntityID("u")
		u.OwnerID = b.OwnerID
		u.Position = *pos
		ws.Units[u.ID] = &u
		key := model.TileKey(pos.X, pos.Y)
		ws.TileUnits[key] = append(ws.TileUnits[key], u.ID)
		if b.RallyPoint != nil {
			if path, ok := computeUnitPath(ws, u.Position, *b.RallyPoint, u.ID); ok {
				u.Path = path
				u.PathIndex = 1
				u.Stance = model.UnitStanceMoving
			}
		}
		b.UnitQueue = b.UnitQueue[1:]
		events = append(events, &model.GameEvent{EventType: model.EvtEntityCreated, VisibilityScope: b.OwnerID, Payload: map[string]any{"entity_type": "unit", "entity_id": u.ID, "unit": u.Clone(), "planet_id": ws.PlanetID}}, unitProductionEvent(b))
	}
	return events
}

func (gc *GameCore) execSetRallyPoint(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "producer not found")
	}
	if b.OwnerID != playerID {
		return mechaJobFailed(model.CodeNotOwner, "producer belongs to another player")
	}
	def, ok := model.BuildingDefinitionByID(b.Type)
	if !ok || !def.CanProduceUnits {
		return mechaJobFailed(model.CodeInvalidTarget, "target is not a unit producer")
	}
	pos := cmd.Target.Position
	if pos == nil || !ws.InBounds(pos.X, pos.Y) || !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return mechaJobFailed(model.CodeInvalidTarget, "rally point must be walkable")
	}
	copy := *pos
	b.RallyPoint = &copy
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "rally point set"}, []*model.GameEvent{unitProductionEvent(b)}
}
