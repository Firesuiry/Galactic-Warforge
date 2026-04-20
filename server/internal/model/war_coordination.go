package model

import "math"

// WarTaskForceStance controls authoritative task-force behavior.
type WarTaskForceStance string

const (
	WarTaskForceStanceHold            WarTaskForceStance = "hold"
	WarTaskForceStancePatrol          WarTaskForceStance = "patrol"
	WarTaskForceStanceEscort          WarTaskForceStance = "escort"
	WarTaskForceStanceIntercept       WarTaskForceStance = "intercept"
	WarTaskForceStanceHarass          WarTaskForceStance = "harass"
	WarTaskForceStanceSiege           WarTaskForceStance = "siege"
	WarTaskForceStanceBombard         WarTaskForceStance = "bombard"
	WarTaskForceStanceRetreatOnLosses WarTaskForceStance = "retreat_on_losses"
)

// WarTaskForceMemberKind identifies which runtime bucket owns the member.
type WarTaskForceMemberKind string

const (
	WarTaskForceMemberKindSquad WarTaskForceMemberKind = "squad"
	WarTaskForceMemberKindFleet WarTaskForceMemberKind = "fleet"
)

// WarTheaterZoneType describes the role of a theater zone.
type WarTheaterZoneType string

const (
	WarTheaterZoneTypePrimary        WarTheaterZoneType = "primary"
	WarTheaterZoneTypeSecondary      WarTheaterZoneType = "secondary"
	WarTheaterZoneTypeNoEntry        WarTheaterZoneType = "no_entry"
	WarTheaterZoneTypeRally          WarTheaterZoneType = "rally"
	WarTheaterZoneTypeSupplyPriority WarTheaterZoneType = "supply_priority"
)

// WarCommandCapacitySourceType identifies how command capacity is provided.
type WarCommandCapacitySourceType string

const (
	WarCommandCapacitySourceCommandCenter       WarCommandCapacitySourceType = "command_center"
	WarCommandCapacitySourceCommandShip         WarCommandCapacitySourceType = "command_ship"
	WarCommandCapacitySourceBattlefieldAnalysis WarCommandCapacitySourceType = "battlefield_analysis_base"
	WarCommandCapacitySourceMilitaryAICore      WarCommandCapacitySourceType = "military_ai_core"
)

// WarTaskForceDeployment stores the current deployment intent for one task force.
type WarTaskForceDeployment struct {
	SystemID string    `json:"system_id,omitempty"`
	PlanetID string    `json:"planet_id,omitempty"`
	Position *Position `json:"position,omitempty"`
}

// WarTaskForceMemberRef stores one runtime member binding.
type WarTaskForceMemberRef struct {
	Kind     WarTaskForceMemberKind `json:"kind"`
	EntityID string                 `json:"entity_id"`
}

// WarTaskForce is the authoritative organization object above squads/fleets.
type WarTaskForce struct {
	ID          string                  `json:"id"`
	OwnerID     string                  `json:"owner_id"`
	Name        string                  `json:"name,omitempty"`
	TheaterID   string                  `json:"theater_id,omitempty"`
	Stance      WarTaskForceStance      `json:"stance"`
	Members     []WarTaskForceMemberRef `json:"members,omitempty"`
	Deployment  *WarTaskForceDeployment `json:"deployment,omitempty"`
	CreatedTick int64                   `json:"created_tick,omitempty"`
	UpdatedTick int64                   `json:"updated_tick,omitempty"`
}

// WarTheaterZone stores one named theater area.
type WarTheaterZone struct {
	ZoneType WarTheaterZoneType `json:"zone_type"`
	SystemID string             `json:"system_id,omitempty"`
	PlanetID string             `json:"planet_id,omitempty"`
	Position *Position          `json:"position,omitempty"`
	Radius   int                `json:"radius,omitempty"`
}

// WarTheaterObjective stores the current theater-level objective.
type WarTheaterObjective struct {
	ObjectiveType string `json:"objective_type"`
	SystemID      string `json:"system_id,omitempty"`
	PlanetID      string `json:"planet_id,omitempty"`
	EntityID      string `json:"entity_id,omitempty"`
	Description   string `json:"description,omitempty"`
}

