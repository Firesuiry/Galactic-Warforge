package model

import (
	"math"
	"sort"
	"sync"
)

// MatrixType represents the six types of science matrices
type MatrixType string

const (
	MatrixElectromagnetic MatrixType = "electromagnetic" // 蓝糖
	MatrixEnergy          MatrixType = "energy"          // 红糖
	MatrixStructure       MatrixType = "structure"       // 黄糖
	MatrixInformation     MatrixType = "information"     // 紫糖
	MatrixGravity         MatrixType = "gravity"         // 绿糖
	MatrixUniverse        MatrixType = "universe"        // 白糖
)

// TechCategory classifies techs into main/branch/bonus categories
type TechCategory string

const (
	TechCategoryMain   TechCategory = "main"
	TechCategoryBranch TechCategory = "branch"
	TechCategoryBonus  TechCategory = "bonus"
)

// TechType classifies techs by their field
type TechType string

const (
	TechTypeMain      TechType = "main"
	TechTypeEnergy    TechType = "energy"
	TechTypeLogistics TechType = "logistics"
	TechTypeSmelting  TechType = "smelting"
	TechTypeChemical  TechType = "chemical"
	TechTypeCombat    TechType = "combat"
	TechTypeMecha     TechType = "mecha"
	TechTypeDyson     TechType = "dyson"
)

// TechUnlockType indicates what a tech unlocks
type TechUnlockType string

const (
	TechUnlockBuilding TechUnlockType = "building"
	TechUnlockRecipe   TechUnlockType = "recipe"
	TechUnlockUnit     TechUnlockType = "unit"
	TechUnlockUpgrade  TechUnlockType = "upgrade"
	TechUnlockSpecial  TechUnlockType = "special"
)

// TechUnlock describes what content a tech unlocks
type TechUnlock struct {
	Type  TechUnlockType `json:"type" yaml:"type,omitempty"`
	ID    string         `json:"id" yaml:"id"`
	Level int            `json:"level,omitempty" yaml:"level,omitempty"`
}

// TechEffect describes bonuses from a tech
type TechEffect struct {
	Type  string  `json:"type" yaml:"type,omitempty"`   // e.g., "research_speed", "build_speed"
	Value float64 `json:"value" yaml:"value,omitempty"` // multiplier or flat bonus
}

// TechDefinition defines immutable data for a technology
type TechDefinition struct {
	ID            string       `json:"id" yaml:"id"`
	Name          string       `json:"name" yaml:"name"`
	NameEN        string       `json:"name_en" yaml:"name_en,omitempty"`
	Category      TechCategory `json:"category" yaml:"category,omitempty"`
	Type          TechType     `json:"type" yaml:"type,omitempty"`
	Level         int          `json:"level" yaml:"level,omitempty"` // 0 = initial, 1+ = progression
	Prerequisites []string     `json:"prerequisites,omitempty" yaml:"prerequisites,omitempty"`
	Cost          []ItemAmount `json:"cost" yaml:"cost,omitempty"` // matrix cost (level 1 cost for repeatable techs)
	// CostPerLevel overrides Cost for repeatable techs whose research cost varies
	// per level (DSP tech_costs per-level data). Key is the 1-based level being
	// researched. Levels missing from the map fall back to the nearest lower
	// defined level, then to Cost.
	CostPerLevel map[int][]ItemAmount `json:"cost_per_level,omitempty" yaml:"cost_per_level,omitempty"`
	Unlocks      []TechUnlock         `json:"unlocks,omitempty" yaml:"unlocks,omitempty"`
	Effects      []TechEffect         `json:"effects,omitempty" yaml:"effects,omitempty"`
	LeadsTo      []string             `json:"leads_to,omitempty" yaml:"-"`                    // derived
	MaxLevel     int                  `json:"max_level,omitempty" yaml:"max_level,omitempty"` // 0 = not repeatable, 1+ = repeatable that many times, -1 = infinite
	Hidden       bool                 `json:"hidden,omitempty" yaml:"hidden,omitempty"`
}

