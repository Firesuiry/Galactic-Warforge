package model

import "fmt"

// ProductionCycleRequest describes a single production cycle to evaluate.
type ProductionCycleRequest struct {
	Recipe       RecipeDefinition
	BuildingType BuildingType
	Runtime      BuildingRuntime
	Mode         BonusMode
	Inputs       []ItemStack // Inputs consumed by this cycle (spray state captured per stack).
}

// SprayConsumption reports spray uses consumed from an input stack.
type SprayConsumption struct {
	InputIndex int
	Level      int
	Uses       int
}

// ProductionCycleResult summarizes the resolved production cycle.
type ProductionCycleResult struct {
	Bonus               ProductionBonusResult
	EnergyConsumeTotal  int
	EnergyGenerateTotal int
	EffectiveThroughput float64
	Inputs              []ItemStack
	SprayConsumption    []SprayConsumption
}

type spraySource struct {
	Index         int
	Level         int
	AvailableUses int
}

// ResolveProductionCycle evaluates production bonus effects and spray consumption
// for a single production cycle.
func ResolveProductionCycle(req ProductionCycleRequest) (ProductionCycleResult, error) {
	if req.Recipe.ID == "" {
		return ProductionCycleResult{}, fmt.Errorf("recipe required")
	}
	if req.Recipe.Duration <= 0 {
		return ProductionCycleResult{}, fmt.Errorf("recipe %s invalid duration", req.Recipe.ID)
	}

	runtime := req.Runtime
	if runtime.Functions.Production == nil && runtime.Params.Footprint.Width == 0 && req.BuildingType != "" {
		profile := BuildingProfileFor(req.BuildingType, 1)
		runtime = profile.Runtime
	}
	if runtime.Functions.Production == nil {
		return ProductionCycleResult{}, fmt.Errorf("production module required")
	}
	if req.BuildingType != "" && !recipeAllowsBuilding(req.Recipe, req.BuildingType) {
		return ProductionCycleResult{}, fmt.Errorf("recipe %s not supported by building %s", req.Recipe.ID, req.BuildingType)
	}

	inputSet := recipeInputSet(req.Recipe)
	sources := collectSpraySources(req.Inputs, inputSet)
	bonus := EvaluateProductionBonus(ProductionBonusRequest{
		Recipe:       req.Recipe,
		BuildingType: req.BuildingType,
		Mode:         req.Mode,
		Sources:      toBonusSources(sources),
	})

	result := ProductionCycleResult{
		Bonus:               bonus,
		EnergyConsumeTotal:  (runtime.Params.EnergyConsume + req.Recipe.EnergyCost) * bonus.Duration,
		EnergyGenerateTotal: runtime.Params.EnergyGenerate * bonus.Duration,
		EffectiveThroughput: effectiveThroughput(runtime.Functions.Production.Throughput, req.Recipe.Duration, bonus.Duration),
		Inputs:              cloneItemStacks(req.Inputs),
	}

	if bonus.Applied && bonus.UsesRequired > 0 {
		updatedInputs, consumption, ok := consumeSprayUses(result.Inputs, sources, bonus.Level, bonus.UsesRequired)
		if !ok {
			bonus = resetBonusForInsufficientSpray(bonus, req.Recipe)
			result.Bonus = bonus
			result.EnergyConsumeTotal = (runtime.Params.EnergyConsume + req.Recipe.EnergyCost) * bonus.Duration
			result.EnergyGenerateTotal = runtime.Params.EnergyGenerate * bonus.Duration
			result.EffectiveThroughput = effectiveThroughput(runtime.Functions.Production.Throughput, req.Recipe.Duration, bonus.Duration)
			result.Inputs = cloneItemStacks(req.Inputs)
			return result, nil
		}
		result.Inputs = updatedInputs
		result.SprayConsumption = consumption
	}

	return result, nil
}