// WarTheater groups zones and objectives for higher-level delegation.
type WarTheater struct {
	ID          string               `json:"id"`
	OwnerID     string               `json:"owner_id"`
	Name        string               `json:"name,omitempty"`
	Zones       []WarTheaterZone     `json:"zones,omitempty"`
	Objective   *WarTheaterObjective `json:"objective,omitempty"`
	CreatedTick int64                `json:"created_tick,omitempty"`
	UpdatedTick int64                `json:"updated_tick,omitempty"`
}

// WarCoordinationState stores organization runtime state for one player.
type WarCoordinationState struct {
	TaskForces map[string]*WarTaskForce `json:"task_forces,omitempty"`
	Theaters   map[string]*WarTheater   `json:"theaters,omitempty"`
}

// WarCommandCapacitySource reports one authoritative capacity provider.
type WarCommandCapacitySource struct {
	SourceID   string                       `json:"source_id"`
	SourceType WarCommandCapacitySourceType `json:"source_type"`
	Label      string                       `json:"label,omitempty"`
	EntityID   string                       `json:"entity_id,omitempty"`
	PlanetID   string                       `json:"planet_id,omitempty"`
	SystemID   string                       `json:"system_id,omitempty"`
	Capacity   int                          `json:"capacity"`
}

// WarCommandCapacityStatus describes current usage and penalties.
type WarCommandCapacityStatus struct {
	Total               int                        `json:"total"`
	Used                int                        `json:"used"`
	Over                int                        `json:"over,omitempty"`
	DelayPenalty        float64                    `json:"delay_penalty,omitempty"`
	HitPenalty          float64                    `json:"hit_penalty,omitempty"`
	FormationPenalty    float64                    `json:"formation_penalty,omitempty"`
	CoordinationPenalty float64                    `json:"coordination_penalty,omitempty"`
	Sources             []WarCommandCapacitySource `json:"sources,omitempty"`
}

// WarTaskForceMemberView resolves one task-force member against live runtime state.
type WarTaskForceMemberView struct {
	Kind         string   `json:"kind"`
	EntityID     string   `json:"entity_id"`
	PlanetID     string   `json:"planet_id,omitempty"`
	SystemID     string   `json:"system_id,omitempty"`
	BlueprintIDs []string `json:"blueprint_ids,omitempty"`
	Count        int      `json:"count,omitempty"`
	State        string   `json:"state,omitempty"`
}

// WarTaskForceView exposes query-facing task-force state.
type WarTaskForceView struct {
	ID              string                   `json:"id"`
	Name            string                   `json:"name,omitempty"`
	TheaterID       string                   `json:"theater_id,omitempty"`
	Stance          string                   `json:"stance"`
	Deployment      *WarTaskForceDeployment  `json:"deployment,omitempty"`
	Members         []WarTaskForceMemberView `json:"members,omitempty"`
	CommandCapacity WarCommandCapacityStatus `json:"command_capacity"`
}

// WarTaskForceListView is the list response for task forces.
type WarTaskForceListView struct {
	TaskForces []WarTaskForceView `json:"task_forces"`
}

// WarTheaterZoneView exposes query-facing theater zones.
type WarTheaterZoneView struct {
	ZoneType string    `json:"zone_type"`
	SystemID string    `json:"system_id,omitempty"`
	PlanetID string    `json:"planet_id,omitempty"`
	Position *Position `json:"position,omitempty"`
	Radius   int       `json:"radius,omitempty"`
}

// WarTheaterObjectiveView exposes query-facing theater objectives.
type WarTheaterObjectiveView struct {
	ObjectiveType string `json:"objective_type"`
	SystemID      string `json:"system_id,omitempty"`
	PlanetID      string `json:"planet_id,omitempty"`
	EntityID      string `json:"entity_id,omitempty"`
	Description   string `json:"description,omitempty"`
}

// WarTheaterView exposes query-facing theater state.
type WarTheaterView struct {
	ID        string                   `json:"id"`
	Name      string                   `json:"name,omitempty"`
	Zones     []WarTheaterZoneView     `json:"zones,omitempty"`
	Objective *WarTheaterObjectiveView `json:"objective,omitempty"`
}

