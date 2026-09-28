package model

// CombatSquadState describes the current squad state.
type CombatSquadState string

const (
	CombatSquadStateIdle      CombatSquadState = "idle"
	CombatSquadStateEngaging  CombatSquadState = "engaging"
	CombatSquadStateDestroyed CombatSquadState = "destroyed"
)

// CombatSquad is the authoritative runtime entity for deployable planetary combat units.
// 小队是实体化的编组战斗群（R3）：有真实坐标，沿路径移动，HP 池按伤害减员，
// 全灭后从运行时移除。
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
	MemberMaxHP      int                 `json:"member_max_hp,omitempty"` // 单员 HP；MaxHP = Count × MemberMaxHP
	HP               int                 `json:"hp"`
	MaxHP            int                 `json:"max_hp"`
	Shield           ShieldState         `json:"shield"`
	Weapon           WeaponState         `json:"weapon"`
	Sustainment      WarSustainmentState `json:"sustainment"`
	State            CombatSquadState    `json:"state"`
	TargetEnemyID    string              `json:"target_enemy_id,omitempty"`
	LastAttackTick   int64               `json:"last_attack_tick,omitempty"`

	// 实时位置与移动（R3）：与 model.Unit 同一套推进语义。
	Position     Position   `json:"position"`
	MoveSpeed    float64    `json:"move_speed"`              // 格/tick
	Path         []Position `json:"path,omitempty"`          // 完整路径（含起点）
	PathIndex    int        `json:"path_index,omitempty"`    // 下一个目标格下标
	MoveProgress float64    `json:"move_progress,omitempty"` // 向下一格的累计进度
	RepathTick   int64      `json:"repath_tick,omitempty"`   // 上次重寻路 tick
}

// HasPath 报告小队是否还有未走完的路径。
func (s *CombatSquad) HasPath() bool {
	return s != nil && s.PathIndex < len(s.Path)
}

// ClearPath 清空小队移动状态。
func (s *CombatSquad) ClearPath() {
	s.Path = nil
	s.PathIndex = 0
	s.MoveProgress = 0
}

// ApplySquadDamage 对 HP 池结算伤害并按 MemberMaxHP 折算减员；
// 返回本次减员数（死亡员额）。HP 归零时调用方负责移除小队。
func (s *CombatSquad) ApplySquadDamage(damage int) (losses int) {
	if s == nil || damage <= 0 || s.HP <= 0 {
		return 0
	}
	before := s.AliveCount()
	s.HP -= damage
	if s.HP < 0 {
		s.HP = 0
	}
	after := s.AliveCount()
	s.Count = after
	return before - after
}

// AliveCount 按 HP 池折算存活员额。
func (s *CombatSquad) AliveCount() int {
	if s == nil || s.HP <= 0 {
		return 0
	}
	per := s.MemberMaxHP
	if per <= 0 {
		if s.Count > 0 && s.MaxHP > 0 {
			per = s.MaxHP / s.Count
		}
		if per <= 0 {
			per = 1
		}
	}
	alive := (s.HP + per - 1) / per
	if s.Count > 0 && alive > s.Count {
		alive = s.Count
	}
	return alive
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
		copy := *squad
		copy.Sustainment = squad.Sustainment.Clone()
		if squad.Path != nil {
			copy.Path = append([]Position(nil), squad.Path...)
		}
		out.Squads[id] = &copy
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
