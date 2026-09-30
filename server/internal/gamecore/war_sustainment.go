package gamecore

import (
	"math"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func settleWarSustainment(worlds map[string]*model.WorldState, maps *mapmodel.Universe, spaceRuntime *model.SpaceRuntimeState, currentTick int64) {
	if len(worlds) == 0 {
		return
	}

	nodesByPlayerSystem := make(map[string]map[string][]*model.WarSupplyNode)

	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		systemID := worldSystemID(maps, ws.PlanetID)
		for playerID := range ws.Players {
			nodes := collectWorldSupplyNodes(ws, playerID, systemID, spaceRuntime, currentTick)
			if len(nodes) == 0 {
				continue
			}

			if nodesByPlayerSystem[playerID] == nil {
				nodesByPlayerSystem[playerID] = make(map[string][]*model.WarSupplyNode)
			}
			nodesByPlayerSystem[playerID][systemID] = append(nodesByPlayerSystem[playerID][systemID], nodes...)
		}
	}

	if spaceRuntime == nil {
		return
	}
	for playerID, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for systemID, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			nodes := nodesByPlayerSystem[playerID][systemID]
			for _, fleet := range systemRuntime.Fleets {
				if fleet == nil {
					continue
				}
				resupplyUnit(&fleet.Sustainment, nodes, currentTick)
				updateSustainmentStatus(&fleet.Sustainment)
				if fleet.Sustainment.RetreatRecommended {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
				}
			}
		}
	}
}

