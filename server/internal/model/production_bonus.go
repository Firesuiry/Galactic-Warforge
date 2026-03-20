package model

import (
	"fmt"
	"math"
	"sort"
	"sync"
)

// BonusMode describes the production bonus application mode.
type BonusMode string

const (
	BonusModeNone  BonusMode = "none"
	BonusModeSpeed BonusMode = "speed"
	BonusModeExtra BonusMode = "extra"
)

// BonusStackRule defines how multiple bonus sources are combined.
type BonusStackRule string

const (
	BonusStackHighest BonusStackRule = "highest"
	BonusStackNone    BonusStackRule = "none"
)

// BonusFailureReason explains why a bonus or spray action failed.
type BonusFailureReason string

const (
	BonusFailureNone              BonusFailureReason = ""
	BonusFailureNoSpray           BonusFailureReason = "no_spray"
	BonusFailureInvalidSpray      BonusFailureReason = "invalid_spray"
	BonusFailureInsufficientSpray BonusFailureReason = "insufficient_spray"
	BonusFailureNotApplicable     BonusFailureReason = "not_applicable"
	BonusFailureStackingBlocked   BonusFailureReason = "stacking_blocked"
	BonusFailureLowerLevel        BonusFailureReason = "lower_level"
)

// SprayState captures the spray bonus state attached to an item stack.
type SprayState struct {
	Level         int `json:"level"`
	RemainingUses int `json:"remaining_uses"`
}

// Validate checks spray state sanity.
func (s SprayState) Validate() error {
	if s.Level <= 0 {
		return fmt.Errorf("spray level must be positive")
	}
	if s.RemainingUses < 0 {
		return fmt.Errorf("spray remaining uses negative")
	}
	return nil
}

// Consume deducts uses from the spray state, returning false if insufficient.
func (s *SprayState) Consume(uses int) bool {
	if s == nil || uses <= 0 {
		return false
	}
	if s.RemainingUses < uses {
		return false
	}
	s.RemainingUses -= uses
	return true
}

// SprayItemDefinition describes a spray item and the tier it provides.
type SprayItemDefinition struct {
	ItemID    string `json:"item_id" yaml:"item_id"`
	Level     int    `json:"level" yaml:"level"`
	UnitYield int    `json:"unit_yield" yaml:"unit_yield"`
}

// ProductionBonusTier defines the bonus values for a spray level.
type ProductionBonusTier struct {
	Level                 int     `json:"level" yaml:"level"`
	SpeedMultiplier       float64 `json:"speed_multiplier" yaml:"speed_multiplier"`
	ExtraOutputMultiplier float64 `json:"extra_output_multiplier" yaml:"extra_output_multiplier"`
	UsesPerItem           int     `json:"uses_per_item" yaml:"uses_per_item"`
}

// ProductionBonusConfig controls spray and production bonus rules.
type ProductionBonusConfig struct {
	DefaultMode         BonusMode             `json:"default_mode" yaml:"default_mode"`
	StackRule           BonusStackRule        `json:"stack_rule" yaml:"stack_rule"`
	SprayUnitsPerTarget int                   `json:"spray_units_per_target" yaml:"spray_units_per_target"`
	UsesPerCycle        int                   `json:"uses_per_cycle" yaml:"uses_per_cycle"`
	AllowPartialSpray   bool                  `json:"allow_partial_spray" yaml:"allow_partial_spray"`
	AllowLowerRecoat    bool                  `json:"allow_lower_recoat" yaml:"allow_lower_recoat"`
	ApplyToByproducts   bool                  `json:"apply_to_byproducts" yaml:"apply_to_byproducts"`
	AllowedBuildings    []BuildingType        `json:"allowed_buildings,omitempty" yaml:"allowed_buildings,omitempty"`
	BlockedBuildings    []BuildingType        `json:"blocked_buildings,omitempty" yaml:"blocked_buildings,omitempty"`
	AllowedRecipes      []string              `json:"allowed_recipes,omitempty" yaml:"allowed_recipes,omitempty"`
	BlockedRecipes      []string              `json:"blocked_recipes,omitempty" yaml:"blocked_recipes,omitempty"`
	Tiers               []ProductionBonusTier `json:"tiers" yaml:"tiers"`
	SprayItems          []SprayItemDefinition `json:"spray_items" yaml:"spray_items"`
}

