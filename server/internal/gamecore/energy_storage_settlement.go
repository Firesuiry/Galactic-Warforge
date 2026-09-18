package gamecore

import (
	"sort"

	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
)

func settleEnergyStorage(ws *model.WorldState) map[string]int {
	charged := make(map[string]int)
	if ws == nil {
		return charged
	}

	ws.PowerInputs = filterStoragePowerInputs(ws.PowerInputs)

	networks := model.ResolvePowerNetworks(ws)
	if len(networks.Networks) == 0 {
		return charged
	}

	for _, network := range networks.Networks {
		if network == nil {
			continue
		}
		nodes := model.EnergyStorageNodesForNetwork(ws, network)
		if len(nodes) == 0 {
			continue
		}
		balance := model.NetworkHasEnergyHub(ws, network)
		deficit := network.Demand - network.Supply
		if deficit > 0 {
			actions, used := model.ApplyEnergyStorageDischarge(nodes, deficit, balance)
			for _, action := range actions {
				if action.DischargeOutput <= 0 {
					continue
				}
				ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{
					BuildingID: action.BuildingID,
					OwnerID:    network.OwnerID,
					SourceKind: modelpower.PowerSourceStorage,
					Output:     action.DischargeOutput,
				})
			}
			if remaining := deficit - used; remaining > 0 {
				dischargeExchangerItems(ws, network, remaining)
			}
			continue
		}
		if deficit < 0 {
			surplus := -deficit
			actions, used := model.ApplyEnergyStorageCharge(nodes, surplus, balance)
			for _, action := range actions {
				charged[action.BuildingID] += action.ChargeInput
			}
			if remaining := surplus - used; remaining > 0 {
				chargeExchangerItems(ws, network, remaining, charged)
			}
		}
	}
	return charged
}

// networkEnergyExchangers returns the energy-exchanger hub buildings of a
// network in stable id order.
func networkEnergyExchangers(ws *model.WorldState, network *model.PowerNetwork) []*model.Building {
	if ws == nil || network == nil {
		return nil
	}
	ids := append([]string(nil), network.NodeIDs...)
	sort.Strings(ids)
	out := make([]*model.Building, 0, len(ids))
	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil {
			continue
		}
		module := building.Runtime.Functions.EnergyExchanger
		if module == nil || !module.Hub {
			continue
		}
		out = append(out, building)
	}
	return out
}

// chargeExchangerItems converts empty accumulator items into full ones inside
// charge-mode energy exchangers, spending grid surplus. The consumed energy is
// recorded through the shared `charged` accounting so the power snapshot keeps
// the exchanger aligned with regular energy-storage charging (no double spend
// of surplus).
func chargeExchangerItems(ws *model.WorldState, network *model.PowerNetwork, surplus int, charged map[string]int) {
	if surplus <= 0 {
		return
	}
	for _, building := range networkEnergyExchangers(ws, network) {
		if surplus <= 0 {
			return
		}
		module := building.Runtime.Functions.EnergyExchanger
		if module.Mode != model.EnergyExchangerModeCharge {
			continue
		}
		if module.EnergyPerItem <= 0 || module.ItemsPerTick <= 0 || module.EmptyItemID == "" || module.FullItemID == "" {
			continue
		}
		if building.Storage == nil {
			model.InitBuildingStorage(building)
		}
		if building.Storage == nil {
			continue
		}
		budget := surplus / module.EnergyPerItem
		if budget > module.ItemsPerTick {
			budget = module.ItemsPerTick
		}
		converted := 0
		for i := 0; i < budget; i++ {
			if !consumeExchangerItem(building.Storage, module.EmptyItemID) {
				break
			}
			accepted, _, err := building.Storage.ReceiveOutput(module.FullItemID, 1)
			if err != nil || accepted != 1 {
				// Output side is full: refund the consumed empty item and stall.
				_, _, _ = building.Storage.Receive(module.EmptyItemID, 1)
				break
			}
			converted++
		}
		if converted > 0 {
			energy := converted * module.EnergyPerItem
			charged[building.ID] += energy
			surplus -= energy
		}
	}
}

// dischargeExchangerItems converts full accumulator items back into empty ones
// inside discharge-mode energy exchangers, publishing the released energy as
// storage power inputs aligned with regular energy-storage discharge.
func dischargeExchangerItems(ws *model.WorldState, network *model.PowerNetwork, deficit int) {
	if deficit <= 0 {
		return
	}
	for _, building := range networkEnergyExchangers(ws, network) {
		if deficit <= 0 {
			return
		}
		module := building.Runtime.Functions.EnergyExchanger
		if module.Mode != model.EnergyExchangerModeDischarge {
			continue
		}
		if module.EnergyPerItem <= 0 || module.ItemsPerTick <= 0 || module.EmptyItemID == "" || module.FullItemID == "" {
			continue
		}
		if building.Storage == nil {
			model.InitBuildingStorage(building)
		}
		if building.Storage == nil {
			continue
		}
		need := (deficit + module.EnergyPerItem - 1) / module.EnergyPerItem
		if need > module.ItemsPerTick {
			need = module.ItemsPerTick
		}
		converted := 0
		for i := 0; i < need; i++ {
			if !consumeExchangerItem(building.Storage, module.FullItemID) {
				break
			}
			accepted, _, err := building.Storage.ReceiveOutput(module.EmptyItemID, 1)
			if err != nil || accepted != 1 {
				// Output side is full: refund the consumed full item and stall.
				_, _, _ = building.Storage.Receive(module.FullItemID, 1)
				break
			}
			converted++
		}
		if converted > 0 {
			output := converted * module.EnergyPerItem
			ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{
				BuildingID: building.ID,
				OwnerID:    network.OwnerID,
				SourceKind: modelpower.PowerSourceStorage,
				Output:     output,
			})
			deficit -= output
		}
	}
}

// consumeExchangerItem removes one unit of an item from any reachable storage
// bucket of the exchanger (input buffer first, then inventory, then output
// buffer).
func consumeExchangerItem(storage *model.StorageState, itemID string) bool {
	if storage == nil || itemID == "" {
		return false
	}
	for _, inv := range []model.ItemInventory{storage.InputBuffer, storage.Inventory, storage.OutputBuffer} {
		if inv == nil || inv[itemID] <= 0 {
			continue
		}
		inv[itemID]--
		if inv[itemID] <= 0 {
			delete(inv, itemID)
		}
		return true
	}
	return false
}

func filterStoragePowerInputs(inputs []model.PowerInput) []model.PowerInput {
	if len(inputs) == 0 {
		return inputs
	}
	out := inputs[:0]
	for _, input := range inputs {
		if input.SourceKind == modelpower.PowerSourceStorage {
			continue
		}
		out = append(out, input)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
