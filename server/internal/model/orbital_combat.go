package model

// FormationType 编队类型
type FormationType string

const (
	FormationTypeLine   FormationType = "line"   // 线性
	FormationTypeVee    FormationType = "vee"    // V形
	FormationTypeCircle FormationType = "circle" // 环形
	FormationTypeWedge  FormationType = "wedge"  // 楔形
)

// FleetState describes the high-level fleet runtime state.
type FleetState string

const (
	FleetStateIdle      FleetState = "idle"
	FleetStateAttacking FleetState = "attacking"
)

// FleetTarget stores the current orbital-strike target.
type FleetTarget struct {
	PlanetID string `json:"planet_id"`
	TargetID string `json:"target_id,omitempty"`
}

// FleetTransitState tracks an in-flight inter-system jump.
// A fleet with Transit != nil is mid-jump: State stays idle, the fleet keeps
// its origin SystemID bucket until arrival, and progress derives from
// 1 - RemainingTicks/TotalTicks.
type FleetTransitState struct {
	FromSystemID   string `json:"from_system_id"`
	TargetSystemID string `json:"target_system_id"`
	TotalTicks     int64  `json:"total_ticks"`
	RemainingTicks int64  `json:"remaining_ticks"`
}

// FleetUnitStack stores unit counts by payload type.
type FleetUnitStack struct {
	BlueprintID string `json:"blueprint_id"`
	Count       int    `json:"count"`
}

// SpaceFleet 太空舰队
type SpaceFleet struct {
	ID                 string                   `json:"id"`
	OwnerID            string                   `json:"owner_id"`
	SystemID           string                   `json:"system_id"`
	AnchorPlanetID     string                   `json:"anchor_planet_id,omitempty"`
	SourceBuildingID   string                   `json:"source_building_id,omitempty"`
	Name               string                   `json:"name,omitempty"`
	Formation          FormationType            `json:"formation"`
	State              FleetState               `json:"state"`
	Units              []FleetUnitStack         `json:"units,omitempty"`
	Weapon             WeaponState              `json:"weapon"`
	Weapons            SpaceWeaponMix           `json:"weapons"`
	Shield             ShieldState              `json:"shield"`
	Armor              DurabilityLayerState     `json:"armor"`
	Structure          DurabilityLayerState     `json:"structure"`
	Subsystems         SpaceFleetSubsystemState `json:"subsystems"`
	Sustainment        WarSustainmentState      `json:"sustainment"`
	Target             *FleetTarget             `json:"target,omitempty"`
	Transit            *FleetTransitState       `json:"transit,omitempty"`
	LastAttackTick     int64                    `json:"last_attack_tick,omitempty"`
	LastBattleReportID string                   `json:"last_battle_report_id,omitempty"`
}
