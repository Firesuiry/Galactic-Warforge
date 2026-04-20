package model

// RuntimeUnitKind identifies which authoritative runtime entity a task force member references.
type RuntimeUnitKind string

const (
	RuntimeUnitKindFleet       RuntimeUnitKind = "fleet"
	RuntimeUnitKindCombatSquad RuntimeUnitKind = "combat_squad"
)

// TaskForceStance defines the high-level operating posture for a task force.
type TaskForceStance string

const (
	TaskForceStanceHold              TaskForceStance = "hold"
	TaskForceStancePatrol            TaskForceStance = "patrol"
	TaskForceStanceEscort            TaskForceStance = "escort"
	TaskForceStanceIntercept         TaskForceStance = "intercept"
	TaskForceStanceHarass            TaskForceStance = "harass"
	TaskForceStanceSiege             TaskForceStance = "siege"
	TaskForceStanceBombard           TaskForceStance = "bombard"
	TaskForceStanceRetreatOnLosses   TaskForceStance = "retreat_on_losses"
	TaskForceStancePreserveStealth   TaskForceStance = "preserve_stealth"
	TaskForceStanceAggressivePursuit TaskForceStance = "aggressive_pursuit"
)

// TaskForceStatus tracks the current runtime mode of a task force.
type TaskForceStatus string

const (
	TaskForceStatusIdle       TaskForceStatus = "idle"
	TaskForceStatusDeploying  TaskForceStatus = "deploying"
	TaskForceStatusEngaging   TaskForceStatus = "engaging"
	TaskForceStatusRetreating TaskForceStatus = "retreating"
)

// TheaterZoneType defines the meaning of one theater zone.
type TheaterZoneType string

const (
	TheaterZonePrimary        TheaterZoneType = "primary"
	TheaterZoneSecondary      TheaterZoneType = "secondary"
	TheaterZoneExclusion      TheaterZoneType = "exclusion"
	TheaterZoneAssembly       TheaterZoneType = "assembly"
	TheaterZoneSupplyPriority TheaterZoneType = "supply_priority"
)

// CommandCapacitySourceType identifies where command bandwidth comes from.
type CommandCapacitySourceType string

const (
	CommandCapacitySourceCommandCenter           CommandCapacitySourceType = "command_center"
	CommandCapacitySourceCommandShip             CommandCapacitySourceType = "command_ship"
	CommandCapacitySourceBattlefieldAnalysisBase CommandCapacitySourceType = "battlefield_analysis_base"
	CommandCapacitySourceMilitaryAICore          CommandCapacitySourceType = "military_ai_core"
)

// TaskForceMemberRef points at one runtime entity under task-force control.
type TaskForceMemberRef struct {
	UnitKind RuntimeUnitKind `json:"unit_kind"`
	UnitID   string          `json:"unit_id"`
	SystemID string          `json:"system_id,omitempty"`
	PlanetID string          `json:"planet_id,omitempty"`
}

// TaskForceDeploymentTarget expresses where the task force is being sent.
type TaskForceDeploymentTarget struct {
	Layer    string    `json:"layer"`
	SystemID string    `json:"system_id,omitempty"`
	PlanetID string    `json:"planet_id,omitempty"`
	Position *Position `json:"position,omitempty"`
}

// TaskForceBehaviorProfile captures the authoritative behavior knobs derived from stance.
type TaskForceBehaviorProfile struct {
	TargetPriority            string  `json:"target_priority"`
	EngagementRangeMultiplier float64 `json:"engagement_range_multiplier"`
	Pursue                    bool    `json:"pursue"`
	PreserveStealth           bool    `json:"preserve_stealth"`
	RetreatLossThreshold      float64 `json:"retreat_loss_threshold"`
}

// CommandCapacitySource records one concrete command-bandwidth contributor.
type CommandCapacitySource struct {
	Type     CommandCapacitySourceType `json:"type"`
	SourceID string                    `json:"source_id"`
	Label    string                    `json:"label,omitempty"`
	Capacity int                       `json:"capacity"`
}

// CommandCapacityPenalty stores the currently effective over-capacity penalties.
type CommandCapacityPenalty struct {
	DelayTicks             int     `json:"delay_ticks"`
	HitRateMultiplier      float64 `json:"hit_rate_multiplier"`
	FormationMultiplier    float64 `json:"formation_multiplier"`
	CoordinationMultiplier float64 `json:"coordination_multiplier"`
}

// TaskForceCommandCapacity is the authoritative command-capacity snapshot for one task force.
type TaskForceCommandCapacity struct {
	Total   int                     `json:"total"`
	Used    int                     `json:"used"`
	Over    int                     `json:"over"`
	Sources []CommandCapacitySource `json:"sources,omitempty"`
	Penalty CommandCapacityPenalty  `json:"penalty"`
}

