package query

import "siliconworld/internal/model"

// SystemRuntimeView exposes dynamic system-scoped runtime state.
type SystemRuntimeView struct {
	SystemID            string                         `json:"system_id"`
	Discovered          bool                           `json:"discovered"`
	Available           bool                           `json:"available"`
	SolarSailOrbit      *model.SolarSailOrbitState     `json:"solar_sail_orbit,omitempty"`
	DysonSphere         *model.DysonSphereState        `json:"dyson_sphere,omitempty"`
	ActivePlanetContext *ActivePlanetDysonContextView  `json:"active_planet_context,omitempty"`
	Fleets              []FleetRuntimeView             `json:"fleets,omitempty"`
}

// ActivePlanetDysonContextView summarizes Dyson-capable buildings on the current active planet.
type ActivePlanetDysonContextView struct {
	PlanetID                   string         `json:"planet_id"`
	EMRailEjectorCount         int            `json:"em_rail_ejector_count"`
	VerticalLaunchingSiloCount int            `json:"vertical_launching_silo_count"`
	RayReceiverCount           int            `json:"ray_receiver_count"`
	RayReceiverModes           map[string]int `json:"ray_receiver_modes,omitempty"`
}

// FleetRuntimeView is a compact fleet summary.
type FleetRuntimeView struct {
	FleetID          string                 `json:"fleet_id"`
	OwnerID          string                 `json:"owner_id"`
	SystemID         string                 `json:"system_id"`
	SourceBuildingID string                 `json:"source_building_id,omitempty"`
	Formation        string                 `json:"formation"`
	State            string                 `json:"state"`
	Units            []model.FleetUnitStack `json:"units,omitempty"`
	Target           *model.FleetTarget     `json:"target,omitempty"`
}

// FleetDetailView exposes one fleet in detail.
type FleetDetailView struct {
	FleetID          string                 `json:"fleet_id"`
	OwnerID          string                 `json:"owner_id"`
	SystemID         string                 `json:"system_id"`
	SourceBuildingID string                 `json:"source_building_id,omitempty"`
	Formation        string                 `json:"formation"`
	State            string                 `json:"state"`
	Units            []model.FleetUnitStack `json:"units,omitempty"`
	Target           *model.FleetTarget     `json:"target,omitempty"`
	Weapon           model.WeaponState      `json:"weapon"`
	Shield           model.ShieldState      `json:"shield"`
	LastAttackTick   int64                  `json:"last_attack_tick,omitempty"`
}

// SystemRuntime returns one system runtime view.
func (ql *Layer) SystemRuntime(
	playerID, systemID, activePlanetID string,
	activeWorld *model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
) (*SystemRuntimeView, bool) {
	if _, ok := ql.maps.System(systemID); !ok {
		return nil, false
	}
	view := &SystemRuntimeView{
		SystemID:   systemID,
		Discovered: ql.discovery.IsSystemDiscovered(playerID, systemID),
	}
	if !view.Discovered || spaceRuntime == nil {
		return view, true
	}
	view.ActivePlanetContext = ql.collectActivePlanetDysonContext(playerID, systemID, activePlanetID, activeWorld)
	systemRuntime := spaceRuntime.PlayerSystem(playerID, systemID)
	if systemRuntime == nil {
		return view, true
	}
	view.Available = true
	if systemRuntime.SolarSailOrbit != nil {
		orbitCopy := *systemRuntime.SolarSailOrbit
		orbitCopy.Sails = append([]model.SolarSail(nil), systemRuntime.SolarSailOrbit.Sails...)
		view.SolarSailOrbit = &orbitCopy
	}
	if state := model.GetDysonSphereState(spaceRuntime, playerID, systemID); state != nil {
		stateCopy := *state
		stateCopy.Layers = append([]model.DysonLayer(nil), state.Layers...)
		for index := range stateCopy.Layers {
			stateCopy.Layers[index].Nodes = append([]model.DysonNode(nil), state.Layers[index].Nodes...)
			stateCopy.Layers[index].Frames = append([]model.DysonFrame(nil), state.Layers[index].Frames...)
			stateCopy.Layers[index].Shells = append([]model.DysonShell(nil), state.Layers[index].Shells...)
		}
		view.DysonSphere = &stateCopy
	}
	for _, fleet := range systemRuntime.Fleets {
		if fleet == nil {
			continue
		}
		view.Fleets = append(view.Fleets, fleetRuntimeView(fleet))
	}
	return view, true
}