// WarTheaterListView is the list response for theaters.
type WarTheaterListView struct {
	Theaters []WarTheaterView `json:"theaters"`
}

// WarTaskForceStanceProfile describes how a stance changes live behavior.
type WarTaskForceStanceProfile struct {
	TargetPriority        string  `json:"target_priority"`
	MaxEngagementDistance int     `json:"max_engagement_distance"`
	Pursue                bool    `json:"pursue"`
	PreferStealth         bool    `json:"prefer_stealth"`
	RetreatLossThreshold  float64 `json:"retreat_loss_threshold"`
}

// ValidWarTaskForceStance reports whether the stance is supported.
func ValidWarTaskForceStance(stance WarTaskForceStance) bool {
	switch stance {
	case WarTaskForceStanceHold,
		WarTaskForceStancePatrol,
		WarTaskForceStanceEscort,
		WarTaskForceStanceIntercept,
		WarTaskForceStanceHarass,
		WarTaskForceStanceSiege,
		WarTaskForceStanceBombard,
		WarTaskForceStanceRetreatOnLosses:
		return true
	default:
		return false
	}
}

// ValidWarTaskForceMemberKind reports whether the member kind is supported.
func ValidWarTaskForceMemberKind(kind WarTaskForceMemberKind) bool {
	switch kind {
	case WarTaskForceMemberKindSquad, WarTaskForceMemberKindFleet:
		return true
	default:
		return false
	}
}

// ValidWarTheaterZoneType reports whether the zone type is supported.
func ValidWarTheaterZoneType(zoneType WarTheaterZoneType) bool {
	switch zoneType {
	case WarTheaterZoneTypePrimary,
		WarTheaterZoneTypeSecondary,
		WarTheaterZoneTypeNoEntry,
		WarTheaterZoneTypeRally,
		WarTheaterZoneTypeSupplyPriority:
		return true
	default:
		return false
	}
}

// WarTaskForceProfile returns the live profile for one stance.
func WarTaskForceProfile(stance WarTaskForceStance) WarTaskForceStanceProfile {
	switch stance {
	case WarTaskForceStancePatrol:
		return WarTaskForceStanceProfile{TargetPriority: "nearest_to_anchor", MaxEngagementDistance: 12, Pursue: true, RetreatLossThreshold: 0.22}
	case WarTaskForceStanceEscort:
		return WarTaskForceStanceProfile{TargetPriority: "threat_to_anchor", MaxEngagementDistance: 10, Pursue: true, RetreatLossThreshold: 0.3}
	case WarTaskForceStanceIntercept:
		return WarTaskForceStanceProfile{TargetPriority: "strongest", MaxEngagementDistance: 24, Pursue: true, RetreatLossThreshold: 0.2}
	case WarTaskForceStanceHarass:
		return WarTaskForceStanceProfile{TargetPriority: "weakest", MaxEngagementDistance: 18, Pursue: true, PreferStealth: true, RetreatLossThreshold: 0.3}
	case WarTaskForceStanceSiege:
		return WarTaskForceStanceProfile{TargetPriority: "strongest", MaxEngagementDistance: 14, Pursue: false, RetreatLossThreshold: 0.4}
	case WarTaskForceStanceBombard:
		return WarTaskForceStanceProfile{TargetPriority: "strongest", MaxEngagementDistance: 20, Pursue: false, RetreatLossThreshold: 0.45}
	case WarTaskForceStanceRetreatOnLosses:
		return WarTaskForceStanceProfile{TargetPriority: "nearest_to_anchor", MaxEngagementDistance: 12, Pursue: false, RetreatLossThreshold: 0.55}
	case WarTaskForceStanceHold:
		fallthrough
	default:
		return WarTaskForceStanceProfile{TargetPriority: "nearest_to_anchor", MaxEngagementDistance: 8, Pursue: false, RetreatLossThreshold: 0.18}
	}
}

