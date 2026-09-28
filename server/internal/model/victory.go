package model

const (
	VictoryRuleElimination     = "elimination"
	VictoryRuleMissionComplete = "mission_complete"
	VictoryRuleHybrid          = "hybrid"
	// VictoryRuleSandbox 沙盒模式（F1 新局 victory_mode=sandbox）：永不判胜。
	VictoryRuleSandbox = "sandbox"

	VictoryReasonElimination = "elimination"
	VictoryReasonGameWin     = "game_win"
)

// VictoryState captures the resolved winner and why the game ended.
type VictoryState struct {
	WinnerID    string `json:"winner_id,omitempty"`
	Reason      string `json:"reason,omitempty"`
	VictoryRule string `json:"victory_rule,omitempty"`
	TechID      string `json:"tech_id,omitempty"`
	// TeamID 团队胜利时的获胜队伍（F3）：团队对局中仅存一队时填充。
	TeamID string `json:"team_id,omitempty"`
}

// Declared reports whether a winner has been resolved.
func (v VictoryState) Declared() bool {
	return v.WinnerID != ""
}

// NormalizeVictoryRule folds unknown values back to elimination; sandbox is preserved.
func NormalizeVictoryRule(rule string) string {
	switch rule {
	case VictoryRuleMissionComplete:
		return VictoryRuleMissionComplete
	case VictoryRuleHybrid:
		return VictoryRuleHybrid
	case VictoryRuleSandbox:
		return VictoryRuleSandbox
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

// VictoryRuleNeverDeclares reports whether the rule disables victory resolution (sandbox).
func VictoryRuleNeverDeclares(rule string) bool {
	return NormalizeVictoryRule(rule) == VictoryRuleSandbox
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
