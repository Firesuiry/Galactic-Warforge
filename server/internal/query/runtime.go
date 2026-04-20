package query

import (
	"sort"

	"siliconworld/internal/model"
)

// PlanetRuntimeView exposes dynamic planet runtime state for the active world.
type PlanetRuntimeView struct {
	PlanetID          string                  `json:"planet_id"`
	Discovered        bool                    `json:"discovered"`
	Available         bool                    `json:"available"`
	ActivePlanetID    string                  `json:"active_planet_id,omitempty"`
	Tick              int64                   `json:"tick"`
	CombatSquads      []model.CombatSquad     `json:"combat_squads,omitempty"`
	OrbitalPlatforms  []model.OrbitalPlatform `json:"orbital_platforms,omitempty"`
	LogisticsStations []LogisticsStationView  `json:"logistics_stations,omitempty"`
	LogisticsDrones   []LogisticsDroneView    `json:"logistics_drones,omitempty"`
	LogisticsShips    []LogisticsShipView     `json:"logistics_ships,omitempty"`
	ConstructionTasks []ConstructionTaskView  `json:"construction_tasks,omitempty"`
	EnemyForces       []EnemyForceView        `json:"enemy_forces,omitempty"`
	Contacts          []model.SensorContact   `json:"contacts,omitempty"`
	Detections        []DetectionView         `json:"detections,omitempty"`
	ThreatLevel       int                     `json:"threat_level"`
	LastAttackTick    int64                   `json:"last_attack_tick,omitempty"`
}

type LogisticsStationView struct {
	BuildingID   string                       `json:"building_id"`
	BuildingType model.BuildingType           `json:"building_type"`
	OwnerID      string                       `json:"owner_id"`
	Position     model.Position               `json:"position"`
	State        *model.LogisticsStationState `json:"state,omitempty"`
	DroneIDs     []string                     `json:"drone_ids,omitempty"`
	ShipIDs      []string                     `json:"ship_ids,omitempty"`
}

type LogisticsDroneView struct {
	ID              string                     `json:"id"`
	OwnerID         string                     `json:"owner_id"`
	StationID       string                     `json:"station_id"`
	TargetStationID string                     `json:"target_station_id,omitempty"`
	Capacity        int                        `json:"capacity"`
	Speed           int                        `json:"speed"`
	Status          model.LogisticsDroneStatus `json:"status"`
	Position        model.Position             `json:"position"`
	TargetPos       *model.Position            `json:"target_pos,omitempty"`
	RemainingTicks  int                        `json:"remaining_ticks"`
	TravelTicks     int                        `json:"travel_ticks"`
	Cargo           model.ItemInventory        `json:"cargo,omitempty"`
}

type LogisticsShipView struct {
	ID                   string                    `json:"id"`
	OwnerID              string                    `json:"owner_id"`
	StationID            string                    `json:"station_id"`
	OriginPlanetID       string                    `json:"origin_planet_id,omitempty"`
	TargetPlanetID       string                    `json:"target_planet_id,omitempty"`
	TargetStationID      string                    `json:"target_station_id,omitempty"`
	Capacity             int                       `json:"capacity"`
	Speed                int                       `json:"speed"`
	WarpSpeed            int                       `json:"warp_speed"`
	WarpDistance         int                       `json:"warp_distance"`
	EnergyPerDistance    int                       `json:"energy_per_distance"`
	WarpEnergyMultiplier int                       `json:"warp_energy_multiplier"`
	WarpItemID           string                    `json:"warp_item_id,omitempty"`
	WarpItemCost         int                       `json:"warp_item_cost"`
	WarpEnabled          bool                      `json:"warp_enabled"`
	Status               model.LogisticsShipStatus `json:"status"`
	Position             model.Position            `json:"position"`
	TargetPos            *model.Position           `json:"target_pos,omitempty"`
	RemainingTicks       int                       `json:"remaining_ticks"`
	TravelTicks          int                       `json:"travel_ticks"`
	Cargo                model.ItemInventory       `json:"cargo,omitempty"`
	Warped               bool                      `json:"warped"`
	EnergyCost           int                       `json:"energy_cost"`
	WarpItemSpent        int                       `json:"warp_item_spent"`
}

