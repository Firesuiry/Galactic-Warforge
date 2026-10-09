package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 研究成本一致性回归（试玩报告新问题 #3）：bot 的研究规划与结算必须用同一套
// 缩放后的成本，否则高 pace_research 下 bot 会以为 20 个矩阵够用、反复空转。

// 研究站备料目标随 pace_research 缩放后的实际成本提高。
func TestBotResearchMatrixReserveFollowsResearchPace(t *testing.T) {
	player := &model.PlayerState{PlayerID: "p1", Tech: model.NewPlayerTechState("p1")}
	tuning := botTuning{researchTarget: "weapon_system", researchReserve: 20}

	player.Tech.ResearchPace = 1
	if got := botResearchMatrixReserve(player, tuning); got != 20 {
		t.Fatalf("pace=1 reserve = %d, want 20", got)
	}
	// 武器系统基准 20 个；pace=2 时实际 40 个。
	player.Tech.ResearchPace = 2
	if got := botResearchMatrixReserve(player, tuning); got != 40 {
		t.Fatalf("pace=2 reserve = %d, want 40", got)
	}
	// 上限 200：极端倍率不会让 bot 无限囤料。
	player.Tech.ResearchPace = 100
	if got := botResearchMatrixReserve(player, tuning); got != 200 {
		t.Fatalf("reserve must be capped at 200, got %d", got)
	}
	// 未配置主攻科技时退回默认备料量。
	player.Tech.ResearchPace = 2
	if got := botResearchMatrixReserve(player, botTuning{}); got != 20 {
		t.Fatalf("default reserve = %d, want 20", got)
	}
	// 已完成的前置科技不再计入备料目标：否则整条链的成本会累加，
	// 研究站缓存被占满、后续科技反而开不了（试玩报告 D）。
	player.Tech.ResearchPace = 2
	player.Tech.CompletedTechs["weapon_system"] = 1
	player.Tech.CompletedTechs["electromagnetism"] = 1
	player.Tech.CompletedTechs["automatic_metallurgy"] = 1
	// 整条链都完成：退回默认备料量，不再按已完成的成本累加。
	if got := botResearchMatrixReserve(player, tuning); got != 20 {
		t.Fatalf("fully completed chain must fall back to the default reserve, got %d want 20", got)
	}
	// 前置链上的科技未完成时仍按最高单项备料（自动化冶金 10×2 = 20）。
	player.Tech.CompletedTechs = map[string]int{"dyson_sphere_program": 1}
	if got := botResearchMatrixReserve(player, tuning); got != 40 {
		t.Fatalf("reserve must follow the largest remaining step, got %d want 40", got)
	}
}

// bot 的主攻科技链优先于目录顺序（等级序会把矩阵烧在别的科技上）。
func TestBotResearchCandidatesPreferWeaponChain(t *testing.T) {
	chain := botResearchChain("weapon_system")
	if len(chain) == 0 || chain[0] != "weapon_system" {
		t.Fatalf("chain must start at the target, got %v", chain)
	}
	has := func(id string) bool {
		for _, entry := range chain {
			if entry == id {
				return true
			}
		}
		return false
	}
	if !has("electromagnetism") || !has("automatic_metallurgy") {
		t.Fatalf("chain must include weapon_system prerequisites, got %v", chain)
	}

	candidates := botResearchCandidates(botTuning{researchTarget: "weapon_system"})
	if len(candidates) == 0 {
		t.Fatal("candidates must not be empty")
	}
	if candidates[0].ID != "weapon_system" {
		t.Fatalf("first candidate = %s, want weapon_system", candidates[0].ID)
	}
	// 链上的科技全部排在链外科技之前。
	chainSet := map[string]bool{}
	for _, id := range chain {
		chainSet[id] = true
	}
	seenOutside := false
	for _, def := range candidates {
		if chainSet[def.ID] {
			if seenOutside {
				t.Fatalf("chain tech %s must come before non-chain techs", def.ID)
			}
			continue
		}
		seenOutside = true
	}

	// 未配置主攻科技时保持目录默认顺序。
	def := botResearchCandidates(botTuning{})
	if len(def) == 0 || def[0].ID != model.AllTechDefinitions()[0].ID {
		t.Fatalf("default candidate order must follow the catalog, got %s", def[0].ID)
	}
}