// ProductionBonusRequest describes the inputs used to evaluate production bonuses.
type ProductionBonusRequest struct {
	Recipe       RecipeDefinition
	BuildingType BuildingType
	Mode         BonusMode
	Sources      []BonusSource
}

// BonusSource captures an available spray bonus source.
type BonusSource struct {
	Level         int
	AvailableUses int
}

// ProductionBonusResult describes the resolved bonus effect.
type ProductionBonusResult struct {
	Applied               bool
	Reason                BonusFailureReason
	Mode                  BonusMode
	Level                 int
	SpeedMultiplier       float64
	ExtraOutputMultiplier float64
	Duration              int
	Outputs               []ItemAmount
	Byproducts            []ItemAmount
	UsesRequired          int
}

// SprayApplication captures the result of spraying an item stack.
type SprayApplication struct {
	Applied       bool
	Reason        BonusFailureReason
	Sprayed       ItemStack
	Remainder     ItemStack
	SprayConsumed ItemStack
}

type productionBonusCatalog struct {
	config           ProductionBonusConfig
	tiers            map[int]ProductionBonusTier
	sprayItems       map[string]SprayItemDefinition
	allowedBuildings map[BuildingType]struct{}
	blockedBuildings map[BuildingType]struct{}
	allowedRecipes   map[string]struct{}
	blockedRecipes   map[string]struct{}
}

var (
	productionBonusMu    sync.RWMutex
	productionBonusStore productionBonusCatalog
)

func init() {
	catalog, err := buildProductionBonusCatalog(DefaultProductionBonusConfig())
	if err != nil {
		panic(err)
	}
	productionBonusStore = catalog
}

// DefaultProductionBonusConfig returns default spray/bonus settings.
func DefaultProductionBonusConfig() ProductionBonusConfig {
	return ProductionBonusConfig{
		DefaultMode:         BonusModeSpeed,
		StackRule:           BonusStackHighest,
		SprayUnitsPerTarget: 1,
		UsesPerCycle:        1,
		AllowPartialSpray:   false,
		AllowLowerRecoat:    false,
		ApplyToByproducts:   false,
		Tiers: []ProductionBonusTier{
			{Level: 1, SpeedMultiplier: 1.25, ExtraOutputMultiplier: 0.125, UsesPerItem: 4},
			{Level: 2, SpeedMultiplier: 1.5, ExtraOutputMultiplier: 0.2, UsesPerItem: 6},
			{Level: 3, SpeedMultiplier: 2.0, ExtraOutputMultiplier: 0.25, UsesPerItem: 8},
		},
		SprayItems: []SprayItemDefinition{
			{ItemID: ItemProliferatorMk1, Level: 1, UnitYield: 12},
			{ItemID: ItemProliferatorMk2, Level: 2, UnitYield: 24},
			{ItemID: ItemProliferatorMk3, Level: 3, UnitYield: 60},
		},
	}
}

// SetProductionBonusConfig replaces the current catalog.
func SetProductionBonusConfig(cfg ProductionBonusConfig) error {
	catalog, err := buildProductionBonusCatalog(cfg)
	if err != nil {
		return err
	}
	productionBonusMu.Lock()
	productionBonusStore = catalog
	productionBonusMu.Unlock()
	return nil
}

// CurrentProductionBonusConfig returns a copy of the current config.
func CurrentProductionBonusConfig() ProductionBonusConfig {
	productionBonusMu.RLock()
	defer productionBonusMu.RUnlock()
	return cloneProductionBonusConfig(productionBonusStore.config)
}

// ProductionBonusTierByLevel returns the bonus tier by level.
func ProductionBonusTierByLevel(level int) (ProductionBonusTier, bool) {
	productionBonusMu.RLock()
	defer productionBonusMu.RUnlock()
	tier, ok := productionBonusStore.tiers[level]
	return tier, ok
}

// SprayDefinitionByItem returns the spray item definition by item id.
func SprayDefinitionByItem(itemID string) (SprayItemDefinition, bool) {
	productionBonusMu.RLock()
	defer productionBonusMu.RUnlock()
	def, ok := productionBonusStore.sprayItems[itemID]
	return def, ok
}

// ApplySprayToStack applies spray using the current catalog.
func ApplySprayToStack(target ItemStack, spray ItemStack) (SprayApplication, error) {
	productionBonusMu.RLock()
	catalog := productionBonusStore
	productionBonusMu.RUnlock()
	return catalog.applySprayToStack(target, spray)
}