func collectWorldSupplyNodes(ws *model.WorldState, playerID, systemID string, spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.WarSupplyNode {
	nodes := model.CollectWarSupplyNodes(ws, playerID, systemID, currentTick)
	if len(nodes) == 0 {
		return nil
	}
	if activeEnemyPlanetBlockade(spaceRuntime, systemID, ws.PlanetID, playerID) != nil {
		for range nodes {
			recordPlanetBlockadeInterdiction(spaceRuntime, systemID, ws.PlanetID, playerID, 1, 0, "offworld_supply_interdicted", currentTick)
		}
		return nil
	}
	return nodes
}

func resupplyUnit(state *model.WarSustainmentState, nodes []*model.WarSupplyNode, currentTick int64) {
	if state == nil || len(nodes) == 0 {
		return
	}
	deficit := supplyDeficit(state.Capacity, state.Current)
	if deficit == (model.WarSupplyStock{}) {
		return
	}
	state.Sources = nil
	for _, node := range nodes {
		if node == nil {
			continue
		}
		requested := minSupply(deficit, node.Stock())
		if isSupplyZero(requested) {
			continue
		}
		consumed := node.Consume(requested)
		if isSupplyZero(consumed) {
			continue
		}
		addSupply(&state.Current, consumed)
		deficit = supplyDeficit(state.Capacity, state.Current)
		state.Sources = appendUniqueSource(state.Sources, model.WarSupplySourceRef{
			SourceID:   node.View.NodeID,
			SourceType: node.View.SourceType,
			Label:      node.View.Label,
			PlanetID:   node.View.PlanetID,
			SystemID:   node.View.SystemID,
			BuildingID: node.View.BuildingID,
			UnitID:     node.View.UnitID,
		})
		state.LastResupplyTick = currentTick
		if isSupplyZero(deficit) {
			break
		}
	}
}

func updateSustainmentStatus(state *model.WarSustainmentState) {
	if state == nil {
		return
	}
	state.Shortages = nil
	state.Condition = model.WarSupplyConditionHealthy
	state.DamagePenalty = 0
	state.RetreatRecommended = false

	if state.Capacity.Ammo > 0 && state.Current.Ammo <= 0 {
		state.Shortages = append(state.Shortages, "ammo_shortage")
		state.DamagePenalty = 1
	}
	if state.Capacity.Shells > 0 && state.Current.Shells <= 0 {
		state.Shortages = append(state.Shortages, "shell_shortage")
		state.DamagePenalty = 1
	}
	if state.Capacity.Missiles > 0 && state.Current.Missiles <= 0 {
		state.Shortages = append(state.Shortages, "missile_shortage")
	}

	switch len(state.Shortages) {
	case 0:
		state.Condition = model.WarSupplyConditionHealthy
		if state.Cohesion < 1 {
			state.Cohesion = roundWarFloat(state.Cohesion + 0.05)
		}
	case 1, 2:
		state.Condition = model.WarSupplyConditionStrained
		state.Cohesion = roundWarFloat(state.Cohesion - 0.05)
	case 3, 4:
		state.Condition = model.WarSupplyConditionCritical
		state.Cohesion = roundWarFloat(state.Cohesion - 0.12)
	default:
		state.Condition = model.WarSupplyConditionCollapsed
		state.Cohesion = roundWarFloat(state.Cohesion - 0.2)
	}

	if state.Cohesion < 0 {
		state.Cohesion = 0
	}
	if state.Condition == model.WarSupplyConditionCollapsed || state.Cohesion <= 0.25 {
		state.RetreatRecommended = true
	}
	state.Normalize()
}

func consumeUnitStock(state *model.WarSustainmentState, consumed model.WarSupplyStock, currentTick int64) {
	if state == nil {
		return
	}
	state.Current.Ammo = warMaxInt(0, state.Current.Ammo-consumed.Ammo)
	state.Current.Shells = warMaxInt(0, state.Current.Shells-consumed.Shells)
	state.Current.Missiles = warMaxInt(0, state.Current.Missiles-consumed.Missiles)
	if currentTick > 0 && !isSupplyZero(consumed) {
		state.LastConsumptionTick = currentTick
	}
}

func worldSystemID(maps *mapmodel.Universe, planetID string) string {
	if maps == nil || planetID == "" {
		return ""
	}
	planet, ok := maps.Planet(planetID)
	if !ok || planet == nil {
		return ""
	}
	return planet.SystemID
}

func supplyDeficit(capacity, current model.WarSupplyStock) model.WarSupplyStock {
	return model.WarSupplyStock{
		Ammo:     warMaxInt(0, capacity.Ammo-current.Ammo),
		Shells:   warMaxInt(0, capacity.Shells-current.Shells),
		Missiles: warMaxInt(0, capacity.Missiles-current.Missiles),
	}
}

func minSupply(a, b model.WarSupplyStock) model.WarSupplyStock {
	return model.WarSupplyStock{
		Ammo:     warMinInt(a.Ammo, b.Ammo),
		Shells:   warMinInt(a.Shells, b.Shells),
		Missiles: warMinInt(a.Missiles, b.Missiles),
	}
}

func addSupply(dst *model.WarSupplyStock, added model.WarSupplyStock) {
	if dst == nil {
		return
	}
	dst.Ammo += added.Ammo
	dst.Shells += added.Shells
	dst.Missiles += added.Missiles
}

func isSupplyZero(stock model.WarSupplyStock) bool {
	return stock == (model.WarSupplyStock{})
}

func appendUniqueSource(values []model.WarSupplySourceRef, next model.WarSupplySourceRef) []model.WarSupplySourceRef {
	for _, value := range values {
		if value.SourceID == next.SourceID {
			return values
		}
	}
	return append(values, next)
}

// stockField returns the stock dimension of the given ammunition class.
func stockField(stock *model.WarSupplyStock, class string) *int {
	switch class {
	case model.AmmoClassShell:
		return &stock.Shells
	case model.AmmoClassMissile:
		return &stock.Missiles
	default:
		return &stock.Ammo
	}
}

// weaponAmmoClass resolves the class a unit fires: the weapon's own class, or the
// class it carries the most of when the weapon class has no capacity (mixed fleets).
func weaponAmmoClass(capacity model.WarSupplyStock, weaponType model.WeaponType) string {
	class := model.WeaponSupplyClass(weaponType)
	if *stockField(&capacity, class) > 0 {
		return class
	}
	best, bestCap := class, 0
	for _, c := range []string{model.AmmoClassBullet, model.AmmoClassShell, model.AmmoClassMissile} {
		if v := *stockField(&capacity, c); v > bestCap {
			best, bestCap = c, v
		}
	}
	return best
}

func attackBlockedBySustainment(state *model.WarSustainmentState, weaponType model.WeaponType) bool {
	if state == nil {
		return false
	}
	class := weaponAmmoClass(state.Capacity, weaponType)
	return *stockField(&state.Current, class) <= 0 || state.RetreatRecommended
}

func sustainmentDamageMultiplier(state *model.WarSustainmentState) float64 {
	if state == nil {
		return 1
	}
	multiplier := 1 - state.DamagePenalty
	if multiplier < 0 {
		return 0
	}
	return multiplier
}

func settleAttackConsumption(state *model.WarSustainmentState, weapon model.WeaponState, currentTick int64) {
	if state == nil {
		return
	}
	var usage model.WarSupplyStock
	*stockField(&usage, weaponAmmoClass(state.Capacity, weapon.Type)) = warMaxInt(1, weapon.AmmoCost)
	consumeUnitStock(state, usage, currentTick)
}

func roundWarFloat(value float64) float64 {
	return math.Round(value*100) / 100
}

func warMinInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func warMaxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
