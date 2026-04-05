package model

import (
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
	Type  TechUnlockType `json:"type" yaml:"type"`
	ID    string         `json:"id" yaml:"id"`
	Level int            `json:"level,omitempty" yaml:"level,omitempty"`
}

// TechEffect describes bonuses from a tech
type TechEffect struct {
	Type  string  `json:"type" yaml:"type"`   // e.g., "research_speed", "build_speed"
	Value float64 `json:"value" yaml:"value"` // multiplier or flat bonus
}

// TechDefinition defines immutable data for a technology
type TechDefinition struct {
	ID            string       `json:"id" yaml:"id"`
	Name          string       `json:"name" yaml:"name"`
	NameEN        string       `json:"name_en" yaml:"name_en"`
	Category      TechCategory `json:"category" yaml:"category"`
	Type          TechType     `json:"type" yaml:"type"`
	Level         int          `json:"level" yaml:"level"` // 0 = initial, 1+ = progression
	Prerequisites []string     `json:"prerequisites,omitempty" yaml:"prerequisites,omitempty"`
	Cost          []ItemAmount `json:"cost" yaml:"cost"` // matrix cost
	Unlocks       []TechUnlock `json:"unlocks,omitempty" yaml:"unlocks,omitempty"`
	Effects       []TechEffect `json:"effects,omitempty" yaml:"effects,omitempty"`
	LeadsTo       []string     `json:"leads_to,omitempty" yaml:"leads_to,omitempty"`
	MaxLevel      int          `json:"max_level,omitempty" yaml:"max_level,omitempty"` // 0 = not repeatable, 1+ = repeatable that many times, -1 = infinite
	Hidden        bool         `json:"hidden,omitempty" yaml:"hidden,omitempty"`
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
	EnqueueTick   int64          `json:"enqueue_tick"`
	CompleteTick  int64          `json:"complete_tick,omitempty"`
}