// TaskForce is the authoritative group-level runtime entity above fleets and squads.
type TaskForce struct {
	ID               string                     `json:"id"`
	OwnerID          string                     `json:"owner_id"`
	SystemID         string                     `json:"system_id"`
	Name             string                     `json:"name,omitempty"`
	TheaterID        string                     `json:"theater_id,omitempty"`
	Stance           TaskForceStance            `json:"stance"`
	Status           TaskForceStatus            `json:"status"`
	Members          []TaskForceMemberRef       `json:"members,omitempty"`
	DeploymentTarget *TaskForceDeploymentTarget `json:"deployment_target,omitempty"`
	Behavior         TaskForceBehaviorProfile   `json:"behavior"`
	CommandCapacity  TaskForceCommandCapacity   `json:"command_capacity"`
	LastUpdatedTick  int64                      `json:"last_updated_tick,omitempty"`
}

// TheaterZone marks one location class within a theater.
type TheaterZone struct {
	ZoneType TheaterZoneType `json:"zone_type"`
	SystemID string          `json:"system_id,omitempty"`
	PlanetID string          `json:"planet_id,omitempty"`
	Position *Position       `json:"position,omitempty"`
}

// TheaterObjective expresses the current strategic target of a theater.
type TheaterObjective struct {
	ObjectiveType  string    `json:"objective_type"`
	TargetSystemID string    `json:"target_system_id,omitempty"`
	TargetPlanetID string    `json:"target_planet_id,omitempty"`
	Position       *Position `json:"position,omitempty"`
}

// Theater is the authoritative runtime object for strategic zoning and objectives.
type Theater struct {
	ID              string            `json:"id"`
	OwnerID         string            `json:"owner_id"`
	SystemID        string            `json:"system_id"`
	Name            string            `json:"name,omitempty"`
	Zones           []TheaterZone     `json:"zones,omitempty"`
	Objective       *TheaterObjective `json:"objective,omitempty"`
	LastUpdatedTick int64             `json:"last_updated_tick,omitempty"`
}

// DefaultTaskForceBehavior returns the authoritative runtime profile for a given stance.
func DefaultTaskForceBehavior(stance TaskForceStance) TaskForceBehaviorProfile {
	switch stance {
	case TaskForceStancePatrol:
		return TaskForceBehaviorProfile{TargetPriority: "nearest_threat", EngagementRangeMultiplier: 1.0, Pursue: true}
	case TaskForceStanceEscort:
		return TaskForceBehaviorProfile{TargetPriority: "closest_threat_to_objective", EngagementRangeMultiplier: 0.95}
	case TaskForceStanceIntercept:
		return TaskForceBehaviorProfile{TargetPriority: "fastest_contact", EngagementRangeMultiplier: 1.1, Pursue: true}
	case TaskForceStanceHarass:
		return TaskForceBehaviorProfile{TargetPriority: "weakest_target", EngagementRangeMultiplier: 1.05, PreserveStealth: true}
	case TaskForceStanceSiege:
		return TaskForceBehaviorProfile{TargetPriority: "fortified_target", EngagementRangeMultiplier: 1.2}
	case TaskForceStanceBombard:
		return TaskForceBehaviorProfile{TargetPriority: "planetary_target", EngagementRangeMultiplier: 1.3}
	case TaskForceStanceRetreatOnLosses:
		return TaskForceBehaviorProfile{TargetPriority: "survivable_target", EngagementRangeMultiplier: 0.9, RetreatLossThreshold: 0.35}
	case TaskForceStancePreserveStealth:
		return TaskForceBehaviorProfile{TargetPriority: "isolated_target", EngagementRangeMultiplier: 0.85, PreserveStealth: true}
	case TaskForceStanceAggressivePursuit:
		return TaskForceBehaviorProfile{TargetPriority: "highest_threat", EngagementRangeMultiplier: 1.25, Pursue: true}
	case TaskForceStanceHold:
		fallthrough
	default:
		return TaskForceBehaviorProfile{TargetPriority: "nearest_threat", EngagementRangeMultiplier: 0.85}
	}
}

func cloneTaskForce(taskForce *TaskForce) *TaskForce {
	if taskForce == nil {
		return nil
	}
	copy := *taskForce
	copy.Members = append([]TaskForceMemberRef(nil), taskForce.Members...)
	copy.CommandCapacity.Sources = append([]CommandCapacitySource(nil), taskForce.CommandCapacity.Sources...)
	if taskForce.DeploymentTarget != nil {
		targetCopy := *taskForce.DeploymentTarget
		if taskForce.DeploymentTarget.Position != nil {
			posCopy := *taskForce.DeploymentTarget.Position
			targetCopy.Position = &posCopy
		}
		copy.DeploymentTarget = &targetCopy
	}
	return &copy
}

func cloneTheater(theater *Theater) *Theater {
	if theater == nil {
		return nil
	}
	copy := *theater
	copy.Zones = append([]TheaterZone(nil), theater.Zones...)
	for index := range copy.Zones {
		if theater.Zones[index].Position == nil {
			continue
		}
		posCopy := *theater.Zones[index].Position
		copy.Zones[index].Position = &posCopy
	}
	if theater.Objective != nil {
		objectiveCopy := *theater.Objective
		if theater.Objective.Position != nil {
			posCopy := *theater.Objective.Position
			objectiveCopy.Position = &posCopy
		}
		copy.Objective = &objectiveCopy
	}
	return &copy
}
