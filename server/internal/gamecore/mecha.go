package gamecore

import (
	"fmt"
	"reflect"

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
		return &model.CommandResult{Status: model.StatusFailed, Code: model.CodeInsufficientResource, Message: fmt.Sprintf("机甲核心能量不足：需要 %d，现有 %d，请先补能", cost, unit.Mecha.Energy)}
	}
	unit.Mecha.Energy -= cost
	return nil
}

func settleMechas(ws *model.WorldState) []*model.GameEvent {
	events := settleExecutorRespawns(ws)
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
		// 被动回能：units.yaml executor.mecha.energy_regen_ticks 决定每多少 tick 回 1 点核心能量。
		// 只有行军耗能（1 点/格）的一半左右，长途行军不用反复回家补能，
		// 但煤（25 点/块）与电网充电仍是有效的补给手段。核心已满时不回能，保持幂等。
		if regenTicks := model.MechaEnergyRegenTicks(); regenTicks > 0 && ws.Tick%int64(regenTicks) == 0 && m.Energy < m.MaxEnergy {
			m.Energy++
		}
		charge := min(10, min(m.MaxEnergy-m.Energy, m.FuelEnergy))
		m.Energy += charge
		m.FuelEnergy -= charge
		if m.Shield < m.MaxShield && m.Energy > 0 && ws.Tick-m.LastHitTick >= m.ShieldRechargeDelay {
			m.Energy--
			m.Shield += min(2, m.MaxShield-m.Shield)
		}
		if !reflect.DeepEqual(beforeMecha, *m) || beforeMove != unit.MoveRange || beforeAttack != unit.Attack || beforeDefense != unit.Defense || beforeRange != unit.AttackRange {
			events = append(events, mechaStateEvent(unit))
		}
	}
	events = append(events, settleMechaJobs(ws)...)
	return events
}

type refuelMechaPayload struct {
	ItemID string `json:"item_id" payload:"required"`
	// Count 最多烧几块燃料，缺省 1；烧到核心满为止，背包不足时烧掉现有的。
	Count int `json:"count"`
}

func (gc *GameCore) execRefuelMecha(ws *model.WorldState, playerID string, cmd model.Command, p refuelMechaPayload) (model.CommandResult, []*model.GameEvent) {
	fail := func(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
	}
	unit := ws.Units[cmd.Target.EntityID]
	if unit == nil {
		return fail(model.CodeEntityNotFound, "未找到机甲单位")
	}
	if unit.OwnerID != playerID {
		return fail(model.CodeNotOwner, "不能给其他玩家的机甲补能")
	}
	if unit.Type != model.UnitTypeExecutor {
		return fail(model.CodeInvalidTarget, "只能给玩家机甲补能")
	}
	itemID, count := p.ItemID, p.Count
	if count == 0 {
		count = 1
	}
	if count < 0 {
		return fail(model.CodeValidationFailed, "payload.count 必须为正整数")
	}
	fuel, ok := model.Item(itemID)
	if !ok || fuel.MechaFuelEnergy <= 0 {
		return fail(model.CodeInvalidTarget, "该物品不能作为机甲燃料")
	}
	player := ws.Players[playerID]
	if player == nil {
		return fail(model.CodeEntityNotFound, "未找到玩家")
	}
	model.SyncMechaCapabilities(unit, player)
	m := unit.Mecha
	if m.Energy >= m.MaxEnergy || m.FuelEnergy > 0 {
		return fail(model.CodeInvalidTarget, "机甲核心已满或仍有未用完的燃料能量")
	}
	missing := m.MaxEnergy - m.Energy
	used := min(count, (missing+fuel.MechaFuelEnergy-1)/fuel.MechaFuelEnergy, player.Inventory[itemID])
	if used <= 0 {
		return fail(model.CodeInsufficientResource, fmt.Sprintf("背包里没有「%s」", fuel.Name))
	}
	player.DeductItems([]model.ItemAmount{{ItemID: itemID, Quantity: used}})
	available := used * fuel.MechaFuelEnergy
	charge := min(missing, available)
	m.Energy += charge
	m.FuelEnergy = available - charge
	event := mechaStateEvent(unit)
	event.Payload["fuel_item_id"], event.Payload["fuel_used"] = itemID, used
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("机甲补能 %d，消耗 %d 个「%s」", charge, used, fuel.Name)}, []*model.GameEvent{event}
}