// Clone deep-copies coordination state.
func (state *WarCoordinationState) Clone() *WarCoordinationState {
	if state == nil {
		return nil
	}
	out := &WarCoordinationState{
		TaskForces: make(map[string]*WarTaskForce, len(state.TaskForces)),
		Theaters:   make(map[string]*WarTheater, len(state.Theaters)),
	}
	for id, taskForce := range state.TaskForces {
		if taskForce == nil {
			continue
		}
		copy := *taskForce
		copy.Members = append([]WarTaskForceMemberRef(nil), taskForce.Members...)
		if taskForce.Deployment != nil {
			deployment := *taskForce.Deployment
			if taskForce.Deployment.Position != nil {
				pos := *taskForce.Deployment.Position
				deployment.Position = &pos
			}
			copy.Deployment = &deployment
		}
		out.TaskForces[id] = &copy
	}
	for id, theater := range state.Theaters {
		if theater == nil {
			continue
		}
		copy := *theater
		copy.Zones = append([]WarTheaterZone(nil), theater.Zones...)
		for index := range copy.Zones {
			if theater.Zones[index].Position != nil {
				pos := *theater.Zones[index].Position
				copy.Zones[index].Position = &pos
			}
		}
		if theater.Objective != nil {
			objective := *theater.Objective
			copy.Objective = &objective
		}
		out.Theaters[id] = &copy
	}
	return out
}

// FindWarTaskForceByMember finds the current task force owning a member.
func FindWarTaskForceByMember(player *PlayerState, kind WarTaskForceMemberKind, entityID string) *WarTaskForce {
	if player == nil || player.WarCoordination == nil || entityID == "" {
		return nil
	}
	for _, taskForce := range player.WarCoordination.TaskForces {
		if taskForce == nil {
			continue
		}
		for _, member := range taskForce.Members {
			if member.Kind == kind && member.EntityID == entityID {
				return taskForce
			}
		}
	}
	return nil
}

// ResolveWarTaskForceMembers materializes task-force members against current runtime state.
func ResolveWarTaskForceMembers(player *PlayerState, taskForce *WarTaskForce, worlds map[string]*WorldState, spaceRuntime *SpaceRuntimeState) []WarTaskForceMemberView {
	if taskForce == nil {
		return nil
	}
	out := make([]WarTaskForceMemberView, 0, len(taskForce.Members))
	for _, member := range taskForce.Members {
		view := WarTaskForceMemberView{
			Kind:     string(member.Kind),
			EntityID: member.EntityID,
		}
		switch member.Kind {
		case WarTaskForceMemberKindSquad:
			for planetID, world := range worlds {
				if world == nil || world.CombatRuntime == nil {
					continue
				}
				squad := world.CombatRuntime.Squads[member.EntityID]
				if squad == nil {
					continue
				}
				view.PlanetID = planetID
				view.BlueprintIDs = []string{squad.BlueprintID}
				view.Count = squad.Count
				view.State = string(squad.State)
				break
			}
		case WarTaskForceMemberKindFleet:
			if spaceRuntime == nil {
				break
			}
			for _, playerRuntime := range spaceRuntime.Players {
				if playerRuntime == nil || playerRuntime.PlayerID != taskForce.OwnerID {
					continue
				}
				for systemID, systemRuntime := range playerRuntime.Systems {
					if systemRuntime == nil {
						continue
					}
					fleet := systemRuntime.Fleets[member.EntityID]
					if fleet == nil {
						continue
					}
					view.SystemID = systemID
					view.State = string(fleet.State)
					total := 0
					for _, stack := range fleet.Units {
						if stack.BlueprintID == "" || stack.Count <= 0 {
							continue
						}
						view.BlueprintIDs = append(view.BlueprintIDs, stack.BlueprintID)
						total += stack.Count
					}
					view.Count = total
					break
				}
			}
		}
		out = append(out, view)
	}
	return out
}