type ConstructionTaskView struct {
	ID                string                  `json:"id"`
	PlayerID          string                  `json:"player_id"`
	RegionID          string                  `json:"region_id,omitempty"`
	BuildingType      model.BuildingType      `json:"building_type"`
	Position          model.Position          `json:"position"`
	Rotation          model.PlanRotation      `json:"rotation,omitempty"`
	BlueprintParams   model.BlueprintParams   `json:"blueprint_params,omitempty"`
	ConveyorDirection model.ConveyorDirection `json:"conveyor_direction,omitempty"`
	RecipeID          string                  `json:"recipe_id,omitempty"`
	Cost              model.BuildCost         `json:"cost,omitempty"`
	State             model.ConstructionState `json:"state"`
	EnqueueTick       int64                   `json:"enqueue_tick"`
	StartTick         int64                   `json:"start_tick,omitempty"`
	UpdateTick        int64                   `json:"update_tick,omitempty"`
	QueueIndex        int64                   `json:"queue_index,omitempty"`
	RemainingTicks    int                     `json:"remaining_ticks,omitempty"`
	TotalTicks        int                     `json:"total_ticks,omitempty"`
	SpeedBonus        float64                 `json:"speed_bonus,omitempty"`
	Priority          int                     `json:"priority,omitempty"`
	Error             string                  `json:"error,omitempty"`
	MaterialsDeducted bool                    `json:"materials_deducted,omitempty"`
}

type EnemyForceView struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Position     model.Position `json:"position"`
	Strength     int            `json:"strength"`
	TargetPlayer string         `json:"target_player,omitempty"`
	SpawnTick    int64          `json:"spawn_tick,omitempty"`
	LastSeen     int64          `json:"last_seen,omitempty"`
	ThreatLevel  float64        `json:"threat_level,omitempty"`
}

type DetectionView struct {
	PlayerID          string           `json:"player_id"`
	VisionRange       float64          `json:"vision_range"`
	KnownEnemyCount   int              `json:"known_enemy_count"`
	DetectedPositions []model.Position `json:"detected_positions,omitempty"`
}

// PlanetRuntime returns dynamic runtime state for a loaded planet runtime.
func (ql *Layer) PlanetRuntime(ws *model.WorldState, playerID, planetID, activePlanetID string) (*PlanetRuntimeView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	_ = planet
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetRuntimeView{
		PlanetID:       planetID,
		Discovered:     discovered,
		ActivePlanetID: activePlanetID,
	}
	if !discovered || ws == nil {
		return view, true
	}

	ws.RLock()
	defer ws.RUnlock()

	view.Tick = ws.Tick
	if ws.PlanetID != planetID {
		return view, true
	}
	view.Available = true

	droneIDsByStation := make(map[string][]string)
	for _, droneView := range collectLogisticsDrones(ws, playerID) {
		view.LogisticsDrones = append(view.LogisticsDrones, droneView)
		droneIDsByStation[droneView.StationID] = append(droneIDsByStation[droneView.StationID], droneView.ID)
	}
	shipIDsByStation := make(map[string][]string)
	for _, shipView := range collectLogisticsShips(ws, playerID) {
		view.LogisticsShips = append(view.LogisticsShips, shipView)
		shipIDsByStation[shipView.StationID] = append(shipIDsByStation[shipView.StationID], shipView.ID)
	}

	view.LogisticsStations = collectLogisticsStations(ws, playerID, droneIDsByStation, shipIDsByStation)
	view.ConstructionTasks = collectConstructionTasks(ws, playerID)
	view.CombatSquads = collectCombatSquads(ws, playerID)
	view.OrbitalPlatforms = collectOrbitalPlatforms(ws, playerID)
	view.Contacts = collectPlanetSensorContacts(ws, playerID)
	view.EnemyForces = collectEnemyForces(ws, playerID)
	view.Detections = collectDetections(ws, playerID)
	if ws.EnemyForces != nil {
		view.ThreatLevel = int(ws.EnemyForces.ThreatLevel)
		view.LastAttackTick = ws.EnemyForces.LastAttack
	}
	return view, true
}

