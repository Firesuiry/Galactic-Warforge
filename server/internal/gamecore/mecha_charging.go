package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

const (
	teslaMechaChargePerTick    = 2
	wirelessMechaChargePerTick = 10
)

// settleMechaCharging uses only real surplus from the tower's connected network.
// Called after storage accounting and before committing player resource balances.
func settleMechaCharging(ws *model.WorldState, snapshot *model.PowerSettlementSnapshot) []*model.GameEvent {
	if ws == nil || snapshot == nil || snapshot.Tick != ws.Tick {
		return nil
	}
	var towers []*model.Building
	for _, b := range ws.Buildings {
		if b == nil || b.HP <= 0 || b.Runtime.State != model.BuildingWorkRunning || b.Runtime.Functions.PowerGrid == nil {
			continue
		}
		if b.Type == model.BuildingTypeTeslaTower || b.Type == model.BuildingTypeWirelessPowerTower {
			towers = append(towers, b)
		}
	}
	// Prefer the faster tower. Stable ordering also makes competing mechas deterministic.
	sort.Slice(towers, func(i, j int) bool {
		if towers[i].Type != towers[j].Type {
			return towers[i].Type == model.BuildingTypeWirelessPowerTower
		}
		return towers[i].ID < towers[j].ID
	})
	var ids []string
	for id, u := range ws.Units {
		if u != nil && u.Type == model.UnitTypeExecutor && u.HP > 0 && u.Mecha != nil {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	towerCharge := make(map[string]int)
	var events []*model.GameEvent
	for _, id := range ids {
		unit := ws.Units[id]
		player := ws.Players[unit.OwnerID]
		if player == nil || !player.IsAlive || unit.Mecha.Energy >= unit.Mecha.MaxEnergy {
			continue
		}
		for _, tower := range towers {
			if tower.OwnerID != unit.OwnerID || ws.SurfaceDistance(unit.Position, tower.Position) > tower.Runtime.Functions.PowerGrid.WirelessRange {
				continue
			}
			networkID := snapshot.Networks.BuildingNetwork[tower.ID]
			allocation := snapshot.Allocations.Networks[networkID]
			if allocation == nil || allocation.OwnerID != unit.OwnerID {
				continue
			}
			base := snapshot.Allocations.Buildings[tower.ID]
			if model.PowerDemandForBuilding(tower) > 0 && (base.Demand <= 0 || base.Allocated < base.Demand) {
				continue
			}
			surplus := allocation.Supply - allocation.Allocated
			rate := teslaMechaChargePerTick
			if tower.Type == model.BuildingTypeWirelessPowerTower {
				rate = wirelessMechaChargePerTick
			}
			// energy_circuit research raises the per-tick grid charge rate.
			rate = model.MechaChargeRate(rate, player)
			amount := min(rate-towerCharge[tower.ID], min(surplus, unit.Mecha.MaxEnergy-unit.Mecha.Energy))
			if amount <= 0 {
				continue
			}
			towerCharge[tower.ID] += amount
			unit.Mecha.Energy += amount
			recordSurplusPowerConsumption(snapshot, tower.ID, amount)
			event := mechaStateEvent(unit)
			event.Payload["charging_building_id"] = tower.ID
			event.Payload["charging_network_id"] = networkID
			event.Payload["grid_charge"] = amount
			events = append(events, event)
			break
		}
	}
	return events
}
