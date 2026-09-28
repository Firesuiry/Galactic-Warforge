package model

// Position represents a 2D grid position (Z reserved for future 3D)
type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
	Z int `json:"z"`
}

// UnitType enumerates unit categories
type UnitType string

const (
	UnitTypeWorker   UnitType = "worker"
	UnitTypeSoldier  UnitType = "soldier"
	UnitTypeMecha    UnitType = "mecha"
	UnitTypeExecutor UnitType = "executor"
	// UnitTypeDarkFog 黑雾蜂群单位（E1）：巢穴孵化的实体敌方单位，
	// 归属保留势力 ID DarkFogOwnerID，与全体玩家互相敌对。
	UnitTypeDarkFog UnitType = "dark_fog"
)

// Building represents a constructed building entity
type Building struct {
	ID                string                  `json:"id"`
	Type              BuildingType            `json:"type"`
	OwnerID           string                  `json:"owner_id"`
	Position          Position                `json:"position"`
	HP                int                     `json:"hp"`
	MaxHP             int                     `json:"max_hp"`
	Level             int                     `json:"level"`
	VisionRange       int                     `json:"vision_range"`
	Runtime           BuildingRuntime         `json:"runtime"`
	Storage           *StorageState           `json:"storage,omitempty"`
	EnergyStorage     *EnergyStorageState     `json:"energy_storage,omitempty"`
	Conveyor          *ConveyorState          `json:"conveyor,omitempty"`
	Splitter          *SplitterState          `json:"splitter,omitempty"`
	TrafficMonitor    *TrafficMonitorState    `json:"traffic_monitor,omitempty"`
	Fractionation     *FractionationState     `json:"fractionation,omitempty"`
	SprayCoater       *SprayCoaterState       `json:"spray_coater,omitempty"`
	Sorter            *SorterState            `json:"sorter,omitempty"`
	Distributor       *DistributorState       `json:"distributor,omitempty"`
	LogisticsStation  *LogisticsStationState  `json:"logistics_station,omitempty"`
	Production        *ProductionState        `json:"production,omitempty"`
	Job               *BuildingJob            `json:"job,omitempty"`
	ProductionMonitor *ProductionMonitorState `json:"production_monitor,omitempty"`
	// FoundationTerrain stores the terrain replaced by a foundation, in footprint order.
	// It allows demolition and snapshot restore to return the tile to its prior state.
	FoundationTerrain []string `json:"foundation_terrain,omitempty"`
}

// Clone returns a deep copy of the building state for read-only snapshots.
func (b *Building) Clone() *Building {
	if b == nil {
		return nil
	}
	out := *b
	out.Runtime = BuildingRuntime{
		Params:      b.Runtime.Params.clone(),
		Functions:   b.Runtime.Functions.clone(),
		State:       b.Runtime.State,
		StateReason: b.Runtime.StateReason,
	}
	out.Storage = b.Storage.Clone()
	out.EnergyStorage = b.EnergyStorage.Clone()
	out.Conveyor = b.Conveyor.Clone()
	out.Sorter = b.Sorter.Clone()
	out.Splitter = b.Splitter.Clone()
	out.TrafficMonitor = b.TrafficMonitor.Clone()
	out.Fractionation = b.Fractionation.Clone()
	out.SprayCoater = b.SprayCoater.Clone()
	out.Distributor = b.Distributor.Clone()
	out.LogisticsStation = b.LogisticsStation.Clone()
	out.Production = b.Production.Clone()
	out.Job = b.Job.Clone()
	out.ProductionMonitor = b.ProductionMonitor.Clone()
	if b.FoundationTerrain != nil {
		out.FoundationTerrain = append([]string(nil), b.FoundationTerrain...)
	}
	return &out
}

// UnitStance 单位指令姿态（R5 指令集）。
// 姿态决定自动索敌、追击与移动行为；由 move/attack/unit_order 命令设置，
// 由 Tick 结算推进。
type UnitStance string

