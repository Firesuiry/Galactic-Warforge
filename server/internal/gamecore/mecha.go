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

// mechaInventorySlots 返回该玩家机甲的背包格数上限（units.yaml executor.mecha
// .inventory_slots + 科技 mecha_inventory_slots）；0 = 不限（测试世界）。
//
// 所有「往机甲背包装物品」的路径都必须经过它：容量按格计（每格堆叠该物品
// 的 stack_limit 件），inventory_slots 科技既然限制取出与物流请求，就不能让
// 采矿/手搓产出、退款、战利品把背包顶到上限之上。
func mechaInventorySlots(player *model.PlayerState) int {
	if player == nil {
		return 0
	}
	return model.MechaInventorySlots(player)
}

// mechaInventoryFree 返回在 slots 格上限下还能再装下多少件 itemID
// （slots <= 0 表示不限）。与 PlayerState.AddItems 的裁剪口径一致。
func mechaInventoryFree(record *model.MechaRecord, slots int, itemID string, request int) int {
	if record == nil || request <= 0 {
		return 0
	}
	if slots <= 0 {
		return request
	}
	return min(request, record.Inventory.FreeSlotsFor(itemID, slots))
}

// mechaInventoryFullMessage 统一的「背包已满」回执：按格计（已用/总格数）。
func mechaInventoryFullMessage(record *model.MechaRecord, slots int) string {
	used := 0
	if record != nil {
		used = record.Inventory.SlotsUsed()
	}
	return fmt.Sprintf("背包已满（已用 %d/%d 格）", used, slots)
}

// itemAmountTotal 求和一组物品数量（忽略非正数项）。
func itemAmountTotal(items []model.ItemAmount) int {
	total := 0
	for _, item := range items {
		if item.Quantity > 0 {
			total += item.Quantity
		}
	}
	return total
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

// execRefuelMecha 由发令者机甲给自己补能：燃料从它自己的背包里扣。
func (gc *GameCore) execRefuelMecha(ws *model.WorldState, playerID string, cmd model.Command, p refuelMechaPayload, mecha mechaContext) (model.CommandResult, []*model.GameEvent) {
	fail := func(code model.ResultCode, message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}, nil
	}
	unit, record := mecha.Unit, mecha.Record
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
	m := unit.Mecha
	if m.Energy >= m.MaxEnergy || m.FuelEnergy > 0 {
		return fail(model.CodeInvalidTarget, "机甲核心已满或仍有未用完的燃料能量")
	}
	missing := m.MaxEnergy - m.Energy
	used := min(count, (missing+fuel.MechaFuelEnergy-1)/fuel.MechaFuelEnergy, record.Inventory[itemID])
	if used <= 0 {
		return fail(model.CodeInsufficientResource, fmt.Sprintf("背包里没有「%s」", fuel.Name))
	}
	record.DeductItems([]model.ItemAmount{{ItemID: itemID, Quantity: used}})
	available := used * fuel.MechaFuelEnergy
	charge := min(missing, available)
	m.Energy += charge
	m.FuelEnergy = available - charge
	event := mechaStateEvent(unit)
	event.Payload["fuel_item_id"], event.Payload["fuel_used"] = itemID, used
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("机甲补能 %d，消耗 %d 个「%s」", charge, used, fuel.Name)}, []*model.GameEvent{event}
}
