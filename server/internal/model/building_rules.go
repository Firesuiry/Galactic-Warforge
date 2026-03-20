package model

import "math"

const (
	defaultUpgradeMaxLevel    = 3
	defaultDemolishRefundRate = 0.5
)

// BuildingUpgradeRule defines upgrade constraints for a building type.
type BuildingUpgradeRule struct {
	Allow          bool    `json:"allow" yaml:"allow"`
	MaxLevel       int     `json:"max_level" yaml:"max_level"`
	CostMultiplier float64 `json:"cost_multiplier,omitempty" yaml:"cost_multiplier,omitempty"`
	DurationTicks  int     `json:"duration_ticks,omitempty" yaml:"duration_ticks,omitempty"`
	RequireIdle    bool    `json:"require_idle,omitempty" yaml:"require_idle,omitempty"`
}

// BuildingDemolishRule defines demolish constraints for a building type.
type BuildingDemolishRule struct {
	Allow         bool    `json:"allow" yaml:"allow"`
	RefundRate    float64 `json:"refund_rate" yaml:"refund_rate"`
	DurationTicks int     `json:"duration_ticks" yaml:"duration_ticks"`
	RequireIdle   bool    `json:"require_idle,omitempty" yaml:"require_idle,omitempty"`
}

func isZeroUpgradeRule(rule BuildingUpgradeRule) bool {
	return !rule.Allow && rule.MaxLevel == 0 && rule.CostMultiplier == 0 && rule.DurationTicks == 0 && !rule.RequireIdle
}

func isZeroDemolishRule(rule BuildingDemolishRule) bool {
	return !rule.Allow && rule.RefundRate == 0 && rule.DurationTicks == 0 && !rule.RequireIdle
}

func applyUpgradeRuleDefaults(def BuildingDefinition) BuildingUpgradeRule {
	rule := def.Upgrade
	if isZeroUpgradeRule(rule) {
		if def.Buildable {
			rule.Allow = true
			rule.MaxLevel = defaultUpgradeMaxLevel
		} else {
			rule.Allow = false
			rule.MaxLevel = 1
		}
	}
	if rule.MaxLevel == 0 {
		if rule.Allow {
			rule.MaxLevel = defaultUpgradeMaxLevel
		} else {
			rule.MaxLevel = 1
		}
	}
	if rule.CostMultiplier == 0 && rule.Allow {
		rule.CostMultiplier = 1
	}
	return rule
}

func applyDemolishRuleDefaults(def BuildingDefinition) BuildingDemolishRule {
	rule := def.Demolish
	if isZeroDemolishRule(rule) {
		rule.Allow = def.Buildable
	}
	if rule.Allow {
		if rule.RefundRate == 0 {
			rule.RefundRate = defaultDemolishRefundRate
		}
	}
	return rule
}

// BuildingUpgradeRuleFor returns the normalized upgrade rule for a building type.
func BuildingUpgradeRuleFor(btype BuildingType) BuildingUpgradeRule {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return BuildingUpgradeRule{}
	}
	return applyUpgradeRuleDefaults(def)
}

// BuildingDemolishRuleFor returns the normalized demolish rule for a building type.
func BuildingDemolishRuleFor(btype BuildingType) BuildingDemolishRule {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return BuildingDemolishRule{}
	}
	return applyDemolishRuleDefaults(def)
}

// BuildingUpgradeCost returns the cost to upgrade a building at the given level.
func BuildingUpgradeCost(btype BuildingType, level int) BuildCost {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return BuildCost{}
	}
	if level <= 0 {
		level = 1
	}
	rule := applyUpgradeRuleDefaults(def)
	mult := rule.CostMultiplier
	if mult == 0 {
		mult = 1
	}
	factor := mult * float64(level)
	return BuildCost{
		Minerals: scaleCost(def.BuildCost.Minerals, factor),
		Energy:   scaleCost(def.BuildCost.Energy, factor),
		Items:    scaleItemAmounts(def.BuildCost.Items, factor),
	}
}

// BuildingDemolishRefund returns the refund for demolishing a building at the given level.
func BuildingDemolishRefund(btype BuildingType, level int) BuildCost {
	rule := BuildingDemolishRuleFor(btype)
	return BuildingDemolishRefundWithRate(btype, level, rule.RefundRate)
}

// BuildingDemolishRefundWithRate returns the refund for demolishing a building at the given level and rate.
func BuildingDemolishRefundWithRate(btype BuildingType, level int, refundRate float64) BuildCost {
	def, ok := BuildingDefinitionByID(btype)
	if !ok {
		return BuildCost{}
	}
	if level <= 0 {
		level = 1
	}
	if refundRate < 0 {
		refundRate = 0
	}
	if refundRate > 1 {
		refundRate = 1
	}
	factor := float64(level) * refundRate
	return BuildCost{
		Minerals: scaleCost(def.BuildCost.Minerals, factor),
		Energy:   scaleCost(def.BuildCost.Energy, factor),
		Items:    scaleItemAmounts(def.BuildCost.Items, factor),
	}
}

func scaleCost(base int, factor float64) int {
	if base == 0 || factor == 0 {
		return 0
	}
	return int(math.Ceil(float64(base) * factor))
}

func scaleItemAmounts(items []ItemAmount, factor float64) []ItemAmount {
	if len(items) == 0 || factor == 0 {
		return nil
	}
	out := make([]ItemAmount, 0, len(items))
	for _, item := range items {
		qty := int(math.Ceil(float64(item.Quantity) * factor))
		if qty <= 0 {
			continue
		}
		out = append(out, ItemAmount{ItemID: item.ItemID, Quantity: qty})
	}
	return out
}