// ResearchState tracks the state of a research task
type ResearchState string

const (
	ResearchPending    ResearchState = "pending"
	ResearchInProgress ResearchState = "in_progress"
	ResearchCompleted  ResearchState = "completed"
	ResearchCancelled  ResearchState = "cancelled"
)

// PlayerResearch tracks a player's research progress
type PlayerResearch struct {
	TechID        string         `json:"tech_id"`
	State         ResearchState  `json:"state"`
	Progress      int64          `json:"progress"`
	TotalCost     int64          `json:"total_cost"`
	CurrentLevel  int            `json:"current_level"`
	RequiredCost  []ItemAmount   `json:"required_cost,omitempty"`
	ConsumedCost  map[string]int `json:"consumed_cost,omitempty"`
	BlockedReason string         `json:"blocked_reason,omitempty"`
	// SpeedMultiplier is the current research speed factor from lab power
	// allocation (1 = fully powered). Refreshed every research settlement tick.
	SpeedMultiplier float64 `json:"speed_multiplier"`
	// EstimatedTicksRemaining estimates the ticks left at the current effective
	// research speed; 0 (omitted) when progress is stalled.
	EstimatedTicksRemaining int64 `json:"estimated_ticks_remaining,omitempty"`
	EnqueueTick             int64 `json:"enqueue_tick"`
	CompleteTick            int64 `json:"complete_tick,omitempty"`
}

// PlayerTechState tracks all tech research state for a player
type PlayerTechState struct {
	PlayerID        string            `json:"player_id"`
	CompletedTechs  map[string]int    `json:"completed_techs"` // tech_id -> level (for repeatable)
	CurrentResearch *PlayerResearch   `json:"current_research,omitempty"`
	ResearchQueue   []*PlayerResearch `json:"research_queue,omitempty"`
	TotalResearched int64             `json:"total_researched"` // total matrix consumed
	// ResearchPace 本局研究消耗倍率（battlefield.pace_research 的归一化值）。
	// 由 GameCore 在开局/存档恢复时写入，只读镜像：目录里的科技成本是基准值，
	// 结算与 GET /catalog 的 techs[].cost 都按它缩放，保证 UI 与结算一致。
	ResearchPace float64 `json:"research_pace,omitempty"`
}

// PaceOrOne 归一化倍率：未设置/非正/NaN/Inf 一律按 1 处理。
func PaceOrOne(v float64) float64 {
	if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		return 1
	}
	return v
}

// ScaledResearchCost 按研究倍率缩放科技成本；取整规则与结算一致（四舍五入、下限 1）。
func ScaledResearchCost(cost []ItemAmount, pace float64) []ItemAmount {
	out := make([]ItemAmount, len(cost))
	copy(out, cost)
	pace = PaceOrOne(pace)
	if pace == 1 {
		return out
	}
	for i := range out {
		if out[i].Quantity > 0 {
			out[i].Quantity = ScalePaceTicks(out[i].Quantity, pace)
		}
	}
	return out
}

// ScalePaceTicks 按倍率缩放一个正整数（四舍五入，下限 1）；pace=1 时原样返回。
func ScalePaceTicks(base int, pace float64) int {
	if base < 1 {
		base = 1
	}
	pace = PaceOrOne(pace)
	if pace == 1 {
		return base
	}
	scaled := int(math.Round(float64(base) * pace))
	if scaled < 1 {
		return 1
	}
	return scaled
}

// TechCostForPlayer 返回该玩家下一级研究实际需要支付的物品成本（已按本局
// pace_research 缩放）；前置未满足或科技未知时返回 false。
func TechCostForPlayer(player *PlayerState, techID string) ([]ItemAmount, bool) {
	def, ok := TechDefinitionByID(techID)
	if !ok || player == nil || player.Tech == nil {
		return nil, false
	}
	if !player.Tech.HasPrerequisites(def) {
		return nil, false
	}
	base := def.CostForLevel(player.Tech.CompletedTechs[techID] + 1)
	return ScaledResearchCost(base, player.Tech.ResearchPace), true
}