func collectCombatSquads(ws *model.WorldState, playerID string) []model.CombatSquad {
	if ws == nil || ws.CombatRuntime == nil || len(ws.CombatRuntime.Squads) == 0 {
		return []model.CombatSquad{}
	}
	ids := make([]string, 0, len(ws.CombatRuntime.Squads))
	for id, squad := range ws.CombatRuntime.Squads {
		if squad == nil || squad.OwnerID != playerID {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]model.CombatSquad, 0, len(ids))
	for _, id := range ids {
		squad := ws.CombatRuntime.Squads[id]
		if squad == nil {
			continue
		}
		out = append(out, *squad)
	}
	return out
}

func collectOrbitalPlatforms(ws *model.WorldState, playerID string) []model.OrbitalPlatform {
	if ws == nil || ws.CombatRuntime == nil || len(ws.CombatRuntime.OrbitalPlatforms) == 0 {
		return []model.OrbitalPlatform{}
	}
	ids := make([]string, 0, len(ws.CombatRuntime.OrbitalPlatforms))
	for id, platform := range ws.CombatRuntime.OrbitalPlatforms {
		if platform == nil || platform.OwnerID != playerID {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]model.OrbitalPlatform, 0, len(ids))
	for _, id := range ids {
		platform := ws.CombatRuntime.OrbitalPlatforms[id]
		if platform == nil {
			continue
		}
		out = append(out, *platform)
	}
	return out
}

func collectLogisticsStations(
	ws *model.WorldState,
	playerID string,
	droneIDsByStation map[string][]string,
	shipIDsByStation map[string][]string,
) []LogisticsStationView {
	if ws == nil || len(ws.LogisticsStations) == 0 {
		return []LogisticsStationView{}
	}
	ids := make([]string, 0, len(ws.LogisticsStations))
	for id := range ws.LogisticsStations {
		building := ws.Buildings[id]
		if building == nil || building.OwnerID != playerID {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]LogisticsStationView, 0, len(ids))
	for _, id := range ids {
		building := ws.Buildings[id]
		station := ws.LogisticsStations[id]
		if building == nil || station == nil {
			continue
		}
		droneIDs := append([]string(nil), droneIDsByStation[id]...)
		shipIDs := append([]string(nil), shipIDsByStation[id]...)
		sort.Strings(droneIDs)
		sort.Strings(shipIDs)
		out = append(out, LogisticsStationView{
			BuildingID:   id,
			BuildingType: building.Type,
			OwnerID:      building.OwnerID,
			Position:     building.Position,
			State:        station.Clone(),
			DroneIDs:     droneIDs,
			ShipIDs:      shipIDs,
		})
	}
	return out
}

func collectLogisticsDrones(ws *model.WorldState, playerID string) []LogisticsDroneView {
	if ws == nil || len(ws.LogisticsDrones) == 0 {
		return []LogisticsDroneView{}
	}
	ids := make([]string, 0, len(ws.LogisticsDrones))
	for id := range ws.LogisticsDrones {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]LogisticsDroneView, 0, len(ids))
	for _, id := range ids {
		drone := ws.LogisticsDrones[id]
		if drone == nil {
			continue
		}
		ownerID := ownerForStation(ws, drone.StationID)
		if ownerID != playerID {
			continue
		}
		var targetPos *model.Position
		if drone.TargetPos != nil {
			pos := *drone.TargetPos
			targetPos = &pos
		}
		out = append(out, LogisticsDroneView{
			ID:              drone.ID,
			OwnerID:         ownerID,
			StationID:       drone.StationID,
			TargetStationID: drone.TargetStationID,
			Capacity:        drone.Capacity,
			Speed:           drone.Speed,
			Status:          drone.Status,
			Position:        drone.Position,
			TargetPos:       targetPos,
			RemainingTicks:  drone.RemainingTicks,
			TravelTicks:     drone.TravelTicks,
			Cargo:           drone.Cargo.Clone(),
		})
	}
	return out
}

