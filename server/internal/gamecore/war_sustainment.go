package gamecore

import (
	"fmt"
	"math"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

type warSupplyNode struct {
	view      model.WarSupplyNodeView
	inventory model.ItemInventory
}

func settleWarSustainment(worlds map[string]*model.WorldState, maps *mapmodel.Universe, spaceRuntime *model.SpaceRuntimeState, currentTick int64) {
	if len(worlds) == 0 {
		return
	}

	nodesByPlayerPlanet := make(map[string]map[string][]*warSupplyNode)
	nodesByPlayerSystem := make(map[string]map[string][]*warSupplyNode)

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
			if nodesByPlayerPlanet[playerID] == nil {
				nodesByPlayerPlanet[playerID] = make(map[string][]*warSupplyNode)
			}
			nodesByPlayerPlanet[playerID][ws.PlanetID] = append(nodesByPlayerPlanet[playerID][ws.PlanetID], nodes...)

			if nodesByPlayerSystem[playerID] == nil {
				nodesByPlayerSystem[playerID] = make(map[string][]*warSupplyNode)
			}
			nodesByPlayerSystem[playerID][systemID] = append(nodesByPlayerSystem[playerID][systemID], nodes...)
		}
	}

	for _, ws := range worlds {
		if ws == nil || ws.CombatRuntime == nil {
			continue
		}
		for _, squad := range ws.CombatRuntime.Squads {
			if squad == nil || squad.State == model.CombatSquadStateDestroyed {
				continue
			}
			nodes := nodesByPlayerPlanet[squad.OwnerID][ws.PlanetID]
			activeCombat := squad.State == model.CombatSquadStateEngaging || squad.TargetEnemyID != ""
			hasFrontlineSupport := len(nodes) > 0
			resupplyUnit(&squad.Sustainment, nodes, currentTick)
			if activeCombat {
				consumeUnitStock(&squad.Sustainment, model.WarSupplyStock{Fuel: 1}, currentTick)
			}
			repairSquad(squad, hasFrontlineSupport, activeCombat)
			updateSustainmentStatus(&squad.Sustainment)
			if squad.Sustainment.RetreatRecommended {
				squad.State = model.CombatSquadStateIdle
				squad.TargetEnemyID = ""
			}
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
				activeCombat := fleet.State == model.FleetStateAttacking && fleet.Target != nil
				hasFrontlineSupport := len(nodes) > 0
				resupplyUnit(&fleet.Sustainment, nodes, currentTick)
				if activeCombat {
					consumeUnitStock(&fleet.Sustainment, model.WarSupplyStock{Fuel: 1}, currentTick)
				}
				repairFleet(fleet, hasFrontlineSupport, activeCombat)
				updateSustainmentStatus(&fleet.Sustainment)
				if fleet.Sustainment.RetreatRecommended {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
				}
			}
		}
	}
}

