package model

// GroundTaskForceOrder describes the planetary order currently executed by a task force.
type GroundTaskForceOrder string

const (
	GroundTaskForceOrderOccupy        GroundTaskForceOrder = "occupy"
	GroundTaskForceOrderAdvance       GroundTaskForceOrder = "advance"
	GroundTaskForceOrderHold          GroundTaskForceOrder = "hold"
	GroundTaskForceOrderClearObstacle GroundTaskForceOrder = "clear_obstacles"
	GroundTaskForceOrderEscortSupply  GroundTaskForceOrder = "escort_supply"
)

// ValidGroundTaskForceOrder reports whether order is supported.
func ValidGroundTaskForceOrder(order GroundTaskForceOrder) bool {
	switch order {
	case "",
		GroundTaskForceOrderOccupy,
		GroundTaskForceOrderAdvance,
		GroundTaskForceOrderHold,
		GroundTaskForceOrderClearObstacle,
		GroundTaskForceOrderEscortSupply:
		return true
	default:
		return false
	}
}

// OrbitalSupportMode describes how a ground task force consumes orbital fire support.
type OrbitalSupportMode string

const (
	OrbitalSupportModeNone        OrbitalSupportMode = "none"
	OrbitalSupportModeFireSupport OrbitalSupportMode = "fire_support"
	OrbitalSupportModeStrike      OrbitalSupportMode = "strike"
)

// ValidOrbitalSupportMode reports whether mode is supported.
func ValidOrbitalSupportMode(mode OrbitalSupportMode) bool {
	switch mode {
	case "",
		OrbitalSupportModeNone,
		OrbitalSupportModeFireSupport,
		OrbitalSupportModeStrike:
		return true
	default:
		return false
	}
}

// PlanetaryFrontlineStatus describes the live state of one frontline outpost.
type PlanetaryFrontlineStatus string

const (
	PlanetaryFrontlineStatusSecured   PlanetaryFrontlineStatus = "secured"
	PlanetaryFrontlineStatusContested PlanetaryFrontlineStatus = "contested"
	PlanetaryFrontlineStatusDestroyed PlanetaryFrontlineStatus = "destroyed"
)

// PlanetaryFrontlineType describes what kind of frontline object this is.
type PlanetaryFrontlineType string

const (
	PlanetaryFrontlineTypeBridgehead PlanetaryFrontlineType = "bridgehead"
	PlanetaryFrontlineTypeOutpost    PlanetaryFrontlineType = "outpost"
)

// PlanetaryFrontline stores one authoritative frontline object on a planet.
type PlanetaryFrontline struct {
	ID                     string                   `json:"id"`
	PlanetID               string                   `json:"planet_id"`
	OwnerID                string                   `json:"owner_id,omitempty"`
	Type                   PlanetaryFrontlineType   `json:"type"`
	BridgeheadID           string                   `json:"bridgehead_id,omitempty"`
	Position               *Position                `json:"position,omitempty"`
	Status                 PlanetaryFrontlineStatus `json:"status"`
	Control                float64                  `json:"control,omitempty"`
	Fortification          float64                  `json:"fortification,omitempty"`
	ObstacleLevel          float64                  `json:"obstacle_level,omitempty"`
	SupplyFlow             float64                  `json:"supply_flow,omitempty"`
	LastOrbitalSupportTick int64                    `json:"last_orbital_support_tick,omitempty"`
	UpdatedTick            int64                    `json:"updated_tick,omitempty"`
}

// GroundTaskForceStatus describes the live planetary progress of one task force.
type GroundTaskForceStatus string

const (
	GroundTaskForceStatusStaging    GroundTaskForceStatus = "staging"
	GroundTaskForceStatusContesting GroundTaskForceStatus = "contesting"
	GroundTaskForceStatusSecuring   GroundTaskForceStatus = "securing"
	GroundTaskForceStatusHolding    GroundTaskForceStatus = "holding"
	GroundTaskForceStatusClearing   GroundTaskForceStatus = "clearing"
	GroundTaskForceStatusSupplying  GroundTaskForceStatus = "supplying"
	GroundTaskForceStatusBlocked    GroundTaskForceStatus = "blocked"
)

// GroundTaskForceRuntime stores authoritative planetary execution state for one task force.
type GroundTaskForceRuntime struct {
	TaskForceID                 string                `json:"task_force_id"`
	OwnerID                     string                `json:"owner_id"`
	PlanetID                    string                `json:"planet_id"`
	FrontlineID                 string                `json:"frontline_id,omitempty"`
	BridgeheadID                string                `json:"bridgehead_id,omitempty"`
	GroundOrder                 GroundTaskForceOrder  `json:"ground_order,omitempty"`
	Status                      GroundTaskForceStatus `json:"status,omitempty"`
	Progress                    float64               `json:"progress,omitempty"`
	Pressure                    float64               `json:"pressure,omitempty"`
	OrbitalSupportMode          OrbitalSupportMode    `json:"orbital_support_mode,omitempty"`
	OrbitalSupportAvailable     bool                  `json:"orbital_support_available"`
	OrbitalSupportCooldown      int                   `json:"orbital_support_cooldown"`
	OrbitalSupportBlockedReason string                `json:"orbital_support_blocked_reason,omitempty"`
	LastOrbitalSupportTick      int64                 `json:"last_orbital_support_tick,omitempty"`
	UpdatedTick                 int64                 `json:"updated_tick,omitempty"`
}