// EvaluateProductionBonus resolves bonus rules using the current catalog.
func EvaluateProductionBonus(req ProductionBonusRequest) ProductionBonusResult {
	productionBonusMu.RLock()
	catalog := productionBonusStore
	productionBonusMu.RUnlock()
	return catalog.evaluateProductionBonus(req)
}

func buildProductionBonusCatalog(cfg ProductionBonusConfig) (productionBonusCatalog, error) {
	normalized, err := normalizeProductionBonusConfig(cfg)
	if err != nil {
		return productionBonusCatalog{}, err
	}
	if err := validateProductionBonusConfig(normalized); err != nil {
		return productionBonusCatalog{}, err
	}
	catalog := productionBonusCatalog{
		config:           normalized,
		tiers:            make(map[int]ProductionBonusTier, len(normalized.Tiers)),
		sprayItems:       make(map[string]SprayItemDefinition, len(normalized.SprayItems)),
		allowedBuildings: make(map[BuildingType]struct{}),
		blockedBuildings: make(map[BuildingType]struct{}),
		allowedRecipes:   make(map[string]struct{}),
		blockedRecipes:   make(map[string]struct{}),
	}
	for _, tier := range normalized.Tiers {
		catalog.tiers[tier.Level] = tier
	}
	for _, spray := range normalized.SprayItems {
		catalog.sprayItems[spray.ItemID] = spray
	}
	for _, b := range normalized.AllowedBuildings {
		catalog.allowedBuildings[b] = struct{}{}
	}
	for _, b := range normalized.BlockedBuildings {
		catalog.blockedBuildings[b] = struct{}{}
	}
	for _, id := range normalized.AllowedRecipes {
		catalog.allowedRecipes[id] = struct{}{}
	}
	for _, id := range normalized.BlockedRecipes {
		catalog.blockedRecipes[id] = struct{}{}
	}
	return catalog, nil
}

func normalizeProductionBonusConfig(cfg ProductionBonusConfig) (ProductionBonusConfig, error) {
	out := cloneProductionBonusConfig(cfg)
	if out.DefaultMode == "" {
		out.DefaultMode = BonusModeSpeed
	}
	if out.StackRule == "" {
		out.StackRule = BonusStackHighest
	}
	if out.SprayUnitsPerTarget == 0 {
		out.SprayUnitsPerTarget = 1
	}
	if out.UsesPerCycle == 0 {
		out.UsesPerCycle = 1
	}
	return out, nil
}

func validateProductionBonusConfig(cfg ProductionBonusConfig) error {
	switch cfg.DefaultMode {
	case BonusModeSpeed, BonusModeExtra, BonusModeNone:
	default:
		return fmt.Errorf("invalid default bonus mode %s", cfg.DefaultMode)
	}
	switch cfg.StackRule {
	case BonusStackHighest, BonusStackNone:
	default:
		return fmt.Errorf("invalid bonus stack rule %s", cfg.StackRule)
	}
	if cfg.SprayUnitsPerTarget <= 0 {
		return fmt.Errorf("spray units per target must be positive")
	}
	if cfg.UsesPerCycle <= 0 {
		return fmt.Errorf("uses per cycle must be positive")
	}
	if len(cfg.Tiers) == 0 {
		return fmt.Errorf("bonus tiers required")
	}
	levelSeen := map[int]struct{}{}
	for _, tier := range cfg.Tiers {
		if tier.Level <= 0 {
			return fmt.Errorf("bonus tier level must be positive")
		}
		if _, exists := levelSeen[tier.Level]; exists {
			return fmt.Errorf("duplicate bonus tier level %d", tier.Level)
		}
		levelSeen[tier.Level] = struct{}{}
		if tier.SpeedMultiplier < 1 {
			return fmt.Errorf("bonus tier %d speed multiplier must be >= 1", tier.Level)
		}
		if tier.ExtraOutputMultiplier < 0 {
			return fmt.Errorf("bonus tier %d extra multiplier must be >= 0", tier.Level)
		}
		if tier.UsesPerItem <= 0 {
			return fmt.Errorf("bonus tier %d uses per item must be positive", tier.Level)
		}
	}
	if len(cfg.SprayItems) == 0 {
		return fmt.Errorf("spray item definitions required")
	}
	for _, spray := range cfg.SprayItems {
		if spray.ItemID == "" {
			return fmt.Errorf("spray item id required")
		}
		if spray.UnitYield <= 0 {
			return fmt.Errorf("spray item %s unit yield must be positive", spray.ItemID)
		}
		if _, ok := levelSeen[spray.Level]; !ok {
			return fmt.Errorf("spray item %s references missing tier %d", spray.ItemID, spray.Level)
		}
	}
	return nil
}