const (
	// UnitStanceIdle 原地待命：自动索敌，可追击，脱战后回到锚点。
	UnitStanceIdle UnitStance = "idle"
	// UnitStanceMoving 移动中：赶赴目标点，不主动索敌。
	UnitStanceMoving UnitStance = "moving"
	// UnitStanceAttackMove 攻击移动：沿途索敌并交战，目标清空后继续赶路。
	UnitStanceAttackMove UnitStance = "attack_move"
	// UnitStancePatrol 巡逻：在当前位置与目标点之间往返，沿途索敌。
	UnitStancePatrol UnitStance = "patrol"
	// UnitStanceGuard 守卫：跟随并保护目标单位/建筑，以其为锚点索敌。
	UnitStanceGuard UnitStance = "guard"
	// UnitStanceHold 原地坚守：不移动不追击，射程内目标自动开火。
	UnitStanceHold UnitStance = "hold"
	// UnitStanceFollow 跟随：跟随友方单位，保持近距离。
	UnitStanceFollow UnitStance = "follow"
	// UnitStanceRetreat 撤退：赶赴目标点，不索敌不还击，到达后转 idle。
	UnitStanceRetreat UnitStance = "retreat"
)

// Unit represents a mobile unit entity
type Unit struct {
	ID           string      `json:"id"`
	Type         UnitType    `json:"type"`
	OwnerID      string      `json:"owner_id"`
	Position     Position    `json:"position"`
	HP           int         `json:"hp"`
	MaxHP        int         `json:"max_hp"`
	Attack       int         `json:"attack"`
	Defense      int         `json:"defense"`
	AttackRange  int         `json:"attack_range"`
	MoveRange    int         `json:"move_range"`
	VisionRange  int         `json:"vision_range"`
	AttackTarget string      `json:"attack_target,omitempty"` // entity ID
	Mecha        *MechaState `json:"mecha,omitempty"`

	// 实时移动（R1）：每 tick 沿 Path 按 MoveSpeed 推进。
	MoveSpeed    float64    `json:"move_speed"`              // 格/tick
	Path         []Position `json:"path,omitempty"`          // 完整路径（含起点）
	PathIndex    int        `json:"path_index,omitempty"`    // 下一个目标格下标
	MoveProgress float64    `json:"move_progress,omitempty"` // 向下一格推进的累计进度
	BlockedTicks   int        `json:"blocked_ticks,omitempty"`    // 被占位阻挡的连续 tick 数
	RepathTick     int64      `json:"repath_tick,omitempty"`      // 上次追击重寻路 tick
	StuckCount     int        `json:"stuck_count,omitempty"`      // 连续寻路失败次数
	StuckUntilTick int64      `json:"stuck_until_tick,omitempty"` // 放弃自动重指派直到该 tick（防围堵下全图 BFS 风暴）
	ChaseGoalPos   *Position  `json:"chase_goal_pos,omitempty"`   // 上次追击寻路时的目标位置（滞回：目标小幅移动不重寻路）

	// 指令姿态与交战（R2/R5）
	// 伤害类型（R6）
	ArmorClass  ArmorClass `json:"armor_class,omitempty"`  // 护甲类型（缺省按单位类型推导）
	WeaponClass WeaponType `json:"weapon_class,omitempty"` // 武器类型（缺省按单位类型推导）

	Stance             UnitStance `json:"stance,omitempty"`
	OrderPos           *Position  `json:"order_pos,omitempty"`            // 攻击移动/巡逻终点/撤退目的地
	GuardTargetID      string     `json:"guard_target_id,omitempty"`      // 守卫/跟随目标实体
	CombatAnchor       *Position  `json:"combat_anchor,omitempty"`        // 接战锚点（守位/巡逻起点/追击范围基准）
	LastAttackerID     string     `json:"last_attacker_id,omitempty"`     // 最近攻击者（还击用）
	LastAttackTick     int64      `json:"last_attack_tick,omitempty"`     // 上次开火 tick
	AttackCooldownTick int64      `json:"attack_cooldown_ticks"`          // 开火冷却（tick）
	AggroRange         int        `json:"aggro_range"`                    // 自动索敌范围
}

