package query

import (
	"sort"

	"siliconworld/internal/model"
)

// SystemRuntimeView exposes dynamic system-scoped runtime state.
type SystemRuntimeView struct {
	SystemID            string                        `json:"system_id"`
	Discovered          bool                          `json:"discovered"`
	Available           bool                          `json:"available"`
	SolarSailOrbit      *model.SolarSailOrbitState    `json:"solar_sail_orbit,omitempty"`
	DysonSphere         *model.DysonSphereState       `json:"dyson_sphere,omitempty"`
	ActivePlanetContext *ActivePlanetDysonContextView `json:"active_planet_context,omitempty"`
	Fleets              []FleetRuntimeView            `json:"fleets,omitempty"`
	TaskForces          []TaskForceRuntimeView        `json:"task_forces,omitempty"`
	Theaters            []TheaterRuntimeView          `json:"theaters,omitempty"`
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

// TaskForceRuntimeView exposes a compact task-force summary.
type TaskForceRuntimeView struct {
	TaskForceID      string                           `json:"task_force_id"`
	OwnerID          string                           `json:"owner_id"`
	SystemID         string                           `json:"system_id"`
	TheaterID        string                           `json:"theater_id,omitempty"`
	Stance           string                           `json:"stance"`
	Status           string                           `json:"status"`
	Members          []model.TaskForceMemberRef       `json:"members,omitempty"`
	DeploymentTarget *model.TaskForceDeploymentTarget `json:"deployment_target,omitempty"`
	Behavior         model.TaskForceBehaviorProfile   `json:"behavior"`
	CommandCapacity  model.TaskForceCommandCapacity   `json:"command_capacity"`
}

// TaskForceDetailView exposes one task force in detail.
type TaskForceDetailView = TaskForceRuntimeView

// TheaterRuntimeView exposes a compact theater summary.
type TheaterRuntimeView struct {
	TheaterID    string                  `json:"theater_id"`
	OwnerID      string                  `json:"owner_id"`
	SystemID     string                  `json:"system_id"`
	Name         string                  `json:"name,omitempty"`
	Zones        []model.TheaterZone     `json:"zones,omitempty"`
	Objective    *model.TheaterObjective `json:"objective,omitempty"`
	TaskForceIDs []string                `json:"task_force_ids,omitempty"`
}

// TheaterDetailView exposes one theater in detail.
type TheaterDetailView = TheaterRuntimeView

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
	for _, taskForce := range systemRuntime.TaskForces {
		if taskForce == nil {
			continue
		}
		view.TaskForces = append(view.TaskForces, taskForceRuntimeView(taskForce))
	}
	for _, theater := range systemRuntime.Theaters {
		if theater == nil {
			continue
		}
		view.Theaters = append(view.Theaters, theaterRuntimeView(theater, systemRuntime))
	}
	sort.Slice(view.TaskForces, func(i, j int) bool { return view.TaskForces[i].TaskForceID < view.TaskForces[j].TaskForceID })
	sort.Slice(view.Theaters, func(i, j int) bool { return view.Theaters[i].TheaterID < view.Theaters[j].TheaterID })
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

// TaskForces returns all task forces visible to the player.
func (ql *Layer) TaskForces(playerID string, spaceRuntime *model.SpaceRuntimeState) []TaskForceDetailView {
	if spaceRuntime == nil {
		return []TaskForceDetailView{}
	}
	out := make([]TaskForceDetailView, 0)
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil || playerRuntime.PlayerID != playerID {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			for _, taskForce := range systemRuntime.TaskForces {
				if taskForce == nil {
					continue
				}
				out = append(out, taskForceDetailView(taskForce))
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TaskForceID < out[j].TaskForceID })
	return out
}

// TaskForce returns one task force detail.
func (ql *Layer) TaskForce(playerID, taskForceID string, spaceRuntime *model.SpaceRuntimeState) (*TaskForceDetailView, bool) {
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
			if taskForce := systemRuntime.TaskForces[taskForceID]; taskForce != nil {
				view := taskForceDetailView(taskForce)
				return &view, true
			}
		}
	}
	return nil, false
}

// Theaters returns all theaters visible to the player.
func (ql *Layer) Theaters(playerID string, spaceRuntime *model.SpaceRuntimeState) []TheaterDetailView {
	if spaceRuntime == nil {
		return []TheaterDetailView{}
	}
	out := make([]TheaterDetailView, 0)
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil || playerRuntime.PlayerID != playerID {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			for _, theater := range systemRuntime.Theaters {
				if theater == nil {
					continue
				}
				out = append(out, theaterDetailView(theater, systemRuntime))
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TheaterID < out[j].TheaterID })
	return out
}

// Theater returns one theater detail.
func (ql *Layer) Theater(playerID, theaterID string, spaceRuntime *model.SpaceRuntimeState) (*TheaterDetailView, bool) {
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
			if theater := systemRuntime.Theaters[theaterID]; theater != nil {
				view := theaterDetailView(theater, systemRuntime)
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

func taskForceRuntimeView(taskForce *model.TaskForce) TaskForceRuntimeView {
	view := TaskForceRuntimeView{
		TaskForceID:     taskForce.ID,
		OwnerID:         taskForce.OwnerID,
		SystemID:        taskForce.SystemID,
		TheaterID:       taskForce.TheaterID,
		Stance:          string(taskForce.Stance),
		Status:          string(taskForce.Status),
		Members:         append([]model.TaskForceMemberRef(nil), taskForce.Members...),
		Behavior:        taskForce.Behavior,
		CommandCapacity: taskForce.CommandCapacity,
	}
	if taskForce.DeploymentTarget != nil {
		targetCopy := *taskForce.DeploymentTarget
		if taskForce.DeploymentTarget.Position != nil {
			posCopy := *taskForce.DeploymentTarget.Position
			targetCopy.Position = &posCopy
		}
		view.DeploymentTarget = &targetCopy
	}
	return view
}

func taskForceDetailView(taskForce *model.TaskForce) TaskForceDetailView {
	return taskForceRuntimeView(taskForce)
}

func theaterRuntimeView(theater *model.Theater, systemRuntime *model.PlayerSystemRuntime) TheaterRuntimeView {
	view := TheaterRuntimeView{
		TheaterID: theater.ID,
		OwnerID:   theater.OwnerID,
		SystemID:  theater.SystemID,
		Name:      theater.Name,
		Zones:     append([]model.TheaterZone(nil), theater.Zones...),
	}
	for index := range view.Zones {
		if theater.Zones[index].Position != nil {
			posCopy := *theater.Zones[index].Position
			view.Zones[index].Position = &posCopy
		}
	}
	if theater.Objective != nil {
		objectiveCopy := *theater.Objective
		if theater.Objective.Position != nil {
			posCopy := *theater.Objective.Position
			objectiveCopy.Position = &posCopy
		}
		view.Objective = &objectiveCopy
	}
	view.TaskForceIDs = theaterTaskForceIDs(systemRuntime, theater.ID)
	return view
}

func theaterDetailView(theater *model.Theater, systemRuntime *model.PlayerSystemRuntime) TheaterDetailView {
	return theaterRuntimeView(theater, systemRuntime)
}

func theaterTaskForceIDs(systemRuntime *model.PlayerSystemRuntime, theaterID string) []string {
	if systemRuntime == nil || theaterID == "" {
		return nil
	}
	ids := make([]string, 0)
	for _, taskForce := range systemRuntime.TaskForces {
		if taskForce == nil || taskForce.TheaterID != theaterID {
			continue
		}
		ids = append(ids, taskForce.ID)
	}
	sort.Strings(ids)
	return ids
}