func collectWorldSupplyNodes(ws *model.WorldState, playerID, systemID string, spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*warSupplyNode {
	if ws == nil || playerID == "" {
		return nil
	}
	nodes := make([]*warSupplyNode, 0)
	player := ws.Players[playerID]
	underBlockade := activeEnemyPlanetBlockade(spaceRuntime, systemID, ws.PlanetID, playerID)

	if player != nil && player.WarIndustry != nil {
		for _, hub := range player.WarIndustry.DeploymentHubs {
			if hub == nil {
				continue
			}
			building := ws.Buildings[hub.BuildingID]
			if building == nil || building.OwnerID != playerID || building.Storage == nil {
				continue
			}
			if underBlockade != nil {
				recordPlanetBlockadeInterdiction(spaceRuntime, systemID, ws.PlanetID, playerID, 1, 0, "offworld_supply_interdicted", currentTick)
				continue
			}
			inventory := building.Storage.EnsureInventory()
			nodes = append(nodes, &warSupplyNode{
				view: model.WarSupplyNodeView{
					NodeID:      "hub:" + hub.BuildingID,
					SourceType:  model.WarSupplySourceOrbitalSupplyPort,
					Label:       "Orbital Supply Port",
					PlanetID:    ws.PlanetID,
					SystemID:    systemID,
					BuildingID:  hub.BuildingID,
					Inventory:   model.MilitarySupplyFromInventory(inventory),
					UpdatedTick: currentTick,
				},
				inventory: inventory,
			})
		}
	}

	for stationID, station := range ws.LogisticsStations {
		building := ws.Buildings[stationID]
		if station == nil || building == nil || building.OwnerID != playerID {
			continue
		}
		sourceType := model.WarSupplySourcePlanetaryLogisticsStation
		label := "Planetary Logistics Station"
		if building.Type == model.BuildingTypeInterstellarLogisticsStation {
			if underBlockade != nil {
				recordPlanetBlockadeInterdiction(spaceRuntime, systemID, ws.PlanetID, playerID, 1, 1, "interstellar_convoy_interdicted", currentTick)
				continue
			}
			sourceType = model.WarSupplySourceInterstellarLogistics
			label = "Interstellar Logistics Station"
		}
		nodes = append(nodes, &warSupplyNode{
			view: model.WarSupplyNodeView{
				NodeID:      fmt.Sprintf("station:%s", stationID),
				SourceType:  sourceType,
				Label:       label,
				PlanetID:    ws.PlanetID,
				SystemID:    systemID,
				BuildingID:  stationID,
				Inventory:   model.MilitarySupplyFromInventory(station.Inventory),
				UpdatedTick: currentTick,
			},
			inventory: station.Inventory,
		})
	}

	for droneID, drone := range ws.LogisticsDrones {
		if drone == nil {
			continue
		}
		building := ws.Buildings[drone.StationID]
		if building == nil || building.OwnerID != playerID {
			continue
		}
		if underBlockade != nil {
			recordPlanetBlockadeInterdiction(spaceRuntime, systemID, ws.PlanetID, playerID, 1, 1, "frontline_drop_interdicted", currentTick)
			continue
		}
		nodes = append(nodes, &warSupplyNode{
			view: model.WarSupplyNodeView{
				NodeID:      fmt.Sprintf("drone:%s", droneID),
				SourceType:  model.WarSupplySourceFrontlineSupplyDrop,
				Label:       "Frontline Supply Drop",
				PlanetID:    ws.PlanetID,
				SystemID:    systemID,
				BuildingID:  drone.StationID,
				UnitID:      droneID,
				Inventory:   model.MilitarySupplyFromInventory(drone.Cargo),
				UpdatedTick: currentTick,
			},
			inventory: drone.Cargo,
		})
	}

	for shipID, ship := range ws.LogisticsShips {
		if ship == nil {
			continue
		}
		building := ws.Buildings[ship.StationID]
		if building == nil || building.OwnerID != playerID {
			continue
		}
		if underBlockade != nil {
			recordPlanetBlockadeInterdiction(spaceRuntime, systemID, ws.PlanetID, playerID, 1, 1, "supply_ship_interdicted", currentTick)
			continue
		}
		nodes = append(nodes, &warSupplyNode{
			view: model.WarSupplyNodeView{
				NodeID:      fmt.Sprintf("ship:%s", shipID),
				SourceType:  model.WarSupplySourceSupplyShip,
				Label:       "Supply Ship",
				PlanetID:    ws.PlanetID,
				SystemID:    systemID,
				BuildingID:  ship.StationID,
				UnitID:      shipID,
				Inventory:   model.MilitarySupplyFromInventory(ship.Cargo),
				UpdatedTick: currentTick,
			},
			inventory: ship.Cargo,
		})
	}

	return nodes
}

func resupplyUnit(state *model.WarSustainmentState, nodes []*warSupplyNode, currentTick int64) {
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
		requested := minSupply(deficit, model.MilitarySupplyFromInventory(node.inventory))
		if isSupplyZero(requested) {
			continue
		}
		consumed := model.ConsumeMilitarySupply(node.inventory, requested)
		if isSupplyZero(consumed) {
			continue
		}
		node.view.Inventory = model.MilitarySupplyFromInventory(node.inventory)
		addSupply(&state.Current, consumed)
		deficit = supplyDeficit(state.Capacity, state.Current)
		state.Sources = appendUniqueSource(state.Sources, model.WarSupplySourceRef{
			SourceID:   node.view.NodeID,
			SourceType: node.view.SourceType,
			Label:      node.view.Label,
			PlanetID:   node.view.PlanetID,
			SystemID:   node.view.SystemID,
			BuildingID: node.view.BuildingID,
			UnitID:     node.view.UnitID,
		})
		state.LastResupplyTick = currentTick
		if isSupplyZero(deficit) {
			break
		}
	}
}

