package config

import (
	"math"
	"path/filepath"
	"testing"
)

// 遭遇战 pace_research 定标验收（试玩报告 E；2026-10-10 起改为「无物资包从零采集」节奏）：
// pace=2 下，玩家从空背包手搓起步，产线摆好、持续供料时，电磁学（20 个矩阵）
// 应约 tick 30000 完成——即 bot 首攻（bot_first_attack_tick 30000）前后。
// 旧的 6 倍（电磁学 60 个矩阵）整局做不完任何科技；旧的 54000 时限与 16000 首攻
// 在「从零采集」下会在玩家拿到任何防御前就结束对局。
func TestSkirmishResearchPaceAllowsCoreTechs(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "config-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load config-skirmish: %v", err)
	}
	pace := cfg.Battlefield.PaceResearch
	if pace <= 0 || pace > 2 {
		t.Fatalf("pace_research = %v, want 0 < pace <= 2", pace)
	}

	const (
		matrixDurationTicks = 60 // 1 个电磁矩阵在制造台里的基准耗时（recipes.yaml）
		timeLimitTicks      = 90000
	)
	// 目录基准：电磁学 10 个矩阵、武器系统 20 个（见 server/data/techs.yaml）。
	// 取整规则与结算一致：四舍五入、下限 1。
	scaled := func(base int) int {
		q := int(math.Round(float64(base) * pace))
		if q < 1 {
			q = 1
		}
		return q
	}
	electromagnetism := scaled(10)
	weaponSystem := scaled(20)

	// pace=2 的目标区间：无物资包开局下，玩家并行 2–3 台制造台供矩阵，
	// 电磁学（20 个矩阵）的串行时间必须落在 30000 tick 内（含前置链的手搓时间）。
	parallelMachines := 3
	firstTechTicks := electromagnetism * matrixDurationTicks / parallelMachines
	if firstTechTicks < 200 || firstTechTicks > 30000 {
		t.Fatalf("electromagnetism takes %d ticks at pace %v with %d machines, want within 200–30000",
			firstTechTicks, pace, parallelMachines)
	}
	if pace == 2 && firstTechTicks > 8000 {
		t.Fatalf("pace=2 pure machine time for electromagnetism must stay under tick ~8000, got %d", firstTechTicks)
	}
	// 前置链（电磁学 + 自动化冶金 + 武器系统）也要在整局内完成。
	chainTicks := (electromagnetism + scaled(10) + weaponSystem) * matrixDurationTicks / parallelMachines
	if chainTicks >= timeLimitTicks {
		t.Fatalf("electromagnetism→weapon_system chain needs %d ticks (pace %v), beyond the time limit %d",
			chainTicks, pace, timeLimitTicks)
	}
	if cfg.Battlefield.TimeLimitTicks != timeLimitTicks {
		t.Fatalf("time_limit_ticks = %d, want %d", cfg.Battlefield.TimeLimitTicks, timeLimitTicks)
	}
	if cfg.Battlefield.BotFirstAttackTick != 30000 {
		t.Fatalf("bot_first_attack_tick = %d, want 30000", cfg.Battlefield.BotFirstAttackTick)
	}
	// 上下界：pace=1 时按目录原价，允许 1–2 的微调；低于 1 等于加速研究，不符合"更慢"的设定。
	if pace < 1 {
		t.Fatalf("pace_research = %v, want >= 1", pace)
	}
}