// PlayerTechState tracks all tech research state for a player
type PlayerTechState struct {
	PlayerID        string            `json:"player_id"`
	CompletedTechs  map[string]int    `json:"completed_techs"` // tech_id -> level (for repeatable)
	CurrentResearch *PlayerResearch   `json:"current_research,omitempty"`
	ResearchQueue   []*PlayerResearch `json:"research_queue,omitempty"`
	TotalResearched int64             `json:"total_researched"` // total matrix consumed
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

// TechCatalog provides access to tech definitions
type TechCatalog struct {
	mu    sync.RWMutex
	techs map[string]*TechDefinition
}

var (
	techCatalog     *TechCatalog
	techCatalogOnce sync.Once
)

func init() {
	techCatalogOnce.Do(func() {
		normalized := normalizeTechDefinitions(defaultTechDefinitions)
		techCatalog = &TechCatalog{
			techs: make(map[string]*TechDefinition),
		}
		for i := range normalized {
			techCatalog.techs[normalized[i].ID] = &normalized[i]
		}
	})
}

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

// TechDefinitionsByType returns all techs of a given type
func TechDefinitionsByType(typ TechType) []*TechDefinition {
	ensureTechCatalogDerived()
	techCatalog.mu.RLock()
	defer techCatalog.mu.RUnlock()
	defs := make([]*TechDefinition, 0)
	for _, def := range techCatalog.techs {
		if def.Type == typ {
			defs = append(defs, def)
		}
	}
	return defs
}

// DefaultTechDefinitions contains all tech tree data aligned with DSP
var defaultTechDefinitions = []TechDefinition{
	// Level 0 - Initial (Dyson Sphere Program is pre-completed)
	{
		ID:       "dyson_sphere_program",
		Name:     "戴森球计划",
		NameEN:   "Dyson Sphere Program",
		Category: TechCategoryMain,
		Type:     TechTypeMain,
		Level:    0,
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "matrix_lab"},
			{Type: TechUnlockBuilding, ID: "wind_turbine"},
		},
	},

	// Level 1
	{
		ID:            "electromagnetism",
		Name:          "电磁学",
		NameEN:        "Electromagnetism",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         1,
		Prerequisites: []string{"dyson_sphere_program"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 10}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "power_pylon"},
			{Type: TechUnlockBuilding, ID: "mining_machine"},
		},
	},

	// Level 2
	{
		ID:            "basic_logistics_system",
		Name:          "基础物流系统",
		NameEN:        "Basic Logistics System",
		Category:      TechCategoryMain,
		Type:          TechTypeLogistics,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 10}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "conveyor_mk1"},
			{Type: TechUnlockBuilding, ID: "sorter_mk1"},
			{Type: TechUnlockBuilding, ID: "storage_mk1"},
		},
	},
	{
		ID:            "automatic_metallurgy",
		Name:          "自动化冶金",
		NameEN:        "Automatic Metallurgy",
		Category:      TechCategoryMain,
		Type:          TechTypeSmelting,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 10}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "arc_smelter"},
			{Type: TechUnlockRecipe, ID: "glass"},
		},
	},
	{
		ID:            "electromagnetic_matrix",
		Name:          "电磁矩阵",
		NameEN:        "Electromagnetic Matrix",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 10}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "electromagnetic_matrix"},
		},
	},
	{
		ID:            "basic_assembling_processes",
		Name:          "基础制造工艺",
		NameEN:        "Basic Assembling Processes",
		Category:      TechCategoryMain,
		Type:          TechTypeSmelting,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 10}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "assembler_mk1"},
		},
	},
	{
		ID:            "fluid_storage",
		Name:          "液体储存封装",
		NameEN:        "Fluid Storage Encapsulation",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 50}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "fluid_tank"},
			{Type: TechUnlockBuilding, ID: "pump"},
		},
	},
	{
		ID:            "plasma_control",
		Name:          "高效电浆控制",
		NameEN:        "High-Efficiency Plasma Control",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 50}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "prism"},
			{Type: TechUnlockBuilding, ID: "plasma_exciter"},
			{Type: TechUnlockBuilding, ID: "wireless_pylon"},
		},
	},
	{
		ID:            "electromagnetic_drive",
		Name:          "电磁驱动",
		NameEN:        "Electromagnetic Drive",
		Category:      TechCategoryBranch,
		Type:          TechTypeLogistics,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 50}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "electric_motor"},
		},
	},
	{
		ID:            "engine",
		Name:          "发动机",
		NameEN:        "Engine",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         2,
		Prerequisites: []string{"electromagnetism"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 20}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockUnit, ID: "engine"},
		},
	},
	{
		ID:            "weapon_system",
		Name:          "武器系统",
		NameEN:        "Weapon System",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         2,
		Prerequisites: []string{"electromagnetism", "automatic_metallurgy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 20}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "gauss_turret"},
			{Type: TechUnlockRecipe, ID: "magnum_ammo"},
		},
	},

	// Level 3
	{
		ID:            "improved_logistics",
		Name:          "改良物流系统",
		NameEN:        "Improved Logistics System",
		Category:      TechCategoryMain,
		Type:          TechTypeLogistics,
		Level:         3,
		Prerequisites: []string{"electromagnetic_drive"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "splitter"},
			{Type: TechUnlockBuilding, ID: "sorter_mk2"},
			{Type: TechUnlockBuilding, ID: "flow_monitor"},
		},
	},
	{
		ID:            "steel_smelting",
		Name:          "钢材冶炼",
		NameEN:        "Steel Smelting",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         3,
		Prerequisites: []string{"automatic_metallurgy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 120}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "steel"},
		},
	},
	{
		ID:            "combustible_unit",
		Name:          "燃烧单元",
		NameEN:        "Combustible Unit",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         3,
		Prerequisites: []string{"automatic_metallurgy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 120}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "combustible_unit"},
		},
	},
	{
		ID:            "smelting_purification",
		Name:          "冶炼提纯",
		NameEN:        "Smelting Purification",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         3,
		Prerequisites: []string{"automatic_metallurgy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "silicon_ore"},
			{Type: TechUnlockRecipe, ID: "graphite"},
			{Type: TechUnlockRecipe, ID: "high_purity_silicon"},
		},
	},
	{
		ID:            "thermal_power",
		Name:          "热力发电",
		NameEN:        "Thermal Power",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         3,
		Prerequisites: []string{"basic_assembling_processes"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 30}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "thermal_power_plant"},
		},
	},
	{
		ID:            "plasma_refining",
		Name:          "等离子萃取精炼",
		NameEN:        "Plasma Extract Refining",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         3,
		Prerequisites: []string{"fluid_storage", "plasma_control"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "oil_extractor"},
			{Type: TechUnlockBuilding, ID: "refinery"},
			{Type: TechUnlockRecipe, ID: "refined_oil"},
		},
	},
	{
		ID:            "battlefield_analysis",
		Name:          "战场分析基站",
		NameEN:        "Battlefield Analysis Base",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         3,
		Prerequisites: []string{"engine", "weapon_system"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "battlefield_analysis_base"},
		},
	},

	// Level 4
	{
		ID:            "environment_modification",
		Name:          "地形改造",
		NameEN:        "Environment Modification",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         4,
		Prerequisites: []string{"steel_smelting"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "foundation"},
		},
	},
	{
		ID:            "crystal_smelting",
		Name:          "晶体冶炼",
		NameEN:        "Crystal Smelting",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         4,
		Prerequisites: []string{"smelting_purification"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 500}, {ItemID: "energy_matrix", Quantity: 500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "diamond"},
			{Type: TechUnlockRecipe, ID: "crystal"},
		},
	},
	{
		ID:            "solar_collection",
		Name:          "太阳能收集",
		NameEN:        "Solar Collection",
		Category:      TechCategoryMain,
		Type:          TechTypeEnergy,
		Level:         4,
		Prerequisites: []string{"smelting_purification", "basic_assembling_processes"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "solar_panel"},
		},
	},
	{
		ID:            "semiconductor",
		Name:          "半导体材料",
		NameEN:        "Semiconductor Material",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         4,
		Prerequisites: []string{"basic_assembling_processes"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "microcrystalline"},
		},
	},
	{
		ID:            "proliferator_mk1",
		Name:          "增产剂Mk.I",
		NameEN:        "Proliferator Mk.I",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         4,
		Prerequisites: []string{"semiconductor", "plasma_control"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "spray_coater"},
			{Type: TechUnlockRecipe, ID: "proliferator_mk1"},
		},
	},
	{
		ID:            "deuterium_fractionation",
		Name:          "重氢分馏",
		NameEN:        "Deuterium Fractionation",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         4,
		Prerequisites: []string{"thermal_power", "plasma_refining"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}, {ItemID: "energy_matrix", Quantity: 300}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "fractionator"},
			{Type: TechUnlockRecipe, ID: "deuterium"},
		},
	},
	{
		ID:            "basic_chemical",
		Name:          "基础化工",
		NameEN:        "Basic Chemical Engineering",
		Category:      TechCategoryMain,
		Type:          TechTypeChemical,
		Level:         4,
		Prerequisites: []string{"fluid_storage", "plasma_refining"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "chemical_plant"},
			{Type: TechUnlockRecipe, ID: "plastic"},
			{Type: TechUnlockRecipe, ID: "sulfuric_acid"},
		},
	},
	{
		ID:            "energy_matrix",
		Name:          "能量矩阵",
		NameEN:        "Energy Matrix",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         4,
		Prerequisites: []string{"plasma_refining"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "energy_matrix"},
		},
	},
	{
		ID:            "magnetic_levitation",
		Name:          "磁悬浮技术",
		NameEN:        "Magnetic Levitation",
		Category:      TechCategoryMain,
		Type:          TechTypeLogistics,
		Level:         4,
		Prerequisites: []string{"electromagnetic_drive"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}, {ItemID: "energy_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "EM_rail"},
		},
	},
	{
		ID:            "missile_turret",
		Name:          "导弹防御塔",
		NameEN:        "Missile Turret",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         4,
		Prerequisites: []string{"engine", "weapon_system", "combustible_unit"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 150}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "missile_turret"},
			{Type: TechUnlockRecipe, ID: "missile"},
		},
	},
	{
		ID:            "prototype",
		Name:          "原型机",
		NameEN:        "Prototype",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         4,
		Prerequisites: []string{"battlefield_analysis", "plasma_control"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "prototype"},
		},
	},

	// Level 5
	{
		ID:            "efficient_logistics",
		Name:          "高效物流系统",
		NameEN:        "High-Efficiency Logistics System",
		Category:      TechCategoryMain,
		Type:          TechTypeLogistics,
		Level:         5,
		Prerequisites: []string{"improved_logistics", "magnetic_levitation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}, {ItemID: "energy_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "conveyor_mk2"},
			{Type: TechUnlockBuilding, ID: "sorter_mk3"},
			{Type: TechUnlockBuilding, ID: "storage_mk2"},
		},
	},
	{
		ID:            "distribution_logistics",
		Name:          "配送物流系统",
		NameEN:        "Distribution Logistics System",
		Category:      TechCategoryBranch,
		Type:          TechTypeLogistics,
		Level:         5,
		Prerequisites: []string{"improved_logistics", "magnetic_levitation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 300}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "logistics_distributor"},
			{Type: TechUnlockBuilding, ID: "logistics_bot"},
		},
	},
	{
		ID:            "titanium_smelting",
		Name:          "钛矿冶炼",
		NameEN:        "Titanium Smelting",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         5,
		Prerequisites: []string{"steel_smelting"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}, {ItemID: "energy_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "titanium"},
		},
	},
	{
		ID:            "energy_storage",
		Name:          "能量储存",
		NameEN:        "Energy Storage",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         5,
		Prerequisites: []string{"crystal_smelting", "solar_collection"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "accumulator"},
		},
	},
	{
		ID:            "photon_conversion",
		Name:          "光子变频",
		NameEN:        "Photon Frequency Conversion",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         5,
		Prerequisites: []string{"solar_collection"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}, {ItemID: "energy_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "photon_combiner"},
		},
	},
	{
		ID:            "processor",
		Name:          "处理器",
		NameEN:        "Processor",
		Category:      TechCategoryMain,
		Type:          TechTypeSmelting,
		Level:         5,
		Prerequisites: []string{"semiconductor"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "processor"},
		},
	},
	{
		ID:            "superconductor",
		Name:          "应用超导体",
		NameEN:        "Applied Superconductor",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         5,
		Prerequisites: []string{"basic_chemical"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "graphene"},
		},
	},
	{
		ID:            "polymer_chemical",
		Name:          "高分子化工",
		NameEN:        "Polymer Chemical Engineering",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         5,
		Prerequisites: []string{"basic_chemical"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}, {ItemID: "energy_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "organic_crystal"},
		},
	},
	{
		ID:            "xray_cracking",
		Name:          "X射线裂解",
		NameEN:        "X-ray Cracking",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         5,
		Prerequisites: []string{"basic_chemical", "plasma_refining"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}, {ItemID: "energy_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "xray_cracking"},
		},
	},
	{
		ID:            "hydrogen_fuel",
		Name:          "液氢燃料棒",
		NameEN:        "Hydrogen Fuel Rod",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         5,
		Prerequisites: []string{"energy_matrix"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "hydrogen_fuel"},
		},
	},
	{
		ID:            "super_magnetic",
		Name:          "超级磁场发生器",
		NameEN:        "Super Magnetic Field Generator",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         5,
		Prerequisites: []string{"magnetic_levitation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 250}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "super_magnetic_ring"},
		},
	},
	{
		ID:            "signal_tower",
		Name:          "信号塔",
		NameEN:        "Signal Tower",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         5,
		Prerequisites: []string{"missile_turret", "plasma_control"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}, {ItemID: "energy_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "signal_tower"},
			{Type: TechUnlockBuilding, ID: "jammer_tower"},
		},
	},
	{
		ID:            "implosion_cannon",
		Name:          "聚爆加农炮",
		NameEN:        "Implosion Cannon",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         5,
		Prerequisites: []string{"missile_turret", "magnetic_levitation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 300}, {ItemID: "energy_matrix", Quantity: 300}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "implosion_cannon"},
			{Type: TechUnlockRecipe, ID: "shell_set"},
		},
	},
	{
		ID:            "precision_drone",
		Name:          "精准无人机",
		NameEN:        "Precision Drone",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         5,
		Prerequisites: []string{"prototype", "photon_conversion"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 400}, {ItemID: "energy_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "precision_drone"},
		},
	},

	// Level 6
	{
		ID:            "planetary_logistics",
		Name:          "行星物流系统",
		NameEN:        "Planetary Logistics System",
		Category:      TechCategoryMain,
		Type:          TechTypeLogistics,
		Level:         6,
		Prerequisites: []string{"efficient_logistics", "thruster", "vertical_construction"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "conveyor_mk3"},
			{Type: TechUnlockBuilding, ID: "planetary_logistics_station"},
			{Type: TechUnlockBuilding, ID: "logistics_vessel"},
		},
	},
	{
		ID:            "geothermal",
		Name:          "地热能采集",
		NameEN:        "Geothermal Extraction",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         6,
		Prerequisites: []string{"photon_conversion"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "geothermal_plant"},
		},
	},
	{
		ID:            "solar_sail_orbit",
		Name:          "太阳帆轨道系统",
		NameEN:        "Solar Sail Orbit System",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         6,
		Prerequisites: []string{"photon_conversion"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 300}, {ItemID: "energy_matrix", Quantity: 300}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "solar_sail"},
			{Type: TechUnlockBuilding, ID: "EM_rail_launcher"},
		},
	},
	{
		ID:            "highspeed_assembling",
		Name:          "高速制造工艺",
		NameEN:        "High-Speed Assembling Processes",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         6,
		Prerequisites: []string{"basic_assembling_processes", "processor"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 300}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "assembler_mk2"},
		},
	},
	{
		ID:            "high_strength_crystal",
		Name:          "高强度晶体",
		NameEN:        "High-Strength Crystal",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         6,
		Prerequisites: []string{"polymer_chemical"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "titanium_crystal"},
		},
	},
	{
		ID:            "reformed_refinement",
		Name:          "改良精炼",
		NameEN:        "Reformed Refinement",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         6,
		Prerequisites: []string{"xray_cracking"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 500}, {ItemID: "energy_matrix", Quantity: 500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "reformed_refinement"},
		},
	},
	{
		ID:            "thruster",
		Name:          "推进器",
		NameEN:        "Thruster",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         6,
		Prerequisites: []string{"hydrogen_fuel"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "thruster"},
		},
	},
	{
		ID:            "proliferator_mk2",
		Name:          "增产剂Mk.II",
		NameEN:        "Proliferator Mk.II",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         6,
		Prerequisites: []string{"processor", "proliferator_mk1"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "proliferator_mk2"},
		},
	},
	{
		ID:            "particle_container",
		Name:          "磁场粒子捕获",
		NameEN:        "Magnetic Particle Trap",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         6,
		Prerequisites: []string{"magnetic_levitation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "particle_container"},
		},
	},
	{
		ID:            "titanium_ammo",
		Name:          "钛化子弹箱",
		NameEN:        "Titanium Ammo Box",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         6,
		Prerequisites: []string{"weapon_system", "titanium_smelting"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "titanium_ammo"},
		},
	},

	// Level 7
	{
		ID:            "integrated_logistics",
		Name:          "整合物流系统",
		NameEN:        "Integrated Logistics System",
		Category:      TechCategoryBranch,
		Type:          TechTypeLogistics,
		Level:         7,
		Prerequisites: []string{"efficient_logistics"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 500}, {ItemID: "structure_matrix", Quantity: 50}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: string(BuildingTypePileSorter)},
		},
	},
	{
		ID:            "titanium_alloy",
		Name:          "高强度钛合金",
		NameEN:        "High-Strength Titanium Alloy",
		Category:      TechCategoryMain,
		Type:          TechTypeSmelting,
		Level:         7,
		Prerequisites: []string{"titanium_smelting"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 80}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "titanium_alloy"},
		},
	},
	{
		ID:            "lightweight_structure",
		Name:          "高强度轻质结构",
		NameEN:        "High-Strength Lightweight Structure",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         7,
		Prerequisites: []string{"solar_sail_orbit"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1200}, {ItemID: "structure_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "frame_material"},
			{Type: TechUnlockSpecial, ID: "dyson_component"},
		},
	},
	{
		ID:            "ray_receiver",
		Name:          "射线接收站",
		NameEN:        "Ray Receiver",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         7,
		Prerequisites: []string{"solar_sail_orbit"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "ray_receiver"},
		},
	},
	{
		ID:            "mini_fusion",
		Name:          "微型核聚变发电",
		NameEN:        "Mini Fusion Power Generation",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         7,
		Prerequisites: []string{"deuterium_fractionation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 500}, {ItemID: "structure_matrix", Quantity: 250}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "mini_fusion_plant"},
			{Type: TechUnlockRecipe, ID: "deuterium_fuel"},
		},
	},
	{
		ID:            "high_strength_material",
		Name:          "高强度材料",
		NameEN:        "High-Strength Material",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         7,
		Prerequisites: []string{"superconductor"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 600}, {ItemID: "structure_matrix", Quantity: 150}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "carbon_nanotube"},
		},
	},
	{
		ID:            "structure_matrix",
		Name:          "结构矩阵",
		NameEN:        "Structure Matrix",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         7,
		Prerequisites: []string{"high_strength_crystal", "titanium_alloy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "structure_matrix"},
		},
	},

	// Level 8
	{
		ID:            "interstellar_logistics",
		Name:          "星际物流系统",
		NameEN:        "Interstellar Logistics System",
		Category:      TechCategoryMain,
		Type:          TechTypeLogistics,
		Level:         8,
		Prerequisites: []string{"planetary_logistics", "titanium_alloy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1200}, {ItemID: "energy_matrix", Quantity: 1200}, {ItemID: "structure_matrix", Quantity: 120}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "interstellar_logistics_station"},
			{Type: TechUnlockBuilding, ID: "star_lifter"},
		},
	},
	{
		ID:            "interstellar_power",
		Name:          "星际输电",
		NameEN:        "Interstellar Power Transmission",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         8,
		Prerequisites: []string{"energy_storage", "interstellar_logistics"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1200}, {ItemID: "energy_matrix", Quantity: 1200}, {ItemID: "structure_matrix", Quantity: 120}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: string(BuildingTypeEnergyExchanger)},
		},
	},
	{
		ID:            "particle_control",
		Name:          "粒子控制",
		NameEN:        "Particle Control",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         8,
		Prerequisites: []string{"superconductor"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "particle_broadband"},
		},
	},
	{
		ID:            "high_strength_glass",
		Name:          "高强度玻璃",
		NameEN:        "High-Strength Glass",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         8,
		Prerequisites: []string{"high_strength_material"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "titanium_glass"},
		},
	},
	{
		ID:            "casimir_crystal",
		Name:          "卡西米尔晶体",
		NameEN:        "Casimir Crystal",
		Category:      TechCategoryBranch,
		Type:          TechTypeChemical,
		Level:         8,
		Prerequisites: []string{"high_strength_crystal", "particle_control"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "casimir_crystal"},
		},
	},
	{
		ID:            "miniature_collider",
		Name:          "小型粒子对撞机",
		NameEN:        "Miniature Particle Collider",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         8,
		Prerequisites: []string{"strange_matter"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 2000}, {ItemID: "structure_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "miniature_collider"},
			{Type: TechUnlockRecipe, ID: "antimatter"},
		},
	},
	{
		ID:            "proliferator_mk3",
		Name:          "增产剂Mk.III",
		NameEN:        "Proliferator Mk.III",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         8,
		Prerequisites: []string{"high_strength_material", "proliferator_mk2"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 1200}, {ItemID: "structure_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "proliferator_mk3"},
		},
	},
	{
		ID:            "satellite_power",
		Name:          "卫星配电系统",
		NameEN:        "Satellite Power Distribution System",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         8,
		Prerequisites: []string{"ray_receiver"},
		Cost:          []ItemAmount{{ItemID: "structure_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "satellite_power"},
			{Type: TechUnlockBuilding, ID: string(BuildingTypeSatelliteSubstation)},
		},
	},
	{
		ID:            "supersonic_missile",
		Name:          "超音速导弹组",
		NameEN:        "Supersonic Missile Set",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         8,
		Prerequisites: []string{"missile_turret", "titanium_alloy"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}, {ItemID: "structure_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "supersonic_missile"},
		},
	},
	{
		ID:            "vertical_construction",
		Name:          "垂直建造",
		NameEN:        "Vertical Construction",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         8,
		Prerequisites: []string{"basic_logistics_system"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "vertical_construction"},
		},
		MaxLevel: 6,
	},

	// Level 9-10
	{
		ID:            "gas_giants",
		Name:          "气态行星采集",
		NameEN:        "Gas Giants Exploitation",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         9,
		Prerequisites: []string{"interstellar_logistics", "interstellar_power"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1200}, {ItemID: "energy_matrix", Quantity: 1200}, {ItemID: "structure_matrix", Quantity: 1200}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "orbital_collector"},
		},
	},
	{
		ID:            "information_matrix",
		Name:          "信息矩阵",
		NameEN:        "Information Matrix",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         9,
		Prerequisites: []string{"processor", "particle_control"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "information_matrix"},
		},
	},
	{
		ID:            "wave_interference",
		Name:          "波函数干涉",
		NameEN:        "Wave Function Interference",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         9,
		Prerequisites: []string{"quantum_chip"},
		Cost:          []ItemAmount{{ItemID: "information_matrix", Quantity: 100}, {ItemID: "structure_matrix", Quantity: 50}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "plane_filter"},
		},
	},
	{
		ID:            "crystal_explosive",
		Name:          "爆裂单元",
		NameEN:        "Crystal Explosive Unit",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         9,
		Prerequisites: []string{"high_strength_glass", "information_matrix"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 800}, {ItemID: "information_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "crystal_explosive"},
		},
	},
	{
		ID:            "strange_matter",
		Name:          "奇异物质",
		NameEN:        "Strange Matter",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         9,
		Prerequisites: []string{"miniature_collider"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 1000}, {ItemID: "structure_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "strange_matter"},
			{Type: TechUnlockRecipe, ID: "gravitational_lens"},
		},
	},
	{
		ID:            "crystal_shell",
		Name:          "晶体炮弹组",
		NameEN:        "Crystal Shell Set",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         9,
		Prerequisites: []string{"implosion_cannon", "crystal_explosive"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 800}, {ItemID: "information_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "crystal_shell"},
		},
	},
	{
		ID:            "plasma_turret",
		Name:          "磁化电浆炮",
		NameEN:        "Plasma Turret",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         9,
		Prerequisites: []string{"signal_tower", "information_matrix"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 1000}, {ItemID: "structure_matrix", Quantity: 1000}, {ItemID: "information_matrix", Quantity: 500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "plasma_turret"},
			{Type: TechUnlockBuilding, ID: "sr_plasma_turret"},
		},
	},
	{
		ID:            "corvette",
		Name:          "护卫舰",
		NameEN:        "Corvette",
		Category:      TechCategoryMain,
		Type:          TechTypeCombat,
		Level:         9,
		Prerequisites: []string{"precision_drone", "information_matrix"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}, {ItemID: "structure_matrix", Quantity: 600}, {ItemID: "information_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "corvette"},
		},
	},
	{
		ID:            "vertical_launching",
		Name:          "垂直发射井",
		NameEN:        "Vertical Launching Silo",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         9,
		Prerequisites: []string{"lightweight_structure", "quantum_chip"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 500}, {ItemID: "information_matrix", Quantity: 500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "vertical_launching_silo"},
			{Type: TechUnlockRecipe, ID: "small_carrier_rocket"},
		},
	},
	{
		ID:            "quantum_chip",
		Name:          "量子芯片",
		NameEN:        "Quantum Chip",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         10,
		Prerequisites: []string{"information_matrix"},
		Cost:          []ItemAmount{{ItemID: "information_matrix", Quantity: 200}, {ItemID: "structure_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "quantum_chip"},
		},
	},
	{
		ID:            "plane_filter_smelting",
		Name:          "位面冶炼",
		NameEN:        "Plane-Filter Smelting",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         10,
		Prerequisites: []string{"crystal_smelting", "quantum_chip"},
		Cost:          []ItemAmount{{ItemID: "information_matrix", Quantity: 200}, {ItemID: "structure_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "plane_filter"},
		},
	},
	{
		ID:            "gravitational_wave",
		Name:          "引力波折射",
		NameEN:        "Gravitational Wave Refraction",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         10,
		Prerequisites: []string{"strange_matter", "mesoscopic_entanglement"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 2000}, {ItemID: "energy_matrix", Quantity: 2000}, {ItemID: "structure_matrix", Quantity: 2000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "space_warper"},
			{Type: TechUnlockSpecial, ID: "warp_drive"},
		},
	},
	{
		ID:            "mesoscopic_entanglement",
		Name:          "中观量子纠缠",
		NameEN:        "Mesoscopic Quantum Entanglement",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         10,
		Prerequisites: []string{"strange_matter"},
		Cost:          []ItemAmount{{ItemID: "information_matrix", Quantity: 100}, {ItemID: "structure_matrix", Quantity: 50}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "quantum_chemical_plant"},
		},
	},
	{
		ID:            "quantum_printing",
		Name:          "量子打印工艺",
		NameEN:        "Quantum Printing Technology",
		Category:      TechCategoryBranch,
		Type:          TechTypeSmelting,
		Level:         10,
		Prerequisites: []string{"quantum_chip"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 800}, {ItemID: "information_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "assembler_mk3"},
		},
	},
	{
		ID:            "high_energy_laser",
		Name:          "高能激光塔",
		NameEN:        "High-Energy Laser Tower",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         10,
		Prerequisites: []string{"signal_tower", "high_strength_glass"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}, {ItemID: "structure_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "high_energy_laser"},
		},
	},

	// Level 11-16
	{
		ID:            "gravity_matrix",
		Name:          "引力矩阵",
		NameEN:        "Gravity Matrix",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         11,
		Prerequisites: []string{"gravitational_wave", "quantum_chip"},
		Cost:          []ItemAmount{{ItemID: "information_matrix", Quantity: 500}, {ItemID: "structure_matrix", Quantity: 500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "gravity_matrix"},
		},
	},
	{
		ID:            "planetary_shield",
		Name:          "行星护盾",
		NameEN:        "Planetary Shield",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         11,
		Prerequisites: []string{"plasma_turret", "interstellar_power", "energy_shield"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 800}, {ItemID: "information_matrix", Quantity: 400}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: string(BuildingTypePlanetaryShieldGenerator)},
		},
	},
	{
		ID:            "self_evolution",
		Name:          "自演化研究站",
		NameEN:        "Self-Evolution Lab",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         11,
		Prerequisites: []string{"gravity_matrix", "quantum_chip", "research_speed"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 600}, {ItemID: "energy_matrix", Quantity: 600}, {ItemID: "structure_matrix", Quantity: 600}, {ItemID: "information_matrix", Quantity: 600}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: string(BuildingTypeSelfEvolutionLab)},
		},
	},
	{
		ID:            "photon_mining",
		Name:          "光子聚焦采矿",
		NameEN:        "Photon Spotlight Mining",
		Category:      TechCategoryBranch,
		Type:          TechTypeMain,
		Level:         11,
		Prerequisites: []string{"quantum_printing"},
		Cost:          []ItemAmount{{ItemID: "information_matrix", Quantity: 200}, {ItemID: "gravity_matrix", Quantity: 100}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: string(BuildingTypeAdvancedMiningMachine)},
		},
	},
	{
		ID:            "dyson_stress",
		Name:          "戴森球应力系统",
		NameEN:        "Dyson Sphere Stress System",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         11,
		Prerequisites: []string{"vertical_launching"},
		Cost:          []ItemAmount{{ItemID: "gravity_matrix", Quantity: 500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "dyson_stress"},
		},
		MaxLevel: 6,
	},
	{
		ID:            "ionosphere",
		Name:          "行星电离层利用",
		NameEN:        "Planetary Ionosphere Utilization",
		Category:      TechCategoryBranch,
		Type:          TechTypeEnergy,
		Level:         11,
		Prerequisites: []string{"ray_receiver", "gravitational_wave", "dirac_inversion"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 2000}, {ItemID: "energy_matrix", Quantity: 2000}, {ItemID: "structure_matrix", Quantity: 2000}, {ItemID: "gravity_matrix", Quantity: 2000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "ionosphere_utilization"},
		},
	},
	{
		ID:            "mass_energy_storage",
		Name:          "质能储存",
		NameEN:        "Mass-Energy Storage",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         11,
		Prerequisites: []string{"dyson_stress", "gravity_matrix"},
		Cost:          []ItemAmount{{ItemID: "gravity_matrix", Quantity: 500}, {ItemID: "information_matrix", Quantity: 300}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "antimatter_capsule"},
		},
	},
	{
		ID:            "gravity_missile",
		Name:          "引力导弹组",
		NameEN:        "Gravity Missile Set",
		Category:      TechCategoryBranch,
		Type:          TechTypeCombat,
		Level:         11,
		Prerequisites: []string{"strange_matter", "gravity_matrix"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 1000}, {ItemID: "structure_matrix", Quantity: 1000}, {ItemID: "information_matrix", Quantity: 1000}, {ItemID: "gravity_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "gravity_missile"},
		},
	},
	{
		ID:            "destroyer",
		Name:          "驱逐舰",
		NameEN:        "Destroyer",
		Category:      TechCategoryMain,
		Type:          TechTypeCombat,
		Level:         11,
		Prerequisites: []string{"corvette", "gravity_matrix"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 800}, {ItemID: "energy_matrix", Quantity: 800}, {ItemID: "structure_matrix", Quantity: 800}, {ItemID: "information_matrix", Quantity: 800}, {ItemID: "gravity_matrix", Quantity: 800}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockRecipe, ID: "destroyer"},
		},
	},
	{
		ID:            "dirac_inversion",
		Name:          "狄拉克逆变机制",
		NameEN:        "Dirac Inversion Mechanism",
		Category:      TechCategoryMain,
		Type:          TechTypeDyson,
		Level:         12,
		Prerequisites: []string{"mass_energy_storage", "ionosphere"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 3000}, {ItemID: "energy_matrix", Quantity: 3000}, {ItemID: "structure_matrix", Quantity: 750}, {ItemID: "information_matrix", Quantity: 750}, {ItemID: "gravity_matrix", Quantity: 1500}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "photon_mode"},
			{Type: TechUnlockRecipe, ID: "antimatter"},
		},
	},
	{
		ID:            "annihilation",
		Name:          "可控湮灭反应",
		NameEN:        "Controlled Annihilation Reaction",
		Category:      TechCategoryMain,
		Type:          TechTypeEnergy,
		Level:         13,
		Prerequisites: []string{"dirac_inversion"},
		Cost:          []ItemAmount{{ItemID: "energy_matrix", Quantity: 4000}, {ItemID: "gravity_matrix", Quantity: 2000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: string(BuildingTypeRecomposingAssembler)},
			{Type: TechUnlockRecipe, ID: "annihilation_constraint_sphere"},
			{Type: TechUnlockRecipe, ID: "antimatter_fuel_rod"},
			{Type: TechUnlockBuilding, ID: "artificial_star"},
		},
	},
	{
		ID:            "artificial_star",
		Name:          "人造恒星",
		NameEN:        "Artificial Star",
		Category:      TechCategoryMain,
		Type:          TechTypeEnergy,
		Level:         14,
		Prerequisites: []string{"annihilation"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 1000}, {ItemID: "structure_matrix", Quantity: 1000}, {ItemID: "information_matrix", Quantity: 1000}, {ItemID: "gravity_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "artificial_star"},
		},
	},
	{
		ID:            "universe_matrix",
		Name:          "宇宙矩阵",
		NameEN:        "Universe Matrix",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         15,
		Prerequisites: []string{"annihilation", "dyson_sphere_partial"},
		Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 1000}, {ItemID: "energy_matrix", Quantity: 1000}, {ItemID: "structure_matrix", Quantity: 1000}, {ItemID: "information_matrix", Quantity: 1000}, {ItemID: "gravity_matrix", Quantity: 1000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "universe_matrix"},
		},
	},
	{
		ID:            "mission_complete",
		Name:          "任务完成",
		NameEN:        "Mission Completed",
		Category:      TechCategoryMain,
		Type:          TechTypeMain,
		Level:         16,
		Prerequisites: []string{"universe_matrix"},
		Cost:          []ItemAmount{{ItemID: "universe_matrix", Quantity: 4000}},
		Unlocks: []TechUnlock{
			{Type: TechUnlockSpecial, ID: "game_win"},
		},
	},

	// Mecha upgrades (special category)
	{
		ID:       "universe_exploration",
		Name:     "宇宙探索",
		NameEN:   "Universe Exploration",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		MaxLevel: 4,
		Effects:  []TechEffect{{Type: "exploration_range", Value: 1}},
	},
	{
		ID:       "mecha_core",
		Name:     "机甲核心",
		NameEN:   "Mecha Core",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 100}},
		MaxLevel: 6,
		Effects:  []TechEffect{{Type: "core_capacity", Value: 10}},
	},
	{
		ID:       "mecha_engine",
		Name:     "驱动引擎",
		NameEN:   "Drive Engine",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		MaxLevel: 100,
		Effects:  []TechEffect{{Type: "move_speed", Value: 2}},
	},
	{
		ID:       "drone_engine",
		Name:     "无人机引擎",
		NameEN:   "Drone Engine",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 150}},
		MaxLevel: 24,
		Effects:  []TechEffect{{Type: "drone_speed", Value: 3}},
	},
	{
		ID:       "energy_shield",
		Name:     "能量护盾",
		NameEN:   "Energy Shield",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "energy_matrix", Quantity: 100}},
		MaxLevel: 6,
		Effects:  []TechEffect{{Type: "shield_capacity", Value: 20}},
	},
	{
		ID:       "research_speed",
		Name:     "研究速度",
		NameEN:   "Research Speed",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 200}},
		Effects:  []TechEffect{{Type: "research_speed", Value: 0.1}},
	},
	{
		ID:       "solar_sail_life",
		Name:     "太阳帆寿命",
		NameEN:   "Solar Sail Life",
		Category: TechCategoryBonus,
		Type:     TechTypeMecha,
		Level:    1,
		Cost:     []ItemAmount{{ItemID: "structure_matrix", Quantity: 50}},
		MaxLevel: 6,
		Effects:  []TechEffect{{Type: "solar_sail_life", Value: 300}},
	},

	// Hidden tech (Dark Fog)
	{
		ID:       "dark_fog_matrix",
		Name:     "数字模拟计算",
		NameEN:   "Digital Analog Computation",
		Category: TechCategoryMain,
		Type:     TechTypeCombat,
		Level:    10,
		Cost:     []ItemAmount{{ItemID: "dark_fog_matrix", Quantity: 100}},
		Hidden:   true,
		Unlocks: []TechUnlock{
			{Type: TechUnlockBuilding, ID: "self_evolution_station"},
		},
	},
}