func (ql *Layer) collectActivePlanetDysonContext(
	playerID, systemID, activePlanetID string,
	activeWorld *model.WorldState,
) *ActivePlanetDysonContextView {
	if activePlanetID == "" || activeWorld == nil || activeWorld.PlanetID != activePlanetID {
		return nil
	}
	planet, ok := ql.maps.Planet(activePlanetID)
	if !ok || planet.SystemID != systemID {
		return nil
	}

	context := &ActivePlanetDysonContextView{
		PlanetID:         activePlanetID,
		RayReceiverModes: map[string]int{},
	}

	activeWorld.RLock()
	defer activeWorld.RUnlock()

	for _, building := range activeWorld.Buildings {
		if building == nil || building.OwnerID != playerID {
			continue
		}
		switch building.Type {
		case model.BuildingTypeEMRailEjector:
			context.EMRailEjectorCount++
		case model.BuildingTypeVerticalLaunchingSilo:
			context.VerticalLaunchingSiloCount++
		case model.BuildingTypeRayReceiver:
			context.RayReceiverCount++
			mode := string(model.RayReceiverModeHybrid)
			if building.Runtime.Functions.RayReceiver != nil && building.Runtime.Functions.RayReceiver.Mode != "" {
				mode = string(building.Runtime.Functions.RayReceiver.Mode)
			}
			context.RayReceiverModes[mode]++
		}
	}

	if len(context.RayReceiverModes) == 0 {
		context.RayReceiverModes = nil
	}
	return context
}

// Fleets returns all fleets visible to the player.
func (ql *Layer) Fleets(playerID string, spaceRuntime *model.SpaceRuntimeState) []FleetDetailView {
	if spaceRuntime == nil {
		return []FleetDetailView{}
	}
	out := make([]FleetDetailView, 0)
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil || playerRuntime.PlayerID != playerID {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			for _, fleet := range systemRuntime.Fleets {
				if fleet == nil {
					continue
				}
				out = append(out, fleetDetailView(fleet))
			}
		}
	}
	return out
}

// Fleet returns one fleet detail.
func (ql *Layer) Fleet(playerID, fleetID string, spaceRuntime *model.SpaceRuntimeState) (*FleetDetailView, bool) {
	if spaceRuntime == nil {
		return nil, false
	}
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil || playerRuntime.PlayerID != playerID {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			if fleet := systemRuntime.Fleets[fleetID]; fleet != nil {
				view := fleetDetailView(fleet)
				return &view, true
			}
		}
	}
	return nil, false
}

func fleetRuntimeView(fleet *model.SpaceFleet) FleetRuntimeView {
	view := FleetRuntimeView{
		FleetID:          fleet.ID,
		OwnerID:          fleet.OwnerID,
		SystemID:         fleet.SystemID,
		SourceBuildingID: fleet.SourceBuildingID,
		Formation:        string(fleet.Formation),
		State:            string(fleet.State),
		Units:            append([]model.FleetUnitStack(nil), fleet.Units...),
	}
	if fleet.Target != nil {
		targetCopy := *fleet.Target
		view.Target = &targetCopy
	}
	return view
}

func fleetDetailView(fleet *model.SpaceFleet) FleetDetailView {
	view := FleetDetailView{
		FleetID:          fleet.ID,
		OwnerID:          fleet.OwnerID,
		SystemID:         fleet.SystemID,
		SourceBuildingID: fleet.SourceBuildingID,
		Formation:        string(fleet.Formation),
		State:            string(fleet.State),
		Units:            append([]model.FleetUnitStack(nil), fleet.Units...),
		Weapon:           fleet.Weapon,
		Shield:           fleet.Shield,
		LastAttackTick:   fleet.LastAttackTick,
	}
	if fleet.Target != nil {
		targetCopy := *fleet.Target
		view.Target = &targetCopy
	}
	return view
}
