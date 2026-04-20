package model

// CombatSquadState describes the current squad state.
type CombatSquadState string

const (
	CombatSquadStateIdle      CombatSquadState = "idle"
	CombatSquadStateEngaging  CombatSquadState = "engaging"
	CombatSquadStateDestroyed CombatSquadState = "destroyed"
)

// CombatSquad is the authoritative runtime entity for deployable planetary combat units.
type CombatSquad struct {
	ID               string              `json:"id"`
	OwnerID          string              `json:"owner_id"`
	PlanetID         string              `json:"planet_id"`
	SourceBuildingID string              `json:"source_building_id,omitempty"`
	BlueprintID      string              `json:"blueprint_id"`
	Domain           UnitDomain          `json:"domain,omitempty"`
	BaseFrameID      string              `json:"base_frame_id,omitempty"`
	PlatformClass    string              `json:"platform_class,omitempty"`
	Count            int                 `json:"count"`
	HP               int                 `json:"hp"`
	MaxHP            int                 `json:"max_hp"`
	Shield           ShieldState         `json:"shield"`
	Weapon           WeaponState         `json:"weapon"`
	Sustainment      WarSustainmentState `json:"sustainment"`
	State            CombatSquadState    `json:"state"`
	TargetEnemyID    string              `json:"target_enemy_id,omitempty"`
	LastAttackTick   int64               `json:"last_attack_tick,omitempty"`
}

// CombatRuntimeState stores authoritative combat runtime entities for one planet world.
type CombatRuntimeState struct {
	EntityCounter    int64                              `json:"entity_counter"`
	Squads           map[string]*CombatSquad            `json:"squads,omitempty"`
	OrbitalPlatforms map[string]*OrbitalPlatform        `json:"orbital_platforms,omitempty"`
	Bridgeheads      map[string]*LandingBridgehead      `json:"bridgeheads,omitempty"`
	Frontlines       map[string]*PlanetaryFrontline     `json:"frontlines,omitempty"`
	GroundTaskForces map[string]*GroundTaskForceRuntime `json:"ground_task_forces,omitempty"`
}

// NewCombatRuntimeState returns an initialized combat runtime container.
func NewCombatRuntimeState() *CombatRuntimeState {
	return &CombatRuntimeState{
		Squads:           make(map[string]*CombatSquad),
		OrbitalPlatforms: make(map[string]*OrbitalPlatform),
		Bridgeheads:      make(map[string]*LandingBridgehead),
		Frontlines:       make(map[string]*PlanetaryFrontline),
		GroundTaskForces: make(map[string]*GroundTaskForceRuntime),
	}
}

// NextEntityID allocates a unique combat runtime entity ID.
func (rt *CombatRuntimeState) NextEntityID(prefix string) string {
	if rt == nil {
		return prefix + "-0"
	}
	rt.EntityCounter++
	return prefix + "-" + int64ToStr(rt.EntityCounter)
}

// CloneCombatRuntimeState deep-copies combat runtime state.
func CloneCombatRuntimeState(rt *CombatRuntimeState) *CombatRuntimeState {
	if rt == nil {
		return NewCombatRuntimeState()
	}
	out := &CombatRuntimeState{
		EntityCounter:    rt.EntityCounter,
		Squads:           make(map[string]*CombatSquad, len(rt.Squads)),
		OrbitalPlatforms: make(map[string]*OrbitalPlatform, len(rt.OrbitalPlatforms)),
		Bridgeheads:      make(map[string]*LandingBridgehead, len(rt.Bridgeheads)),
		Frontlines:       make(map[string]*PlanetaryFrontline, len(rt.Frontlines)),
		GroundTaskForces: make(map[string]*GroundTaskForceRuntime, len(rt.GroundTaskForces)),
	}
	for id, squad := range rt.Squads {
		if squad == nil {
			continue
		}
		copy := *squad
		copy.Sustainment = squad.Sustainment.Clone()
		out.Squads[id] = &copy
	}
	for id, platform := range rt.OrbitalPlatforms {
		if platform == nil {
			continue
		}
		copy := *platform
		out.OrbitalPlatforms[id] = &copy
	}
	for id, bridgehead := range rt.Bridgeheads {
		if bridgehead == nil {
			continue
		}
		copy := *bridgehead
		out.Bridgeheads[id] = &copy
	}
	for id, frontline := range rt.Frontlines {
		if frontline == nil {
			continue
		}
		copy := *frontline
		if frontline.Position != nil {
			pos := *frontline.Position
			copy.Position = &pos
		}
		out.Frontlines[id] = &copy
	}
	for id, taskForce := range rt.GroundTaskForces {
		if taskForce == nil {
			continue
		}
		copy := *taskForce
		out.GroundTaskForces[id] = &copy
	}
	return out
}
