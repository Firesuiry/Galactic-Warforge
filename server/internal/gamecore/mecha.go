package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

func mechaStateEvent(unit *model.Unit) *model.GameEvent {
	snapshot := *unit.Mecha.Clone()
	return &model.GameEvent{EventType: model.EvtMechaStateChanged, VisibilityScope: unit.OwnerID, Payload: map[string]any{"entity_id": unit.ID, "mecha": snapshot, "move_range": unit.MoveRange, "attack": unit.Attack, "defense": unit.Defense, "attack_range": unit.AttackRange}}
}

func spendMechaEnergy(unit *model.Unit, cost int) *model.CommandResult {
	if unit.Mecha == nil {
		return nil
	}
	if unit.Mecha.Energy < cost {
		return &model.CommandResult{Status: model.StatusFailed, Code: model.CodeInsufficientResource, Message: fmt.Sprintf("mecha requires %d core energy, has %d; use refuel_mecha", cost, unit.Mecha.Energy)}
	}
	unit.Mecha.Energy -= cost
	return nil
}

func settleMechas(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent
	for _, unit := range ws.Units {
		if unit.Type != model.UnitTypeExecutor || unit.HP <= 0 {
			continue
		}
		beforeMecha := model.MechaState{}
		if unit.Mecha != nil {
			beforeMecha = *unit.Mecha
		}
		beforeMove, beforeAttack, beforeDefense, beforeRange := unit.MoveRange, unit.Attack, unit.Defense, unit.AttackRange
		model.SyncMechaCapabilities(unit, ws.Players[unit.OwnerID])
		m := unit.Mecha
		charge := min(10, min(m.MaxEnergy-m.Energy, m.FuelEnergy))
		m.Energy += charge
		m.FuelEnergy -= charge
		if m.Shield < m.MaxShield && m.Energy > 0 && ws.Tick-m.LastHitTick >= m.ShieldRechargeDelay {
			m.Energy--
			m.Shield += min(2, m.MaxShield-m.Shield)
		}
		if beforeMecha != *m || beforeMove != unit.MoveRange || beforeAttack != unit.Attack || beforeDefense != unit.Defense || beforeRange != unit.AttackRange {
			events = append(events, mechaStateEvent(unit))
		}
	}
	events = append(events, settleMechaJobs(ws)...)
	return events
}

func (gc *GameCore) execRefuelMecha(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	fail := func(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
	}
	unit := ws.Units[cmd.Target.EntityID]
	if unit == nil {
		return fail(model.CodeEntityNotFound, "mecha unit not found")
	}
	if unit.OwnerID != playerID {
		return fail(model.CodeNotOwner, "cannot refuel another player's mecha")
	}
	if unit.Type != model.UnitTypeExecutor {
		return fail(model.CodeInvalidTarget, "refuel_mecha requires the player executor")
	}
	itemID, err := payloadStrictString(cmd.Payload, "item_id")
	if err != nil {
		return fail(model.CodeValidationFailed, err.Error())
	}
	quantity, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil || quantity <= 0 {
		return fail(model.CodeValidationFailed, "payload.quantity must be a positive integer")
	}
	fuel, ok := model.Item(itemID)
	if !ok || fuel.MechaFuelEnergy <= 0 {
		return fail(model.CodeInvalidTarget, "item cannot fuel the mecha core")
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail(model.CodeEntityNotFound, "player not found")
	}
	model.SyncMechaCapabilities(unit, player)
	m := unit.Mecha
	if m.Energy >= m.MaxEnergy || m.FuelEnergy > 0 {
		return fail(model.CodeInvalidTarget, "mecha is full or still has stored fuel energy")
	}
	missing := m.MaxEnergy - m.Energy
	used := min(quantity, (missing+fuel.MechaFuelEnergy-1)/fuel.MechaFuelEnergy)
	if !player.DeductItems([]model.ItemAmount{{ItemID: itemID, Quantity: used}}) {
		return fail(model.CodeInsufficientResource, fmt.Sprintf("need %d %s in inventory", used, itemID))
	}
	available := used * fuel.MechaFuelEnergy
	charge := min(missing, available)
	m.Energy += charge
	m.FuelEnergy = available - charge
	event := mechaStateEvent(unit)
	event.Payload["fuel_item_id"], event.Payload["fuel_used"] = itemID, used
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("mecha replenished %d energy using %d %s", charge, used, itemID)}, []*model.GameEvent{event}
}