func repairSquad(squad *model.CombatSquad, hasFrontlineSupport, activeCombat bool) {
	if squad == nil {
		return
	}
	repairUnit(&squad.Sustainment, squad.MaxHP-squad.HP, squad.Shield.MaxLevel-squad.Shield.Level, hasFrontlineSupport, activeCombat, func(hp int, shield float64) {
		squad.HP = warMinInt(squad.MaxHP, squad.HP+hp)
		if shield > 0 {
			squad.Shield.Level += shield
			if squad.Shield.Level > squad.Shield.MaxLevel {
				squad.Shield.Level = squad.Shield.MaxLevel
			}
		}
	})
}

func repairFleet(fleet *model.SpaceFleet, hasFrontlineSupport, activeCombat bool) {
	if fleet == nil {
		return
	}
	missingShield := fleet.Shield.MaxLevel - fleet.Shield.Level
	missingHP := 0
	if activeCombat && fleet.Shield.MaxLevel <= 0 {
		missingHP = 0
	}
	repairUnit(&fleet.Sustainment, missingHP, missingShield, hasFrontlineSupport, activeCombat, func(_ int, shield float64) {
		if shield > 0 {
			fleet.Shield.Level += shield
			if fleet.Shield.Level > fleet.Shield.MaxLevel {
				fleet.Shield.Level = fleet.Shield.MaxLevel
			}
		}
	})
}

func repairUnit(
	state *model.WarSustainmentState,
	missingHP int,
	missingShield float64,
	hasFrontlineSupport bool,
	activeCombat bool,
	apply func(hp int, shield float64),
) {
	if state == nil {
		return
	}
	state.Repair = model.WarRepairState{
		RemainingDamage: missingHP,
		RemainingShield: roundShieldValue(missingShield),
	}
	if missingHP <= 0 && missingShield <= 0 {
		return
	}

	if state.Current.SpareParts <= 0 || state.Current.RepairDrones <= 0 {
		state.Repair.BlockedReason = "repair_supply_exhausted"
		state.Repair.Tier = model.WarRepairTierField
		state.Repair.RemainingDamage = missingHP
		state.Repair.RemainingShield = roundShieldValue(missingShield)
		return
	}

	tier := model.WarRepairTierField
	hpPerTick := 2
	shieldPerTick := 0.0
	if hasFrontlineSupport && !activeCombat {
		tier = model.WarRepairTierFrontline
		hpPerTick = 6
		shieldPerTick = 2
	} else {
		shieldPerTick = 1
	}

	if missingShield > 0 && state.Current.ShieldCells <= 0 {
		state.Repair.BlockedReason = "shield_cells_exhausted"
		state.Repair.Tier = tier
		state.Repair.HPPerTick = hpPerTick
		return
	}

	hpGain := warMinInt(hpPerTick, missingHP)
	shieldGain := shieldPerTick
	if shieldGain > missingShield {
		shieldGain = missingShield
	}
	if hpGain <= 0 && shieldGain <= 0 {
		return
	}

	consume := model.WarSupplyStock{SpareParts: 1, RepairDrones: 1}
	if shieldGain > 0 {
		consume.ShieldCells = 1
	}
	consumeUnitStock(state, consume, 0)
	apply(hpGain, shieldGain)
	state.Repair = model.WarRepairState{
		Tier:              tier,
		Active:            true,
		HPPerTick:         hpGain,
		ShieldPerTick:     shieldGain,
		RemainingDamage:   warMaxInt(0, missingHP-hpGain),
		RemainingShield:   roundShieldValue(missingShield - shieldGain),
		CompletedThisTick: missingHP-hpGain <= 0 && missingShield-shieldGain <= 0,
	}
}

