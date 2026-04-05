package model

const (
	VictoryRuleElimination     = "elimination"
	VictoryRuleMissionComplete = "mission_complete"
	VictoryRuleHybrid          = "hybrid"

	VictoryReasonElimination = "elimination"
	VictoryReasonGameWin     = "game_win"
)

// VictoryState captures the resolved winner and why the game ended.
type VictoryState struct {
	WinnerID    string `json:"winner_id,omitempty"`
	Reason      string `json:"reason,omitempty"`
	VictoryRule string `json:"victory_rule,omitempty"`
	TechID      string `json:"tech_id,omitempty"`
}

// Declared reports whether a winner has been resolved.
func (v VictoryState) Declared() bool {
	return v.WinnerID != ""
}

// NormalizeVictoryRule folds unknown values back to elimination.
func NormalizeVictoryRule(rule string) string {
	switch rule {
	case VictoryRuleMissionComplete:
		return VictoryRuleMissionComplete
	case VictoryRuleHybrid:
		return VictoryRuleHybrid
	default:
		return VictoryRuleElimination
	}
}

// VictoryRuleAllowsMissionComplete reports whether a rule checks mission completion.
func VictoryRuleAllowsMissionComplete(rule string) bool {
	switch NormalizeVictoryRule(rule) {
	case VictoryRuleMissionComplete, VictoryRuleHybrid:
		return true
	default:
		return false
	}
}

// VictoryRuleAllowsElimination reports whether a rule checks elimination.
func VictoryRuleAllowsElimination(rule string) bool {
	switch NormalizeVictoryRule(rule) {
	case VictoryRuleElimination, VictoryRuleHybrid:
		return true
	default:
		return false
	}
}