func cloneProductionBonusConfig(cfg ProductionBonusConfig) ProductionBonusConfig {
	out := cfg
	if len(cfg.AllowedBuildings) > 0 {
		out.AllowedBuildings = append([]BuildingType(nil), cfg.AllowedBuildings...)
	}
	if len(cfg.BlockedBuildings) > 0 {
		out.BlockedBuildings = append([]BuildingType(nil), cfg.BlockedBuildings...)
	}
	if len(cfg.AllowedRecipes) > 0 {
		out.AllowedRecipes = append([]string(nil), cfg.AllowedRecipes...)
	}
	if len(cfg.BlockedRecipes) > 0 {
		out.BlockedRecipes = append([]string(nil), cfg.BlockedRecipes...)
	}
	if len(cfg.Tiers) > 0 {
		out.Tiers = make([]ProductionBonusTier, len(cfg.Tiers))
		copy(out.Tiers, cfg.Tiers)
	}
	if len(cfg.SprayItems) > 0 {
		out.SprayItems = make([]SprayItemDefinition, len(cfg.SprayItems))
		copy(out.SprayItems, cfg.SprayItems)
	}
	return out
}

func (c productionBonusCatalog) applySprayToStack(target ItemStack, spray ItemStack) (SprayApplication, error) {
	if target.Quantity <= 0 {
		return SprayApplication{Applied: false, Reason: BonusFailureInvalidSpray}, fmt.Errorf("target quantity must be positive")
	}
	if spray.Quantity <= 0 {
		return SprayApplication{Applied: false, Reason: BonusFailureInsufficientSpray}, fmt.Errorf("spray quantity must be positive")
	}
	sprayDef, ok := c.sprayItems[spray.ItemID]
	if !ok {
		return SprayApplication{Applied: false, Reason: BonusFailureInvalidSpray}, nil
	}
	tier := c.tiers[sprayDef.Level]
	if target.Spray != nil && !c.config.AllowLowerRecoat && sprayDef.Level < target.Spray.Level {
		return SprayApplication{Applied: false, Reason: BonusFailureLowerLevel}, nil
	}
	requiredUnits := target.Quantity * c.config.SprayUnitsPerTarget
	availableUnits := spray.Quantity * sprayDef.UnitYield
	if availableUnits < requiredUnits {
		if !c.config.AllowPartialSpray {
			return SprayApplication{Applied: false, Reason: BonusFailureInsufficientSpray}, nil
		}
		sprayable := availableUnits / c.config.SprayUnitsPerTarget
		if sprayable <= 0 {
			return SprayApplication{Applied: false, Reason: BonusFailureInsufficientSpray}, nil
		}
		usedUnits := sprayable * c.config.SprayUnitsPerTarget
		consumedItems := int(math.Ceil(float64(usedUnits) / float64(sprayDef.UnitYield)))
		sprayed := target
		sprayed.Quantity = sprayable
		sprayed.Spray = &SprayState{Level: sprayDef.Level, RemainingUses: tier.UsesPerItem}
		remainder := target
		remainder.Quantity = target.Quantity - sprayable
		remainder.Spray = nil
		consumed := ItemStack{ItemID: spray.ItemID, Quantity: consumedItems}
		return SprayApplication{
			Applied:       true,
			Reason:        BonusFailureNone,
			Sprayed:       sprayed,
			Remainder:     remainder,
			SprayConsumed: consumed,
		}, nil
	}
	consumedItems := int(math.Ceil(float64(requiredUnits) / float64(sprayDef.UnitYield)))
	sprayed := target
	sprayed.Spray = &SprayState{Level: sprayDef.Level, RemainingUses: tier.UsesPerItem}
	consumed := ItemStack{ItemID: spray.ItemID, Quantity: consumedItems}
	return SprayApplication{
		Applied:       true,
		Reason:        BonusFailureNone,
		Sprayed:       sprayed,
		Remainder:     ItemStack{},
		SprayConsumed: consumed,
	}, nil
}

