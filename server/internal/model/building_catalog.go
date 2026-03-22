package model

import (
	"fmt"
	"os"
	"sort"
	"sync"

	"gopkg.in/yaml.v3"
)

// BuildingCategory defines the primary classification for a building.
type BuildingCategory string

const (
	BuildingCategoryCollect       BuildingCategory = "collect"
	BuildingCategoryTransport     BuildingCategory = "transport"
	BuildingCategoryStorage       BuildingCategory = "storage"
	BuildingCategoryProduction    BuildingCategory = "production"
	BuildingCategoryChemical      BuildingCategory = "chemical"
	BuildingCategoryRefining      BuildingCategory = "refining"
	BuildingCategoryPower         BuildingCategory = "power"
	BuildingCategoryPowerGrid     BuildingCategory = "power_grid"
	BuildingCategoryResearch      BuildingCategory = "research"
	BuildingCategoryLogisticsHub  BuildingCategory = "logistics_hub"
	BuildingCategoryDyson         BuildingCategory = "dyson"
	BuildingCategoryCommandSignal BuildingCategory = "command_signal"
)

var validBuildingCategories = map[BuildingCategory]struct{}{
	BuildingCategoryCollect:       {},
	BuildingCategoryTransport:     {},
	BuildingCategoryStorage:       {},
	BuildingCategoryProduction:    {},
	BuildingCategoryChemical:      {},
	BuildingCategoryRefining:      {},
	BuildingCategoryPower:         {},
	BuildingCategoryPowerGrid:     {},
	BuildingCategoryResearch:      {},
	BuildingCategoryLogisticsHub:  {},
	BuildingCategoryDyson:         {},
	BuildingCategoryCommandSignal: {},
}

// BuildingSubcategory defines the secondary classification for a building.
type BuildingSubcategory string

const (
	BuildingSubcategoryCollect       BuildingSubcategory = "collect"
	BuildingSubcategoryTransport     BuildingSubcategory = "transport"
	BuildingSubcategoryStorage       BuildingSubcategory = "storage"
	BuildingSubcategoryProduction    BuildingSubcategory = "production"
	BuildingSubcategoryChemical      BuildingSubcategory = "chemical"
	BuildingSubcategoryRefining      BuildingSubcategory = "refining"
	BuildingSubcategoryPower         BuildingSubcategory = "power"
	BuildingSubcategoryPowerGrid     BuildingSubcategory = "power_grid"
	BuildingSubcategoryResearch      BuildingSubcategory = "research"
	BuildingSubcategoryLogisticsHub  BuildingSubcategory = "logistics_hub"
	BuildingSubcategoryDyson         BuildingSubcategory = "dyson"
	BuildingSubcategoryCommandSignal BuildingSubcategory = "command_signal"
)

var validBuildingSubcategories = map[BuildingSubcategory]struct{}{
	BuildingSubcategoryCollect:       {},
	BuildingSubcategoryTransport:     {},
	BuildingSubcategoryStorage:       {},
	BuildingSubcategoryProduction:    {},
	BuildingSubcategoryChemical:      {},
	BuildingSubcategoryRefining:      {},
	BuildingSubcategoryPower:         {},
	BuildingSubcategoryPowerGrid:     {},
	BuildingSubcategoryResearch:      {},
	BuildingSubcategoryLogisticsHub:  {},
	BuildingSubcategoryDyson:         {},
	BuildingSubcategoryCommandSignal: {},
}

// Footprint describes how many tiles a building occupies.
type Footprint struct {
	Width  int `json:"width" yaml:"width"`
	Height int `json:"height" yaml:"height"`
}

// BuildCost describes the construction cost of a building.
type BuildCost struct {
	Minerals int          `json:"minerals" yaml:"minerals"`
	Energy   int          `json:"energy" yaml:"energy"`
	Items    []ItemAmount `json:"items,omitempty" yaml:"items,omitempty"`
}

// BuildingDefinition defines immutable data for a building type.
type BuildingDefinition struct {
	ID                   BuildingType         `json:"id" yaml:"id"`
	Name                 string               `json:"name" yaml:"name"`
	Category             BuildingCategory     `json:"category" yaml:"category"`
	Subcategory          BuildingSubcategory  `json:"subcategory" yaml:"subcategory"`
	Footprint            Footprint            `json:"footprint" yaml:"footprint"`
	BuildCost            BuildCost            `json:"build_cost" yaml:"build_cost"`
	Upgrade              BuildingUpgradeRule  `json:"upgrade,omitempty" yaml:"upgrade,omitempty"`
	Demolish             BuildingDemolishRule `json:"demolish,omitempty" yaml:"demolish,omitempty"`
	UnlockTech           []string             `json:"unlock_tech,omitempty" yaml:"unlock_tech,omitempty"`
	Buildable            bool                 `json:"buildable" yaml:"buildable"`
	RequiresResourceNode bool                 `json:"requires_resource_node,omitempty" yaml:"requires_resource_node,omitempty"`
	CanProduceUnits      bool                 `json:"can_produce_units,omitempty" yaml:"can_produce_units,omitempty"`
}

