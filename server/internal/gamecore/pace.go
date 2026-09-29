package gamecore

import (
	"math"

	"siliconworld/internal/model"
)

// paceOrOne treats unset/non-positive multipliers as the historical rate.
func paceOrOne(v float64) float64 {
	if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		return 1
	}
	return v
}

func (gc *GameCore) researchPace() float64 {
	if gc == nil || gc.cfg == nil {
		return 1
	}
	return paceOrOne(gc.cfg.Battlefield.PaceResearch)
}

func (gc *GameCore) buildPace() float64 {
	if gc == nil || gc.cfg == nil {
		return 1
	}
	return paceOrOne(gc.cfg.Battlefield.PaceBuild)
}

func (gc *GameCore) outputPace() float64 {
	if gc == nil || gc.cfg == nil {
		return 1
	}
	return paceOrOne(gc.cfg.Battlefield.PaceOutput)
}

func (gc *GameCore) threatGrowthScale() float64 {
	if gc == nil || gc.cfg == nil {
		return 1
	}
	return paceOrOne(gc.cfg.Battlefield.ThreatGrowthScale)
}

func (gc *GameCore) timeLimitTicks() int64 {
	if gc == nil || gc.cfg == nil || gc.cfg.Battlefield.TimeLimitTicks < 0 {
		return 0
	}
	return gc.cfg.Battlefield.TimeLimitTicks
}

func scaleTicks(base int, pace float64) int {
	if base < 1 {
		base = 1
	}
	pace = paceOrOne(pace)
	if pace == 1 {
		return base
	}
	scaled := int(math.Round(float64(base) * pace))
	if scaled < 1 {
		return 1
	}
	return scaled
}

func (gc *GameCore) scaledConstructionDuration() int {
	return scaleTicks(defaultConstructionDurationTick, gc.buildPace())
}

func scaleResearchCost(cost []model.ItemAmount, pace float64) []model.ItemAmount {
	out := make([]model.ItemAmount, len(cost))
	copy(out, cost)
	pace = paceOrOne(pace)
	if pace == 1 {
		return out
	}
	for i := range out {
		if out[i].Quantity > 0 {
			out[i].Quantity = scaleTicks(out[i].Quantity, pace)
		}
	}
	return out
}

func (gc *GameCore) applyOutputPace(ws *model.WorldState) {
	if ws == nil {
		return
	}
	pace := gc.outputPace()
	if pace == 1 {
		ws.PaceOutput = 0
		return
	}
	ws.PaceOutput = pace
}