const initialTechID = "dyson_sphere_program"

// DefaultCompletedTechs returns the default completed tech set for a new player.
func DefaultCompletedTechs() map[string]int {
	return map[string]int{
		initialTechID: 1,
	}
}

// NewPlayerTechState returns an initialized tech state for a player.
func NewPlayerTechState(playerID string) *PlayerTechState {
	return &PlayerTechState{
		PlayerID:       playerID,
		CompletedTechs: DefaultCompletedTechs(),
	}
}

// HasTech checks if player has completed a tech
func (pt *PlayerTechState) HasTech(techID string) bool {
	if pt == nil {
		return false
	}
	_, ok := pt.CompletedTechs[techID]
	return ok
}

// HasPrerequisites checks if player has all prerequisites for a tech
func (pt *PlayerTechState) HasPrerequisites(def *TechDefinition) bool {
	if def == nil || len(def.Prerequisites) == 0 {
		return true
	}
	for _, prereq := range def.Prerequisites {
		if !pt.HasTech(prereq) {
			return false
		}
	}
	return true
}

// CostForLevel returns the item cost to research the given 1-based level.
// Techs without CostPerLevel always return Cost (behavior unchanged).
func (d *TechDefinition) CostForLevel(level int) []ItemAmount {
	if d == nil {
		return nil
	}
	if len(d.CostPerLevel) == 0 {
		return d.Cost
	}
	if cost, ok := d.CostPerLevel[level]; ok {
		return cost
	}
	best := -1
	for lv := range d.CostPerLevel {
		if lv <= level && lv > best {
			best = lv
		}
	}
	if best > 0 {
		return d.CostPerLevel[best]
	}
	return d.Cost
}

// TechCatalog provides access to tech definitions
type TechCatalog struct {
	mu    sync.RWMutex
	techs map[string]*TechDefinition
}

// techCatalog 归一化后的科技表（由 InstallGameData 构建）。
var techCatalog *TechCatalog

// TechDefinitionByID returns a tech definition by ID
func TechDefinitionByID(id string) (*TechDefinition, bool) {
	ensureTechCatalogDerived()
	techCatalog.mu.RLock()
	defer techCatalog.mu.RUnlock()
	def, ok := techCatalog.techs[id]
	return def, ok
}

// AllTechDefinitions returns all tech definitions sorted by level
func AllTechDefinitions() []*TechDefinition {
	ensureTechCatalogDerived()
	techCatalog.mu.RLock()
	defer techCatalog.mu.RUnlock()
	defs := make([]*TechDefinition, 0, len(techCatalog.techs))
	for _, def := range techCatalog.techs {
		defs = append(defs, def)
	}
	sort.Slice(defs, func(i, j int) bool {
		if defs[i].Level != defs[j].Level {
			return defs[i].Level < defs[j].Level
		}
		return defs[i].ID < defs[j].ID
	})
	return defs
}

// normalizeTechUnlocks 剔除 techs.yaml pending_recipe_unlocks 中登记的待落地配方解锁并去重。
// 其余解锁在加载时已通过引用校验。整张解锁表因此清空的科技视为无公开价值，
// 若也没有可见后继则被隐藏（见 ensureTechCatalogDerived）。
func normalizeTechUnlocks(unlocks []TechUnlock) []TechUnlock {
	if len(unlocks) == 0 {
		return nil
	}
	out := make([]TechUnlock, 0, len(unlocks))
	for _, unlock := range unlocks {
		if unlock.Type == TechUnlockRecipe {
			if _, pending := pendingRecipeUnlocks[unlock.ID]; pending {
				continue
			}
		}
		out = appendUniqueUnlock(out, unlock)
	}
	return out
}

func appendUniqueUnlock(unlocks []TechUnlock, unlock TechUnlock) []TechUnlock {
	for _, existing := range unlocks {
		if existing.Type == unlock.Type && existing.ID == unlock.ID && existing.Level == unlock.Level {
			return unlocks
		}
	}
	return append(unlocks, unlock)
}