var (
	buildingCatalogMu sync.RWMutex
	buildingCatalog   map[BuildingType]BuildingDefinition
)

func init() {
	catalog, err := buildBuildingCatalog(defaultBuildingDefinitions)
	if err != nil {
		panic(err)
	}
	buildingCatalog = catalog
}

// BuildingDefinitionByID returns the definition for a building id.
func BuildingDefinitionByID(id BuildingType) (BuildingDefinition, bool) {
	buildingCatalogMu.RLock()
	defer buildingCatalogMu.RUnlock()
	def, ok := buildingCatalog[id]
	return def, ok
}

// AllBuildingDefinitions returns a copy of building definitions.
func AllBuildingDefinitions() []BuildingDefinition {
	buildingCatalogMu.RLock()
	defer buildingCatalogMu.RUnlock()
	defs := make([]BuildingDefinition, 0, len(buildingCatalog))
	for _, def := range buildingCatalog {
		defs = append(defs, def)
	}
	sort.Slice(defs, func(i, j int) bool {
		return defs[i].ID < defs[j].ID
	})
	return defs
}

// RegisterBuildingDefinitions adds new building definitions without overwriting existing ones.
func RegisterBuildingDefinitions(defs ...BuildingDefinition) error {
	buildingCatalogMu.Lock()
	defer buildingCatalogMu.Unlock()
	for _, def := range defs {
		if err := validateBuildingDefinition(def); err != nil {
			return err
		}
		if _, exists := buildingCatalog[def.ID]; exists {
			return fmt.Errorf("building %s already exists", def.ID)
		}
		buildingCatalog[def.ID] = def
	}
	return nil
}

// ReplaceBuildingCatalog overwrites the current catalog with the provided definitions.
func ReplaceBuildingCatalog(defs []BuildingDefinition) error {
	catalog, err := buildBuildingCatalog(defs)
	if err != nil {
		return err
	}
	buildingCatalogMu.Lock()
	buildingCatalog = catalog
	buildingCatalogMu.Unlock()
	return nil
}

// LoadBuildingCatalogFromFile loads a building catalog from a YAML or JSON file.
func LoadBuildingCatalogFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read building catalog: %w", err)
	}

	var wrapper struct {
		Buildings []BuildingDefinition `yaml:"buildings"`
	}
	if err := yaml.Unmarshal(data, &wrapper); err == nil && len(wrapper.Buildings) > 0 {
		return ReplaceBuildingCatalog(wrapper.Buildings)
	}

	var defs []BuildingDefinition
	if err := yaml.Unmarshal(data, &defs); err != nil {
		return fmt.Errorf("parse building catalog: %w", err)
	}
	if len(defs) == 0 {
		return fmt.Errorf("building catalog %s has no entries", path)
	}
	return ReplaceBuildingCatalog(defs)
}

func buildBuildingCatalog(defs []BuildingDefinition) (map[BuildingType]BuildingDefinition, error) {
	if len(defs) == 0 {
		return nil, fmt.Errorf("building catalog definitions empty")
	}
	catalog := make(map[BuildingType]BuildingDefinition, len(defs))
	for _, def := range defs {
		def = normalizeBuildableCost(def)
		if err := validateBuildingDefinition(def); err != nil {
			return nil, err
		}
		if _, exists := catalog[def.ID]; exists {
			return nil, fmt.Errorf("duplicate building id: %s", def.ID)
		}
		catalog[def.ID] = def
	}
	return catalog, nil
}

func normalizeBuildableCost(def BuildingDefinition) BuildingDefinition {
	if !def.Buildable {
		return def
	}
	if def.BuildCost.Minerals > 0 || def.BuildCost.Energy > 0 || len(def.BuildCost.Items) > 0 {
		return def
	}
	if override, ok := defaultBuildCostOverrides[def.ID]; ok {
		def.BuildCost = override
		return def
	}
	def.BuildCost = defaultBuildCostForCategory(def.Category)
	return def
}

