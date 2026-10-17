package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
)

// 从零脚本化玩家的确定性：同一 seed、同一脚本，跑两次必须得到完全相同的
// 世界（状态摘要 + 命令日志）。脚本里有大量「遍历 map 再下发命令」的地方
// （背包堆料疏通、制造台喂料、按配方分组的机器列表），map 迭代顺序随机，
// 会让同一 tick 的命令顺序、进而世界状态每次不同——bot 回归与试玩报告里
// 「同一个 seed 两局不一样」的根因就在这里。
//
// 跑到 tick 6000（开局链走完：风机/电塔/矿机/熔炉/制造台/兵营/研究站都已落成，
// 期间会走到背包疏通、制造台喂料、兵营排产这些「遍历 map 再下发命令」的分支）。
// 实测这一长度能抓到「背包堆料疏通不排序」与「制造台喂料不排序」两类抖动；
// 两次运行约 20–25 秒，-short 下跳过（与 TestSkirmishFromZeroOpeningByTick6000
// 同为开局链验收，长测试由主代理合并前统一跑）。
// 两次运行都建独立的 GameCore/WorldState，不碰包级可变状态。

func TestSkirmishFromZeroScriptedDeterminism(t *testing.T) {
	if testing.Short() {
		t.Skip("脚本开局确定性（两次 6000 tick，约 25 秒）")
	}
	const ticks = 6000
	first := runZeroOpeningDeterminismRun(t, ticks)
	second := runZeroOpeningDeterminismRun(t, ticks)
	if first != second {
		t.Fatalf("同一 seed 两次脚本开局不一致：\n first=%s\nsecond=%s", first, second)
	}
	if first == "" {
		t.Fatal("状态摘要为空")
	}
}

// runZeroOpeningDeterminismRun 跑一次脚本开局并返回「状态 + 命令日志」摘要。
func runZeroOpeningDeterminismRun(t *testing.T, ticks int64) string {
	t.Helper()
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, ticks)
	op.run()

	type runDigest struct {
		Tick      int64            `json:"tick"`
		Digest    string           `json:"digest"`
		Milestone map[string]int64 `json:"milestone"`
		Buildings int              `json:"buildings"`
		Units     int              `json:"units"`
		Commands  []string         `json:"commands"`
	}
	digest := digestRuntime(op.ws, core.spaceRuntime)
	out := runDigest{
		Tick:      op.ws.Tick,
		Digest:    digest.Hash,
		Milestone: op.milestone,
		Buildings: len(op.ws.Buildings),
		Units:     len(op.ws.Units),
	}
	// 命令日志只取「哪一 tick、谁、什么命令」，不取回执文案（回执里可能带
	// 随机/时间相关内容）；脚本与 bot 的命令顺序完全由决策逻辑决定。
	for _, entry := range core.GetCommandLog().All() {
		for _, cmd := range entry.Commands {
			payload, _ := json.Marshal(cmd.Payload)
			out.Commands = append(out.Commands, string(cmd.Type)+"|"+cmd.Target.EntityID+"|"+string(payload))
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal digest: %v", err)
	}
	return string(raw)
}
