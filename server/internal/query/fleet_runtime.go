package query

import "siliconworld/internal/model"

// SystemRuntimeView exposes dynamic system-scoped runtime state.
type SystemRuntimeView struct {
	SystemID        string                     `json:"system_id"`
	Discovered      bool                       `json:"discovered"`
	Available       bool                       `json:"available"`
	SolarSailOrbit  *model.SolarSailOrbitState `json:"solar_sail_orbit,omitempty"`
	Fleets          []FleetRuntimeView         `json:"fleets,omitempty"`
}

// FleetRuntimeView is a compact fleet summary.
type FleetRuntimeView struct {
	FleetID         string                 `json:"fleet_id"`
	OwnerID         string                 `json:"owner_id"`
	SystemID        string                 `json:"system_id"`
	SourceBuildingID string                `json:"source_building_id,omitempty"`
	Formation       string                 `json:"formation"`
	State           string                 `json:"state"`
	Units           []model.FleetUnitStack `json:"units,omitempty"`
	Target          *model.FleetTarget     `json:"target,omitempty"`
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
func (ql *Layer) SystemRuntime(playerID, systemID string, spaceRuntime *model.SpaceRuntimeState) (*SystemRuntimeView, bool) {
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
	for _, fleet := range systemRuntime.Fleets {
		if fleet == nil {
			continue
		}
		view.Fleets = append(view.Fleets, fleetRuntimeView(fleet))
	}
	return view, true
}

// Fleets returns all fleets visible to the player.
func (ql *Layer) Fleets(playerID string, spaceRuntime *model.SpaceRuntimeState) []FleetDetailView {
	if spaceRuntime == nil {
		return []FleetDetailView{}
	}
	var out []FleetDetailView
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