func normalizeTechDefinitions(defs []TechDefinition) []TechDefinition {
	out := make([]TechDefinition, len(defs))
	for i := range defs {
		out[i] = defs[i]
		out[i].Unlocks = normalizeTechUnlocks(defs[i].Unlocks)
		switch out[i].ID {
		case "plane_filter_smelting":
			out[i].Unlocks = appendUniqueUnlock(out[i].Unlocks, TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypePlaneSmelter)})
		case "quantum_printing":
			out[i].Unlocks = appendUniqueUnlock(out[i].Unlocks, TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeNegentropySmelter)})
		}
	}
	return out
}

func normalizeTechUnlocks(unlocks []TechUnlock) []TechUnlock {
	if len(unlocks) == 0 {
		return nil
	}

	buildingIDs := make(map[string]struct{}, len(defaultBuildingDefinitions))
	for _, def := range defaultBuildingDefinitions {
		buildingIDs[string(def.ID)] = struct{}{}
	}
	recipeIDs := make(map[string]struct{}, len(recipeCatalog))
	for id := range recipeCatalog {
		recipeIDs[id] = struct{}{}
	}
	unitIDs := runtimeSupportedUnitUnlocks()

	out := make([]TechUnlock, 0, len(unlocks))
	for _, unlock := range unlocks {
		for _, normalized := range expandTechUnlock(unlock) {
			switch normalized.Type {
			case TechUnlockBuilding:
				if _, ok := buildingIDs[normalized.ID]; !ok {
					continue
				}
			case TechUnlockRecipe:
				if _, ok := recipeIDs[normalized.ID]; !ok {
					continue
				}
			case TechUnlockUnit:
				if _, ok := unitIDs[normalized.ID]; !ok {
					continue
				}
			}
			out = appendUniqueUnlock(out, normalized)
		}
	}
	return out
}

