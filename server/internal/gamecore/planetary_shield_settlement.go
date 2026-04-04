package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

func settlePlanetaryShields(ws *model.WorldState) {
	if ws == nil || ws.Buildings == nil {
		return
	}

	for _, building := range ws.Buildings {
		if building == nil || building.Type != model.BuildingTypePlanetaryShieldGenerator {
			continue
		}
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		if building.Runtime.Functions.Shield == nil {
			continue
		}
		shield := building.Runtime.Functions.Shield
		shield.CurrentCharge += shield.ChargePerTick
		if shield.CurrentCharge > shield.Capacity {
			shield.CurrentCharge = shield.Capacity
		}
	}
}

func absorbPlanetaryShieldDamage(ws *model.WorldState, ownerID string, damage int) (absorbed int, remaining int) {
	if ws == nil || ownerID == "" || damage <= 0 {
		return 0, damage
	}

	buildings := runningShieldGenerators(ws, ownerID)
	if len(buildings) == 0 {
		return 0, damage
	}

	remaining = damage
	for _, building := range buildings {
		shield := building.Runtime.Functions.Shield
		if shield == nil || shield.CurrentCharge <= 0 {
			continue
		}
		take := remaining
		if take > shield.CurrentCharge {
			take = shield.CurrentCharge
		}
		shield.CurrentCharge -= take
		absorbed += take
		remaining -= take
		if remaining == 0 {
			break
		}
	}

	return absorbed, remaining
}

func totalPlanetaryShieldCharge(ws *model.WorldState, ownerID string) int {
	total := 0
	for _, building := range runningShieldGenerators(ws, ownerID) {
		if building.Runtime.Functions.Shield != nil {
			total += building.Runtime.Functions.Shield.CurrentCharge
		}
	}
	return total
}

func runningShieldGenerators(ws *model.WorldState, ownerID string) []*model.Building {
	if ws == nil || ownerID == "" {
		return nil
	}

	buildings := make([]*model.Building, 0)
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != ownerID {
			continue
		}
		if building.Type != model.BuildingTypePlanetaryShieldGenerator {
			continue
		}
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		if building.Runtime.Functions.Shield == nil {
			continue
		}
		buildings = append(buildings, building)
	}

	sort.Slice(buildings, func(i, j int) bool {
		return buildings[i].ID < buildings[j].ID
	})
	return buildings
}
