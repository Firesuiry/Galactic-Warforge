package model

import "testing"

func TestVictoryRuleSandboxNeverDeclares(t *testing.T) {
	if got := NormalizeVictoryRule("sandbox"); got != VictoryRuleSandbox {
		t.Fatalf("sandbox must survive normalization, got %q", got)
	}
	if VictoryRuleAllowsElimination(VictoryRuleSandbox) || VictoryRuleAllowsMissionComplete(VictoryRuleSandbox) {
		t.Fatalf("sandbox must disable all victory checks")
	}
	if !VictoryRuleNeverDeclares(VictoryRuleSandbox) {
		t.Fatalf("sandbox must report never-declares")
	}
	if VictoryRuleNeverDeclares(VictoryRuleElimination) || VictoryRuleNeverDeclares(VictoryRuleHybrid) {
		t.Fatalf("elimination/hybrid must still declare victory")
	}
	if got := NormalizeVictoryRule("junk"); got != VictoryRuleElimination {
		t.Fatalf("unknown rule must fold to elimination, got %q", got)
	}
}
