package gamecore

import (
	"siliconworld/internal/model"
)

// paceOrOne treats unset/non-positive multipliers as the historical rate.
func paceOrOne(v float64) float64 {
	return model.PaceOrOne(v)
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
	return model.ScalePaceTicks(base, pace)
}

func (gc *GameCore) scaledConstructionDuration() int {
	return scaleTicks(defaultConstructionDurationTick, gc.buildPace())
}

func scaleResearchCost(cost []model.ItemAmount, pace float64) []model.ItemAmount {
	return model.ScaledResearchCost(cost, pace)
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