func defaultBuildCostForCategory(category BuildingCategory) BuildCost {
	switch category {
	case BuildingCategoryCollect:
		return BuildCost{Minerals: 80, Energy: 30}
	case BuildingCategoryTransport:
		return BuildCost{Minerals: 20, Energy: 10}
	case BuildingCategoryStorage:
		return BuildCost{Minerals: 60, Energy: 20}
	case BuildingCategoryProduction:
		return BuildCost{Minerals: 120, Energy: 60}
	case BuildingCategoryChemical, BuildingCategoryRefining:
		return BuildCost{Minerals: 140, Energy: 70}
	case BuildingCategoryPower:
		return BuildCost{Minerals: 90, Energy: 30}
	case BuildingCategoryPowerGrid:
		return BuildCost{Minerals: 40, Energy: 20}
	case BuildingCategoryResearch:
		return BuildCost{Minerals: 120, Energy: 60}
	case BuildingCategoryLogisticsHub:
		return BuildCost{Minerals: 180, Energy: 80}
	case BuildingCategoryDyson:
		return BuildCost{Minerals: 260, Energy: 130}
	case BuildingCategoryCommandSignal:
		return BuildCost{Minerals: 100, Energy: 40}
	default:
		return BuildCost{Minerals: 50, Energy: 20}
	}
}

var defaultBuildCostOverrides = map[BuildingType]BuildCost{
	BuildingTypeBattlefieldAnalysisBase:      {Minerals: 120, Energy: 60},
	BuildingTypeConveyorBeltMk1:              {Minerals: 4, Energy: 0},
	BuildingTypeConveyorBeltMk2:              {Minerals: 8, Energy: 0},
	BuildingTypeConveyorBeltMk3:              {Minerals: 12, Energy: 0},
	BuildingTypeSorterMk1:                    {Minerals: 6, Energy: 0},
	BuildingTypeSorterMk2:                    {Minerals: 10, Energy: 0},
	BuildingTypeSorterMk3:                    {Minerals: 14, Energy: 0},
	BuildingTypeTeslaTower:                   {Minerals: 20, Energy: 10},
	BuildingTypeWirelessPowerTower:           {Minerals: 40, Energy: 20},
	BuildingTypeSatelliteSubstation:          {Minerals: 80, Energy: 40},
	BuildingTypeWindTurbine:                  {Minerals: 30, Energy: 0},
	BuildingTypeFoundation:                   {Minerals: 10, Energy: 0},
	BuildingTypeSignalTower:                  {Minerals: 50, Energy: 20},
	BuildingTypeSprayCoater:                  {Minerals: 40, Energy: 20},
	BuildingTypeLogisticsDistributor:         {Minerals: 30, Energy: 10},
	BuildingTypePlanetaryLogisticsStation:    {Minerals: 240, Energy: 120},
	BuildingTypeInterstellarLogisticsStation: {Minerals: 360, Energy: 180},
}

func validateBuildingDefinition(def BuildingDefinition) error {
	if def.ID == "" {
		return fmt.Errorf("building id required")
	}
	if def.Name == "" {
		return fmt.Errorf("building %s missing name", def.ID)
	}
	if _, ok := validBuildingCategories[def.Category]; !ok {
		return fmt.Errorf("building %s has invalid category %q", def.ID, def.Category)
	}
	if _, ok := validBuildingSubcategories[def.Subcategory]; !ok {
		return fmt.Errorf("building %s has invalid subcategory %q", def.ID, def.Subcategory)
	}
	if def.Footprint.Width <= 0 || def.Footprint.Height <= 0 {
		return fmt.Errorf("building %s has invalid footprint", def.ID)
	}
	if def.BuildCost.Minerals < 0 || def.BuildCost.Energy < 0 {
		return fmt.Errorf("building %s has negative build cost", def.ID)
	}
	for _, item := range def.BuildCost.Items {
		if item.ItemID == "" || item.Quantity <= 0 {
			return fmt.Errorf("building %s has invalid item cost", def.ID)
		}
	}
	if err := validateBuildingUpgradeRule(def); err != nil {
		return err
	}
	if err := validateBuildingDemolishRule(def); err != nil {
		return err
	}
	return nil
}

func validateBuildingUpgradeRule(def BuildingDefinition) error {
	rule := def.Upgrade
	if isZeroUpgradeRule(rule) {
		return nil
	}
	if rule.MaxLevel < 0 {
		return fmt.Errorf("building %s has invalid upgrade max level", def.ID)
	}
	if rule.Allow && rule.MaxLevel == 0 {
		return fmt.Errorf("building %s upgrade max level required when upgrade allowed", def.ID)
	}
	if rule.CostMultiplier < 0 {
		return fmt.Errorf("building %s has negative upgrade cost multiplier", def.ID)
	}
	if rule.DurationTicks < 0 {
		return fmt.Errorf("building %s has negative upgrade duration", def.ID)
	}
	return nil
}

func validateBuildingDemolishRule(def BuildingDefinition) error {
	rule := def.Demolish
	if isZeroDemolishRule(rule) {
		return nil
	}
	if rule.RefundRate < 0 || rule.RefundRate > 1.0 {
		return fmt.Errorf("building %s has invalid demolish refund rate", def.ID)
	}
	if rule.DurationTicks < 0 {
		return fmt.Errorf("building %s has negative demolish duration", def.ID)
	}
	return nil
}