func collectLogisticsShips(ws *model.WorldState, playerID string) []LogisticsShipView {
	if ws == nil || len(ws.LogisticsShips) == 0 {
		return []LogisticsShipView{}
	}
	ids := make([]string, 0, len(ws.LogisticsShips))
	for id := range ws.LogisticsShips {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]LogisticsShipView, 0, len(ids))
	for _, id := range ids {
		ship := ws.LogisticsShips[id]
		if ship == nil {
			continue
		}
		ownerID := ownerForStation(ws, ship.StationID)
		if ownerID != playerID {
			continue
		}
		var targetPos *model.Position
		if ship.TargetPos != nil {
			pos := *ship.TargetPos
			targetPos = &pos
		}
		out = append(out, LogisticsShipView{
			ID:                   ship.ID,
			OwnerID:              ownerID,
			StationID:            ship.StationID,
			OriginPlanetID:       ship.OriginPlanetID,
			TargetPlanetID:       ship.TargetPlanetID,
			TargetStationID:      ship.TargetStationID,
			Capacity:             ship.Capacity,
			Speed:                ship.Speed,
			WarpSpeed:            ship.WarpSpeed,
			WarpDistance:         ship.WarpDistance,
			EnergyPerDistance:    ship.EnergyPerDistance,
			WarpEnergyMultiplier: ship.WarpEnergyMultiplier,
			WarpItemID:           ship.WarpItemID,
			WarpItemCost:         ship.WarpItemCost,
			WarpEnabled:          ship.WarpEnabled,
			Status:               ship.Status,
			Position:             ship.Position,
			TargetPos:            targetPos,
			RemainingTicks:       ship.RemainingTicks,
			TravelTicks:          ship.TravelTicks,
			Cargo:                ship.Cargo.Clone(),
			Warped:               ship.Warped,
			EnergyCost:           ship.EnergyCost,
			WarpItemSpent:        ship.WarpItemSpent,
		})
	}
	return out
}

func collectConstructionTasks(ws *model.WorldState, playerID string) []ConstructionTaskView {
	if ws == nil || ws.Construction == nil || len(ws.Construction.Tasks) == 0 {
		return []ConstructionTaskView{}
	}
	ids := make([]string, 0, len(ws.Construction.Tasks))
	for id, task := range ws.Construction.Tasks {
		if task == nil || task.PlayerID != playerID {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]ConstructionTaskView, 0, len(ids))
	for _, id := range ids {
		task := ws.Construction.Tasks[id]
		if task == nil {
			continue
		}
		costItems := append([]model.ItemAmount(nil), task.Cost.Items...)
		out = append(out, ConstructionTaskView{
			ID:                task.ID,
			PlayerID:          task.PlayerID,
			RegionID:          task.RegionID,
			BuildingType:      task.BuildingType,
			Position:          task.Position,
			Rotation:          task.Rotation,
			BlueprintParams:   task.BlueprintParams,
			ConveyorDirection: task.ConveyorDirection,
			RecipeID:          task.RecipeID,
			Cost: model.BuildCost{
				Minerals: task.Cost.Minerals,
				Energy:   task.Cost.Energy,
				Items:    costItems,
			},
			State:             task.State,
			EnqueueTick:       task.EnqueueTick,
			StartTick:         task.StartTick,
			UpdateTick:        task.UpdateTick,
			QueueIndex:        task.QueueIndex,
			RemainingTicks:    task.RemainingTicks,
			TotalTicks:        task.TotalTicks,
			SpeedBonus:        task.SpeedBonus,
			Priority:          task.Priority,
			Error:             task.Error,
			MaterialsDeducted: task.MaterialsDeducted,
		})
	}
	return out
}

