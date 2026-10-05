package model

// CombatSquadState describes the current squad state.
type CombatSquadState string

const (
	CombatSquadStateIdle      CombatSquadState = "idle"
	CombatSquadStateEngaging  CombatSquadState = "engaging"
	CombatSquadStateDestroyed CombatSquadState = "destroyed"
)

// CombatSquad is a command container. Health, ammunition and movement belong
// exclusively to its world-unit members; destroying the container never kills units.
type CombatSquad struct {
	ID            string           `json:"id"`
	OwnerID       string           `json:"owner_id"`
	PlanetID      string           `json:"planet_id"`
	Name          string           `json:"name"`
	MemberIDs     []string         `json:"member_ids"`
	State         CombatSquadState `json:"state"`
	Position      Position         `json:"position"`
	Order         SquadOrder       `json:"order"`
	Target        *Position        `json:"target,omitempty"`
	LastOrderTick int64            `json:"last_order_tick"`
}

type SquadOrder string

const (
	SquadOrderIdle     SquadOrder = "idle"
	SquadOrderAttack   SquadOrder = "attack"
	SquadOrderDefend   SquadOrder = "defend"
	SquadOrderRetreat  SquadOrder = "retreat"
	SquadOrderResupply SquadOrder = "resupply"
)

func (s *CombatSquad) Clone() *CombatSquad {
	if s == nil {
		return nil
	}
	out := *s
	out.MemberIDs = append([]string(nil), s.MemberIDs...)
	if s.Target != nil {
		p := *s.Target
		out.Target = &p
	}
	return &out
}

// Members returns living members in stable roster order, never synthetic units.
func (s *CombatSquad) Members(ws *WorldState) []*Unit {
	if s == nil || ws == nil {
		return nil
	}
	out := make([]*Unit, 0, len(s.MemberIDs))
	for _, id := range s.MemberIDs {
		if u := ws.Units[id]; u != nil && u.HP > 0 && u.OwnerID == s.OwnerID {
			out = append(out, u)
		}
	}
	return out
}

// CombatRuntimeState stores authoritative combat runtime entities for one planet world.
type CombatRuntimeState struct {
	EntityCounter    int64                              `json:"entity_counter"`
	Squads           map[string]*CombatSquad            `json:"squads,omitempty"`
	Frontlines       map[string]*PlanetaryFrontline     `json:"frontlines,omitempty"`
	GroundTaskForces map[string]*GroundTaskForceRuntime `json:"ground_task_forces,omitempty"`
}

// NewCombatRuntimeState returns an initialized combat runtime container.
func NewCombatRuntimeState() *CombatRuntimeState {
	return &CombatRuntimeState{
		Squads:           make(map[string]*CombatSquad),
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
		Frontlines:       make(map[string]*PlanetaryFrontline, len(rt.Frontlines)),
		GroundTaskForces: make(map[string]*GroundTaskForceRuntime, len(rt.GroundTaskForces)),
	}
	for id, squad := range rt.Squads {
		if squad == nil {
			continue
		}
		out.Squads[id] = squad.Clone()
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