func runtimeSupportedUnitUnlocks() map[string]struct{} {
	return map[string]struct{}{
		"logistics_drone": {},
		"logistics_ship":  {},
	}
}

func appendUniqueUnlock(unlocks []TechUnlock, unlock TechUnlock) []TechUnlock {
	for _, existing := range unlocks {
		if existing.Type == unlock.Type && existing.ID == unlock.ID && existing.Level == unlock.Level {
			return unlocks
		}
	}
	return append(unlocks, unlock)
}

func expandTechUnlock(unlock TechUnlock) []TechUnlock {
	if aliases, ok := techUnlockAliases[unlock.Type][unlock.ID]; ok {
		return aliases
	}
	return []TechUnlock{unlock}
}

var techUnlockAliases = map[TechUnlockType]map[string][]TechUnlock{
	TechUnlockBuilding: {
		"EM_rail":                {{Type: TechUnlockBuilding, ID: string(BuildingTypeEMRailEjector)}},
		"EM_rail_launcher":       {{Type: TechUnlockBuilding, ID: string(BuildingTypeEMRailEjector)}},
		"annihilation_reactor":   {{Type: TechUnlockBuilding, ID: string(BuildingTypeArtificialStar)}},
		"assembler_mk1":          {{Type: TechUnlockBuilding, ID: string(BuildingTypeAssemblingMachineMk1)}},
		"assembler_mk2":          {{Type: TechUnlockBuilding, ID: string(BuildingTypeAssemblingMachineMk2)}},
		"assembler_mk3":          {{Type: TechUnlockBuilding, ID: string(BuildingTypeAssemblingMachineMk3)}},
		"auto_stacker":           {{Type: TechUnlockBuilding, ID: string(BuildingTypeAutomaticPiler)}},
		"conveyor_mk1":           {{Type: TechUnlockBuilding, ID: string(BuildingTypeConveyorBeltMk1)}},
		"conveyor_mk2":           {{Type: TechUnlockBuilding, ID: string(BuildingTypeConveyorBeltMk2)}},
		"conveyor_mk3":           {{Type: TechUnlockBuilding, ID: string(BuildingTypeConveyorBeltMk3)}},
		"electric_motor":         {{Type: TechUnlockRecipe, ID: "motor"}},
		"energy_pylon":           {{Type: TechUnlockBuilding, ID: string(BuildingTypeSatelliteSubstation)}},
		"flow_monitor":           {{Type: TechUnlockBuilding, ID: string(BuildingTypeTrafficMonitor)}},
		"fluid_tank":             {{Type: TechUnlockBuilding, ID: string(BuildingTypeStorageTank)}},
		"geothermal_plant":       {{Type: TechUnlockBuilding, ID: string(BuildingTypeGeothermalPowerStation)}},
		"high_energy_laser":      {{Type: TechUnlockBuilding, ID: string(BuildingTypeLaserTurret)}},
		"logistics_bot":          {{Type: TechUnlockUnit, ID: "logistics_drone"}},
		"logistics_vessel":       {{Type: TechUnlockUnit, ID: "logistics_ship"}},
		"mini_fusion_plant":      {{Type: TechUnlockBuilding, ID: string(BuildingTypeMiniFusionPowerPlant)}},
		"miniature_collider":     {{Type: TechUnlockBuilding, ID: string(BuildingTypeMiniatureParticleCollider)}},
		"photon_combiner":        {{Type: TechUnlockRecipe, ID: "photon_combiner_from_grating"}},
		"plasma_exciter":         {{Type: TechUnlockSpecial, ID: "plasma_exciter"}},
		"power_pylon":            {{Type: TechUnlockBuilding, ID: string(BuildingTypeTeslaTower)}},
		"prism":                  {{Type: TechUnlockSpecial, ID: "prism"}},
		"pump":                   {{Type: TechUnlockBuilding, ID: string(BuildingTypeWaterPump)}},
		"refinery":               {{Type: TechUnlockBuilding, ID: string(BuildingTypeOilRefinery)}},
		"self_evolution_station": {{Type: TechUnlockBuilding, ID: string(BuildingTypeSelfEvolutionLab)}},
		"solar_sail":             {{Type: TechUnlockRecipe, ID: "solar_sail"}},
		"stacker":                {{Type: TechUnlockBuilding, ID: string(BuildingTypeAutomaticPiler)}},
		"star_lifter":            {{Type: TechUnlockUnit, ID: "logistics_ship"}},
		"storage_mk1":            {{Type: TechUnlockBuilding, ID: string(BuildingTypeDepotMk1)}},
		"storage_mk2":            {{Type: TechUnlockBuilding, ID: string(BuildingTypeDepotMk2)}},
		"wireless_pylon":         {{Type: TechUnlockBuilding, ID: string(BuildingTypeWirelessPowerTower)}},
	},
	TechUnlockRecipe: {
		"antimatter_fuel":     {{Type: TechUnlockRecipe, ID: "antimatter_fuel_rod"}},
		"deuterium_fuel":      {{Type: TechUnlockRecipe, ID: "deuterium_fuel_rod"}},
		"glass":               {{Type: TechUnlockRecipe, ID: "smelt_stone"}},
		"graphene":            {{Type: TechUnlockRecipe, ID: "graphene_from_graphite"}, {Type: TechUnlockRecipe, ID: "graphene_from_fire_ice"}},
		"graphite":            {{Type: TechUnlockRecipe, ID: "coal_to_graphite"}},
		"high_purity_silicon": {{Type: TechUnlockRecipe, ID: "smelt_silicon"}},
		"hydrogen_fuel":       {{Type: TechUnlockRecipe, ID: "hydrogen_fuel_rod"}},
		"microcrystalline":    {{Type: TechUnlockRecipe, ID: "microcrystalline_component"}},
		"missile":             {{Type: TechUnlockRecipe, ID: "ammo_missile"}},
		"particle_container":  {{Type: TechUnlockRecipe, ID: "particle_container_from_monopole"}},
		"refined_oil":         {{Type: TechUnlockRecipe, ID: "oil_fractionation"}},
		"silicon_ore":         {{Type: TechUnlockRecipe, ID: "smelt_silicon"}},
		"titanium":            {{Type: TechUnlockRecipe, ID: "smelt_titanium"}},
	},
}