func recipeAllowsBuilding(recipe RecipeDefinition, btype BuildingType) bool {
	if btype == "" {
		return true
	}
	for _, bt := range recipe.BuildingTypes {
		if bt == btype {
			return true
		}
	}
	return false
}

func recipeInputSet(recipe RecipeDefinition) map[string]struct{} {
	set := make(map[string]struct{}, len(recipe.Inputs))
	for _, input := range recipe.Inputs {
		if input.ItemID == "" {
			continue
		}
		set[input.ItemID] = struct{}{}
	}
	return set
}

func collectSpraySources(inputs []ItemStack, inputSet map[string]struct{}) []spraySource {
	if len(inputs) == 0 {
		return nil
	}
	out := make([]spraySource, 0, len(inputs))
	for i, stack := range inputs {
		if stack.Quantity <= 0 || stack.Spray == nil {
			continue
		}
		if _, ok := inputSet[stack.ItemID]; !ok {
			continue
		}
		if stack.Spray.Level <= 0 || stack.Spray.RemainingUses <= 0 {
			continue
		}
		out = append(out, spraySource{Index: i, Level: stack.Spray.Level, AvailableUses: stack.Spray.RemainingUses})
	}
	return out
}

func toBonusSources(sources []spraySource) []BonusSource {
	if len(sources) == 0 {
		return nil
	}
	out := make([]BonusSource, len(sources))
	for i, source := range sources {
		out[i] = BonusSource{Level: source.Level, AvailableUses: source.AvailableUses}
	}
	return out
}

func consumeSprayUses(inputs []ItemStack, sources []spraySource, level int, uses int) ([]ItemStack, []SprayConsumption, bool) {
	if uses <= 0 {
		return inputs, nil, true
	}
	total := 0
	for _, source := range sources {
		if source.Level == level {
			total += source.AvailableUses
		}
	}
	if total < uses {
		return inputs, nil, false
	}

	remaining := uses
	consumption := make([]SprayConsumption, 0)
	updated := cloneItemStacks(inputs)
	for _, source := range sources {
		if remaining <= 0 {
			break
		}
		if source.Level != level {
			continue
		}
		stack := updated[source.Index]
		if stack.Spray == nil || stack.Spray.Level != level || stack.Spray.RemainingUses <= 0 {
			continue
		}
		consume := minInt(remaining, stack.Spray.RemainingUses)
		stack.Spray.RemainingUses -= consume
		remaining -= consume
		if stack.Spray.RemainingUses == 0 {
			stack.Spray = nil
		}
		updated[source.Index] = stack
		consumption = append(consumption, SprayConsumption{InputIndex: source.Index, Level: level, Uses: consume})
	}
	return updated, consumption, remaining == 0
}

func resetBonusForInsufficientSpray(bonus ProductionBonusResult, recipe RecipeDefinition) ProductionBonusResult {
	bonus.Applied = false
	bonus.Reason = BonusFailureInsufficientSpray
	bonus.Level = 0
	bonus.SpeedMultiplier = 0
	bonus.ExtraOutputMultiplier = 0
	bonus.Duration = recipe.Duration
	bonus.Outputs = cloneItemAmounts(recipe.Outputs)
	bonus.Byproducts = cloneItemAmounts(recipe.Byproducts)
	bonus.UsesRequired = 0
	return bonus
}

func effectiveThroughput(baseThroughput int, baseDuration int, adjustedDuration int) float64 {
	if baseThroughput <= 0 {
		return 0
	}
	if baseDuration <= 0 || adjustedDuration <= 0 {
		return float64(baseThroughput)
	}
	return float64(baseThroughput) * float64(baseDuration) / float64(adjustedDuration)
}

func cloneItemStacks(stacks []ItemStack) []ItemStack {
	if len(stacks) == 0 {
		return nil
	}
	out := make([]ItemStack, len(stacks))
	for i, stack := range stacks {
		out[i] = stack
		if stack.Spray != nil {
			val := *stack.Spray
			out[i].Spray = &val
		}
	}
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