func updateSustainmentStatus(state *model.WarSustainmentState) {
	if state == nil {
		return
	}
	state.Shortages = nil
	state.Condition = model.WarSupplyConditionHealthy
	state.DamagePenalty = 0
	state.ShieldPenalty = 0
	state.MobilityPenalty = 0
	state.RepairBlocked = !state.Repair.Active && state.Repair.BlockedReason != ""
	state.RetreatRecommended = false

	if state.Current.Ammo <= 0 {
		state.Shortages = append(state.Shortages, "ammo_shortage")
		state.DamagePenalty = 1
	}
	if state.Capacity.Missiles > 0 && state.Current.Missiles <= 0 {
		state.Shortages = append(state.Shortages, "missile_shortage")
	}
	if state.Capacity.ShieldCells > 0 && state.Current.ShieldCells <= 0 {
		state.Shortages = append(state.Shortages, "shield_cells_exhausted")
		state.ShieldPenalty = 1
	}
	if state.Current.SpareParts <= 0 || state.Current.RepairDrones <= 0 {
		state.Shortages = append(state.Shortages, "repair_stalled")
		state.RepairBlocked = true
	}
	if state.Current.Fuel <= 0 {
		state.Shortages = append(state.Shortages, "fuel_starved")
		state.MobilityPenalty = 1
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
	state.Current.Missiles = warMaxInt(0, state.Current.Missiles-consumed.Missiles)
	state.Current.Fuel = warMaxInt(0, state.Current.Fuel-consumed.Fuel)
	state.Current.SpareParts = warMaxInt(0, state.Current.SpareParts-consumed.SpareParts)
	state.Current.ShieldCells = warMaxInt(0, state.Current.ShieldCells-consumed.ShieldCells)
	state.Current.RepairDrones = warMaxInt(0, state.Current.RepairDrones-consumed.RepairDrones)
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
		Ammo:         warMaxInt(0, capacity.Ammo-current.Ammo),
		Missiles:     warMaxInt(0, capacity.Missiles-current.Missiles),
		Fuel:         warMaxInt(0, capacity.Fuel-current.Fuel),
		SpareParts:   warMaxInt(0, capacity.SpareParts-current.SpareParts),
		ShieldCells:  warMaxInt(0, capacity.ShieldCells-current.ShieldCells),
		RepairDrones: warMaxInt(0, capacity.RepairDrones-current.RepairDrones),
	}
}

func minSupply(a, b model.WarSupplyStock) model.WarSupplyStock {
	return model.WarSupplyStock{
		Ammo:         warMinInt(a.Ammo, b.Ammo),
		Missiles:     warMinInt(a.Missiles, b.Missiles),
		Fuel:         warMinInt(a.Fuel, b.Fuel),
		SpareParts:   warMinInt(a.SpareParts, b.SpareParts),
		ShieldCells:  warMinInt(a.ShieldCells, b.ShieldCells),
		RepairDrones: warMinInt(a.RepairDrones, b.RepairDrones),
	}
}

func addSupply(dst *model.WarSupplyStock, added model.WarSupplyStock) {
	if dst == nil {
		return
	}
	dst.Ammo += added.Ammo
	dst.Missiles += added.Missiles
	dst.Fuel += added.Fuel
	dst.SpareParts += added.SpareParts
	dst.ShieldCells += added.ShieldCells
	dst.RepairDrones += added.RepairDrones
}

func isSupplyZero(stock model.WarSupplyStock) bool {
	return stock.Ammo == 0 &&
		stock.Missiles == 0 &&
		stock.Fuel == 0 &&
		stock.SpareParts == 0 &&
		stock.ShieldCells == 0 &&
		stock.RepairDrones == 0
}

func appendUniqueSource(values []model.WarSupplySourceRef, next model.WarSupplySourceRef) []model.WarSupplySourceRef {
	for _, value := range values {
		if value.SourceID == next.SourceID {
			return values
		}
	}
	return append(values, next)
}

func attackBlockedBySustainment(state *model.WarSustainmentState) bool {
	return state != nil && (state.Current.Ammo <= 0 || state.RetreatRecommended)
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

func sustainmentMobilityMultiplier(state *model.WarSustainmentState) float64 {
	if state == nil {
		return 1
	}
	multiplier := 1 - state.MobilityPenalty
	if multiplier < 0.1 {
		return 0.1
	}
	return multiplier
}

func settleAttackConsumption(state *model.WarSustainmentState, weapon model.WeaponState, currentTick int64) {
	if state == nil {
		return
	}
	usage := model.WarSupplyStock{Ammo: warMaxInt(1, weapon.AmmoCost)}
	if weapon.Type == model.WeaponTypeMissile || state.Capacity.Missiles > 0 {
		usage.Missiles = 1
	}
	consumeUnitStock(state, usage, currentTick)
}

func rechargeShieldWithSustainment(shield *model.ShieldState, state *model.WarSustainmentState, currentTick int64) {
	if shield == nil {
		return
	}
	if state != nil && state.Capacity.ShieldCells > 0 && state.Current.ShieldCells <= 0 {
		return
	}
	shield.ProcessShieldRecharge(currentTick)
}

func roundWarFloat(value float64) float64 {
	return math.Round(value*100) / 100
}

func roundShieldValue(value float64) float64 {
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