// EvaluateWarTaskForce computes live command-capacity totals and penalties.
func EvaluateWarTaskForce(player *PlayerState, taskForce *WarTaskForce, worlds map[string]*WorldState, spaceRuntime *SpaceRuntimeState) WarCommandCapacityStatus {
	status := WarCommandCapacityStatus{}
	if taskForce == nil {
		return status
	}

	status.Sources = collectWarCommandCapacitySources(player, taskForce, worlds, spaceRuntime)
	for _, source := range status.Sources {
		status.Total += source.Capacity
	}
	if status.Total <= 0 {
		status.Total = 1
	}

	members := ResolveWarTaskForceMembers(player, taskForce, worlds, spaceRuntime)
	memberKinds := make(map[string]struct{}, len(members))
	for _, member := range members {
		if member.Kind == "" {
			continue
		}
		memberKinds[member.Kind] = struct{}{}
		switch WarTaskForceMemberKind(member.Kind) {
		case WarTaskForceMemberKindSquad:
			status.Used += max(2, member.Count+1)
			if taskForce.Deployment != nil && taskForce.Deployment.PlanetID != "" && member.PlanetID != "" && member.PlanetID != taskForce.Deployment.PlanetID {
				status.Used += 2
			}
		case WarTaskForceMemberKindFleet:
			status.Used += max(3, member.Count*2+1)
			if taskForce.Deployment != nil && taskForce.Deployment.SystemID != "" && member.SystemID != "" && member.SystemID != taskForce.Deployment.SystemID {
				status.Used += 2
			}
		}
	}
	if len(memberKinds) > 1 {
		status.Used += 2
	}

	status.Over = max(0, status.Used-status.Total)
	if status.Over == 0 {
		return status
	}
	load := float64(status.Over) / float64(status.Total)
	status.DelayPenalty = roundWarPenalty(minFloat(0.75, 0.15+load*0.25))
	status.HitPenalty = roundWarPenalty(minFloat(0.6, 0.1+load*0.2))
	status.FormationPenalty = roundWarPenalty(minFloat(0.8, 0.12+load*0.28))
	status.CoordinationPenalty = roundWarPenalty(minFloat(0.9, 0.14+load*0.3))
	return status
}

func collectWarCommandCapacitySources(player *PlayerState, taskForce *WarTaskForce, worlds map[string]*WorldState, spaceRuntime *SpaceRuntimeState) []WarCommandCapacitySource {
	out := []WarCommandCapacitySource{{
		SourceID:   "hq:" + taskForce.OwnerID,
		SourceType: WarCommandCapacitySourceCommandCenter,
		Label:      "Player Command Center",
		Capacity:   4,
	}}

	for planetID, world := range worlds {
		if world == nil {
			continue
		}
		for _, building := range world.Buildings {
			if building == nil || building.OwnerID != taskForce.OwnerID {
				continue
			}
			switch building.Type {
			case BuildingTypeBattlefieldAnalysisBase:
				out = append(out, WarCommandCapacitySource{
					SourceID:   "analysis:" + building.ID,
					SourceType: WarCommandCapacitySourceBattlefieldAnalysis,
					Label:      "Battlefield Analysis Base",
					EntityID:   building.ID,
					PlanetID:   planetID,
					Capacity:   4,
				})
			case BuildingTypeSelfEvolutionLab:
				out = append(out, WarCommandCapacitySource{
					SourceID:   "ai-core:" + building.ID,
					SourceType: WarCommandCapacitySourceMilitaryAICore,
					Label:      "Military AI Core",
					EntityID:   building.ID,
					PlanetID:   planetID,
					Capacity:   2,
				})
			}
		}
	}

	if spaceRuntime == nil {
		return out
	}
	memberViews := ResolveWarTaskForceMembers(player, taskForce, worlds, spaceRuntime)
	for _, member := range memberViews {
		if member.Kind != string(WarTaskForceMemberKindFleet) {
			continue
		}
		if fleetProvidesCommandCapacity(player, member.BlueprintIDs) {
			out = append(out, WarCommandCapacitySource{
				SourceID:   "command-ship:" + member.EntityID,
				SourceType: WarCommandCapacitySourceCommandShip,
				Label:      "Command Ship",
				EntityID:   member.EntityID,
				SystemID:   member.SystemID,
				Capacity:   3,
			})
		}
	}
	return out
}

func fleetProvidesCommandCapacity(player *PlayerState, blueprintIDs []string) bool {
	for _, blueprintID := range blueprintIDs {
		blueprint, ok := ResolveWarBlueprintDefinition(player, blueprintID)
		if !ok {
			continue
		}
		if blueprint.BaseHullID == "destroyer_hull" {
			return true
		}
	}
	return false
}

func roundWarPenalty(value float64) float64 {
	return math.Round(value*100) / 100
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
