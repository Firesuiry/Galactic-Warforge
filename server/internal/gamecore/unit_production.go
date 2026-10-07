package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
)

type producePayload struct {
	UnitType string `json:"unit_type" payload:"required"`
}

func (gc *GameCore) execProduce(ws *model.WorldState, playerID string, cmd model.Command, p producePayload) (model.CommandResult, []*model.GameEvent) {
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "未找到生产建筑")
	}
	if b.OwnerID != playerID {
		return mechaJobFailed(model.CodeNotOwner, "不能使用其他玩家的生产建筑")
	}
	id := p.UnitType
	entry, ok := model.PublicWorldProduceUnitByID(id)
	if !ok {
		return mechaJobFailed(model.CodeValidationFailed, "该单位不开放生产")
	}
	if b.Type != entry.Producer {
		return mechaJobFailed(model.CodeInvalidTarget, fmt.Sprintf("%s 需由 %s 生产", id, entry.Producer))
	}
	if entry.UnlockTech != "" && (ws.Players[playerID].Tech == nil || !ws.Players[playerID].Tech.HasTech(entry.UnlockTech)) {
		return mechaJobFailed(model.CodeValidationFailed, "该单位需先研究解锁")
	}
	if len(b.UnitQueue) >= 20 {
		return mechaJobFailed(model.CodeInvalidTarget, "生产队列已满")
	}
	for _, cost := range entry.Cost {
		if b.Storage.ItemQuantity(cost.ItemID) < cost.Quantity {
			return mechaJobFailed(model.CodeInsufficientResource, fmt.Sprintf("生产建筑缺少 %d 个 %s", cost.Quantity, cost.ItemID))
		}
	}
	for _, cost := range entry.Cost {
		consumeTurretAmmunition(b.Storage, cost.ItemID, cost.Quantity)
	}
	b.UnitQueue = append(b.UnitQueue, model.UnitProductionOrder{UnitType: model.UnitType(id), RemainingTicks: entry.ProductionTicks, TotalTicks: entry.ProductionTicks})
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("%s 已加入生产队列（%d tick）", id, entry.ProductionTicks)}, []*model.GameEvent{unitProductionEvent(b)}
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

func (gc *GameCore) execSetRallyPoint(ws *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "未找到生产建筑")
	}
	if b.OwnerID != playerID {
		return mechaJobFailed(model.CodeNotOwner, "生产建筑属于其他玩家")
	}
	def, ok := model.BuildingDefinitionByID(b.Type)
	if !ok || !def.CanProduceUnits {
		return mechaJobFailed(model.CodeInvalidTarget, "目标不是单位生产建筑")
	}
	pos := cmd.Target.Position
	if pos == nil || !ws.InBounds(pos.X, pos.Y) || !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return mechaJobFailed(model.CodeInvalidTarget, "集结点必须可通行")
	}
	copy := *pos
	b.RallyPoint = &copy
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "集结点已设置"}, []*model.GameEvent{unitProductionEvent(b)}
}
