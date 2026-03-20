package gamecore

import "siliconworld/internal/model"

func settleEnergyStorage(ws *model.WorldState) {
	if ws == nil {
		return
	}

	ws.PowerInputs = filterStoragePowerInputs(ws.PowerInputs)

	networks := model.ResolvePowerNetworks(ws)
	if len(networks.Networks) == 0 {
		return
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
			actions, _ := model.ApplyEnergyStorageDischarge(nodes, deficit, balance)
			for _, action := range actions {
				if action.DischargeOutput <= 0 {
					continue
				}
				ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{
					BuildingID: action.BuildingID,
					OwnerID:    network.OwnerID,
					SourceKind: model.PowerSourceStorage,
					Output:     action.DischargeOutput,
				})
			}
			continue
		}
		if deficit < 0 {
			model.ApplyEnergyStorageCharge(nodes, -deficit, balance)
		}
	}
}

func filterStoragePowerInputs(inputs []model.PowerInput) []model.PowerInput {
	if len(inputs) == 0 {
		return inputs
	}
	out := inputs[:0]
	for _, input := range inputs {
		if input.SourceKind == model.PowerSourceStorage {
			continue
		}
		out = append(out, input)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
