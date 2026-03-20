package gamecore

import (
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func settleOrbitalCollectors(ws *model.WorldState, maps *mapmodel.Universe) {
	if ws == nil || maps == nil {
		return
	}
	planet, ok := maps.Planet(ws.PlanetID)
	if !ok || planet == nil || planet.Kind != mapmodel.PlanetKindGasGiant {
		return
	}

	for _, building := range ws.Buildings {
		if building == nil || building.Type != model.BuildingTypeOrbitalCollector {
			continue
		}
		player := ws.Players[building.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}
		if building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		module := building.Runtime.Functions.Orbital
		if module == nil || len(module.Outputs) == 0 {
			continue
		}
		if building.LogisticsStation == nil {
			continue
		}
		if building.LogisticsStation.Inventory == nil {
			building.LogisticsStation.Inventory = make(model.ItemInventory)
		}

		for _, output := range module.Outputs {
			if output.ItemID == "" || output.Quantity <= 0 {
				continue
			}
			current := building.LogisticsStation.Inventory[output.ItemID]
			add := output.Quantity
			if module.MaxInventory > 0 {
				if current >= module.MaxInventory {
					continue
				}
				if current+add > module.MaxInventory {
					add = module.MaxInventory - current
				}
			}
			if add <= 0 {
				continue
			}
			building.LogisticsStation.Inventory[output.ItemID] = current + add
		}
		building.LogisticsStation.RefreshCapacityCache()
	}
}
