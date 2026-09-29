package gamecore

import "siliconworld/internal/model"

// settleEnemyForcesWithGrowth keeps black-fog settlement intact and scales only
// the positive threat-meter delta from this call.
func (gc *GameCore) settleEnemyForcesWithGrowth(ws *model.WorldState) []*model.GameEvent {
	before := 0.0
	if ws != nil && ws.EnemyForces != nil {
		before = ws.EnemyForces.ThreatMeter
	}
	events := gc.settleEnemyForces(ws)
	gc.applyThreatGrowthScale(ws, before)
	return events
}

func (gc *GameCore) applyThreatGrowthScale(ws *model.WorldState, before float64) {
	if gc == nil || ws == nil || ws.EnemyForces == nil {
		return
	}
	scale := gc.threatGrowthScale()
	if scale == 1 {
		return
	}
	delta := ws.EnemyForces.ThreatMeter - before
	if delta <= 0 {
		return
	}
	ws.EnemyForces.ThreatMeter = before + delta*scale
}