func collectEnemyForces(ws *model.WorldState, playerID string) []EnemyForceView {
	if ws == nil {
		return []EnemyForceView{}
	}
	state := ws.SensorContacts[playerID]
	if state == nil || len(state.Contacts) == 0 {
		return []EnemyForceView{}
	}
	forceByID := make(map[string]model.EnemyForce, len(state.Contacts))
	if ws.EnemyForces != nil {
		for _, force := range ws.EnemyForces.Forces {
			forceByID[force.ID] = force
		}
	}
	contacts := make([]model.SensorContact, 0, len(state.Contacts))
	for _, contact := range state.Contacts {
		if contact == nil || contact.ContactKind != model.SensorContactKindEnemyForce || contact.FalseContact {
			continue
		}
		if model.SensorContactLevelRank(contact.Level) < model.SensorContactLevelRank(model.SensorContactLevelConfirmedType) {
			continue
		}
		contacts = append(contacts, cloneSensorContact(contact))
	}
	sort.Slice(contacts, func(i, j int) bool {
		return contacts[i].ID < contacts[j].ID
	})
	out := make([]EnemyForceView, 0, len(contacts))
	for _, contact := range contacts {
		force := forceByID[contact.EntityID]
		out = append(out, EnemyForceView{
			ID:           contact.EntityID,
			Type:         fallbackString(contact.ConfirmedType, contact.Classification),
			Position:     derefSensorPosition(contact.Position),
			Strength:     contact.StrengthEstimate,
			TargetPlayer: force.TargetPlayer,
			SpawnTick:    force.SpawnTick,
			LastSeen:     contact.LastUpdatedTick,
			ThreatLevel:  contact.ThreatLevel,
		})
	}
	return out
}

func collectDetections(ws *model.WorldState, playerID string) []DetectionView {
	if ws == nil {
		return []DetectionView{}
	}
	state := ws.SensorContacts[playerID]
	if state == nil || len(state.Contacts) == 0 {
		return []DetectionView{}
	}
	positions := make([]model.Position, 0, len(state.Contacts))
	maxSignal := 0.0
	knownCount := 0
	seen := make(map[model.Position]struct{})
	for _, contact := range state.Contacts {
		if contact == nil {
			continue
		}
		if !contact.FalseContact {
			knownCount++
		}
		if contact.Position != nil {
			if _, ok := seen[*contact.Position]; !ok {
				seen[*contact.Position] = struct{}{}
				positions = append(positions, *contact.Position)
			}
		}
		if contact.SignalStrength > maxSignal {
			maxSignal = contact.SignalStrength
		}
	}
	sort.Slice(positions, func(i, j int) bool {
		if positions[i].X != positions[j].X {
			return positions[i].X < positions[j].X
		}
		if positions[i].Y != positions[j].Y {
			return positions[i].Y < positions[j].Y
		}
		return positions[i].Z < positions[j].Z
	})
	return []DetectionView{{
		PlayerID:          playerID,
		VisionRange:       maxSignal,
		KnownEnemyCount:   knownCount,
		DetectedPositions: positions,
	}}
}

func collectPlanetSensorContacts(ws *model.WorldState, playerID string) []model.SensorContact {
	if ws == nil || ws.SensorContacts == nil {
		return []model.SensorContact{}
	}
	state := ws.SensorContacts[playerID]
	if state == nil || len(state.Contacts) == 0 {
		return []model.SensorContact{}
	}
	ids := make([]string, 0, len(state.Contacts))
	for id := range state.Contacts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]model.SensorContact, 0, len(ids))
	for _, id := range ids {
		contact := state.Contacts[id]
		if contact == nil {
			continue
		}
		out = append(out, cloneSensorContact(contact))
	}
	return out
}

func cloneSensorContact(contact *model.SensorContact) model.SensorContact {
	copy := *contact
	if contact.Position != nil {
		position := *contact.Position
		copy.Position = &position
	}
	copy.Sources = append([]model.SensorContactSource(nil), contact.Sources...)
	return copy
}

func derefSensorPosition(position *model.Position) model.Position {
	if position == nil {
		return model.Position{}
	}
	return *position
}

func fallbackString(primary, fallback string) string {
	if primary != "" {
		return primary
	}
	return fallback
}

func ownerForStation(ws *model.WorldState, stationID string) string {
	if ws == nil || stationID == "" {
		return ""
	}
	building := ws.Buildings[stationID]
	if building == nil {
		return ""
	}
	return building.OwnerID
}
