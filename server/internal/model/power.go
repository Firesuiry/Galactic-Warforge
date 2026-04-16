package model

import (
	"fmt"
	"math"

	modelpower "siliconworld/internal/model/power"
)

// PowerInput describes a single generator output for grid settlement.
type PowerInput struct {
	BuildingID     string                     `json:"building_id"`
	OwnerID        string                     `json:"owner_id"`
	SourceKind     modelpower.PowerSourceKind `json:"source_kind"`
	BaseOutput     int                        `json:"base_output"`
	EnvFactor      float64                    `json:"env_factor"`
	FuelMultiplier float64                    `json:"fuel_multiplier"`
	Output         int                        `json:"output"`
	FuelUsed       []ItemAmount               `json:"fuel_used,omitempty"`
}

// PowerGenerationRequest describes inputs for resolving a generator tick.
type PowerGenerationRequest struct {
	Module    *modelpower.EnergyModule
	EnvFactor float64
	Storage   *StorageState
}

// PowerGenerationResult captures resolved output and fuel usage.
type PowerGenerationResult struct {
	Output         int
	BaseOutput     int
	EnvFactor      float64
	FuelMultiplier float64
	FuelUsed       []ItemAmount
}

// ResolvePowerGeneration computes the power output and fuel usage for a single tick.
func ResolvePowerGeneration(req PowerGenerationRequest) (PowerGenerationResult, error) {
	result := PowerGenerationResult{
		EnvFactor:      req.EnvFactor,
		FuelMultiplier: 1,
	}
	if req.Module == nil {
		return result, nil
	}
	base := req.Module.OutputPerTick
	result.BaseOutput = base
	if base <= 0 {
		return result, nil
	}
	kind := req.Module.SourceKind
	if kind == "" {
		return result, nil
	}
	if !modelpower.IsPowerSourceKind(kind) {
		return result, fmt.Errorf("invalid power source kind %s", kind)
	}

	env := req.EnvFactor
	if env < 0 {
		env = 0
	}
	result.EnvFactor = env
	if env <= 0 {
		return result, nil
	}

	if modelpower.IsFuelBasedPowerSource(kind) {
		if len(req.Module.FuelRules) == 0 {
			return result, fmt.Errorf("power source %s requires fuel rules", kind)
		}
		var selected *modelpower.FuelRule
		consumed := 0
		required := 0
		for i := range req.Module.FuelRules {
			rule := req.Module.FuelRules[i]
			if rule.ItemID == "" || rule.ConsumePerTick <= 0 {
				continue
			}
			required = rule.ConsumePerTick
			consumed = consumeFuel(req.Storage, rule.ItemID, required)
			if consumed > 0 {
				selected = &rule
				break
			}
		}
		if selected == nil || consumed <= 0 {
			return result, nil
		}
		if selected.OutputMultiplier > 0 {
			result.FuelMultiplier = selected.OutputMultiplier
		}
		ratio := float64(consumed) / float64(required)
		output := float64(base) * env * result.FuelMultiplier * ratio
		if output < 0 {
			output = 0
		}
		result.Output = int(math.Round(output))
		result.FuelUsed = []ItemAmount{{ItemID: selected.ItemID, Quantity: consumed}}
		return result, nil
	}

	output := float64(base) * env
	if output < 0 {
		output = 0
	}
	result.Output = int(math.Round(output))
	return result, nil
}

func consumeFuel(storage *StorageState, itemID string, qty int) int {
	if storage == nil || qty <= 0 || itemID == "" {
		return 0
	}
	remaining := qty
	taken := removeFromInventory(storage.InputBuffer, itemID, remaining)
	remaining -= taken
	if remaining > 0 {
		take := removeFromInventory(storage.Inventory, itemID, remaining)
		taken += take
	}
	return taken
}