func (c productionBonusCatalog) evaluateProductionBonus(req ProductionBonusRequest) ProductionBonusResult {
	result := ProductionBonusResult{
		Applied:    false,
		Reason:     BonusFailureNone,
		Mode:       req.Mode,
		Duration:   req.Recipe.Duration,
		Outputs:    cloneItemAmounts(req.Recipe.Outputs),
		Byproducts: cloneItemAmounts(req.Recipe.Byproducts),
	}
	mode := req.Mode
	if mode == "" {
		mode = c.config.DefaultMode
	}
	if mode == "" {
		mode = BonusModeSpeed
	}
	result.Mode = mode
	if !c.isApplicable(req.Recipe.ID, req.BuildingType) {
		result.Reason = BonusFailureNotApplicable
		return result
	}
	sources := filterBonusSources(req.Sources)
	if len(sources) == 0 {
		result.Reason = BonusFailureNoSpray
		return result
	}
	level, ok := resolveBonusLevel(sources, c.config.StackRule)
	if !ok {
		result.Reason = BonusFailureStackingBlocked
		return result
	}
	tier, ok := c.tiers[level]
	if !ok {
		result.Reason = BonusFailureInvalidSpray
		return result
	}

	result.Applied = true
	result.Level = tier.Level
	result.SpeedMultiplier = tier.SpeedMultiplier
	result.ExtraOutputMultiplier = tier.ExtraOutputMultiplier
	result.UsesRequired = c.config.UsesPerCycle
	if mode == BonusModeSpeed {
		result.Duration = applySpeed(req.Recipe.Duration, tier.SpeedMultiplier)
		return result
	}
	if mode == BonusModeExtra {
		result.Outputs = applyExtraOutputs(result.Outputs, tier.ExtraOutputMultiplier)
		if c.config.ApplyToByproducts {
			result.Byproducts = applyExtraOutputs(result.Byproducts, tier.ExtraOutputMultiplier)
		}
		return result
	}
	return result
}

func (c productionBonusCatalog) isApplicable(recipeID string, buildingType BuildingType) bool {
	if len(c.blockedRecipes) > 0 {
		if _, blocked := c.blockedRecipes[recipeID]; blocked {
			return false
		}
	}
	if len(c.allowedRecipes) > 0 {
		if _, ok := c.allowedRecipes[recipeID]; !ok {
			return false
		}
	}
	if buildingType != "" {
		if len(c.blockedBuildings) > 0 {
			if _, blocked := c.blockedBuildings[buildingType]; blocked {
				return false
			}
		}
		if len(c.allowedBuildings) > 0 {
			if _, ok := c.allowedBuildings[buildingType]; !ok {
				return false
			}
		}
	}
	return true
}

func filterBonusSources(sources []BonusSource) []BonusSource {
	filtered := make([]BonusSource, 0, len(sources))
	for _, source := range sources {
		if source.Level <= 0 || source.AvailableUses <= 0 {
			continue
		}
		filtered = append(filtered, source)
	}
	return filtered
}

func resolveBonusLevel(sources []BonusSource, rule BonusStackRule) (int, bool) {
	if len(sources) == 0 {
		return 0, false
	}
	switch rule {
	case BonusStackNone:
		if len(sources) > 1 {
			return 0, false
		}
		return sources[0].Level, true
	case BonusStackHighest:
		sort.Slice(sources, func(i, j int) bool {
			return sources[i].Level > sources[j].Level
		})
		return sources[0].Level, true
	default:
		return 0, false
	}
}

func applySpeed(duration int, multiplier float64) int {
	if duration <= 0 || multiplier <= 0 {
		return duration
	}
	return int(math.Ceil(float64(duration) / multiplier))
}

func applyExtraOutputs(outputs []ItemAmount, multiplier float64) []ItemAmount {
	if len(outputs) == 0 || multiplier <= 0 {
		return outputs
	}
	out := make([]ItemAmount, len(outputs))
	for i, item := range outputs {
		extra := int(math.Ceil(float64(item.Quantity) * multiplier))
		out[i] = ItemAmount{ItemID: item.ItemID, Quantity: item.Quantity + extra}
	}
	return out
}

func cloneItemAmounts(items []ItemAmount) []ItemAmount {
	if len(items) == 0 {
		return nil
	}
	out := make([]ItemAmount, len(items))
	copy(out, items)
	return out
}
