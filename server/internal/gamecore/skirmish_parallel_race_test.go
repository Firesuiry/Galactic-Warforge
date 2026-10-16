package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// TestSkirmishSeedsParallelRaceSmoke 守住「整局回归的 seed 子测试并行」这条前提：
// mapgen 生成、GameCore 引导、脚本开局与 bot 产线都不允许有跨 seed 的共享可变状态。
// 4 个 seed 并行跑到 tick 12000（覆盖地图生成、开局链、bot 产线/科技链起步），
// 在 `-race` 下跑一遍即可看出有没有跨 seed 的数据竞争。短模式跳过。
//
//	cd server && go test -race ./internal/gamecore/ -run TestSkirmishSeedsParallelRaceSmoke -v -timeout 30m
func TestSkirmishSeedsParallelRaceSmoke(t *testing.T) {
	if testing.Short() {
		t.Skip("-race 下的并行冒烟（数分钟）；用 -run 单跑")
	}
	for i, seed := range []string{"skirmish-seed-001", "pt1009-g2", "pt1010-85s8io", "pt1011-0e2bz1"} {
		scripted := i%2 == 0
		t.Run(seed, func(t *testing.T) {
			t.Parallel()
			core := newSkirmishCoreForSeed(t, seed)
			core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
			const ticks = 12000
			if scripted {
				// 脚本开局（p1 手搓链 + 建造 + 送料）与 bot 发育同时推进。
				op := newZeroOpening(t, core, ticks)
				op.run()
				return
			}
			for core.CurrentTick() < ticks {
				core.processTick()
			}
		})
	}
}