// Clone returns a deep copy of the unit state for read-only snapshots.
func (u *Unit) Clone() *Unit {
	if u == nil {
		return nil
	}
	out := *u
	out.Mecha = u.Mecha.Clone()
	if u.Path != nil {
		out.Path = append([]Position(nil), u.Path...)
	}
	if u.OrderPos != nil {
		pos := *u.OrderPos
		out.OrderPos = &pos
	}
	if u.CombatAnchor != nil {
		pos := *u.CombatAnchor
		out.CombatAnchor = &pos
	}
	if u.ChaseGoalPos != nil {
		pos := *u.ChaseGoalPos
		out.ChaseGoalPos = &pos
	}
	return &out
}

// ClearMovement 清空移动状态（路径/进度/阻挡计数）。
func (u *Unit) ClearMovement() {
	u.Path = nil
	u.PathIndex = 0
	u.MoveProgress = 0
	u.BlockedTicks = 0
}

// ClearEngagement 清空交战状态（目标/锚点/还击标记）。
func (u *Unit) ClearEngagement() {
	u.AttackTarget = ""
	u.CombatAnchor = nil
	u.LastAttackerID = ""
	u.ChaseGoalPos = nil
}

// HasPath 报告单位是否还有未走完的路径。
func (u *Unit) HasPath() bool {
	return u != nil && u.PathIndex < len(u.Path)
}

// BuildingCost returns the resource cost to build a building type.
func BuildingCost(btype BuildingType) (minerals, energy int) {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return 0, 0
	}
	return def.BuildCost.Minerals, def.BuildCost.Energy
}

// UnitStats returns default stats for a unit type
func UnitStats(utype UnitType) Unit {
	u := Unit{Type: utype}
	switch utype {
	case UnitTypeWorker:
		u.MaxHP = 60
		u.HP = u.MaxHP
		u.Attack = 3
		u.Defense = 1
		u.AttackRange = 1
		u.MoveRange = 3
		u.VisionRange = 4
		u.MoveSpeed = 0.30
		u.AttackCooldownTick = 12
	case UnitTypeSoldier:
		u.MaxHP = 100
		u.HP = u.MaxHP
		u.Attack = 15
		u.Defense = 5
		u.AttackRange = 2
		u.MoveRange = 2
		u.VisionRange = 5
		u.MoveSpeed = 0.25
		u.AttackCooldownTick = 10
	case UnitTypeMecha:
		u.MaxHP = 240
		u.HP = u.MaxHP
		u.Attack = 28
		u.Defense = 12
		u.AttackRange = 4
		u.MoveRange = 3
		u.VisionRange = 7
		u.MoveSpeed = 0.35
		u.AttackCooldownTick = 8
	case UnitTypeExecutor:
		u.MaxHP = 120
		u.HP = u.MaxHP
		u.Attack = 20
		u.Defense = 8
		u.AttackRange = 4
		u.MoveRange = 12
		u.VisionRange = 6
		u.MoveSpeed = 0.50
		u.AttackCooldownTick = 6
		u.Mecha = NewMechaState()
	}
	if utype == UnitTypeDarkFog {
		u.MaxHP = 40
		u.HP = u.MaxHP
		u.Attack = 8
		u.Defense = 2
		u.AttackRange = 2
		u.MoveRange = 3
		u.VisionRange = 8
		u.MoveSpeed = 0.22
		u.AttackCooldownTick = 12
	}
	u.AggroRange = u.VisionRange
	u.Stance = UnitStanceIdle
	u.ArmorClass = ArmorClassForUnitType(utype)
	u.WeaponClass = WeaponClassForUnitType(utype)
	return u
}

// UnitCost returns the resource cost to produce a unit type
func UnitCost(utype UnitType) (minerals, energy int) {
	switch utype {
	case UnitTypeWorker:
		return 30, 10
	case UnitTypeSoldier:
		return 60, 20
	case UnitTypeMecha:
		return 180, 80
	}
	return 0, 0
}
