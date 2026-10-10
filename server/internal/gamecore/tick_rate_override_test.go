package gamecore_test

import (
	"testing"
	"time"
)

// TickRate 无覆盖时取对局配置；有覆盖时覆盖优先（tick 速率是运行参数）。
// 覆盖值在 tick 循环启动前确定，进程运行中不撤销，因此这里只断言「覆盖优先」。
func TestTickRateOverrideWinsOverConfig(t *testing.T) {
	core := newTestCore(t)
	if got := core.TickRate(); got != 10 {
		t.Fatalf("TickRate without override = %d, want config 10", got)
	}
	core.ApplyTickRateOverride(3)
	if got := core.TickRate(); got != 3 {
		t.Fatalf("TickRate with override = %d, want 3", got)
	}
	// 0 / 负数 = 不覆盖：不动已有设置。
	core.ApplyTickRateOverride(0)
	if got := core.TickRate(); got != 3 {
		t.Fatalf("TickRate after no-op override = %d, want 3", got)
	}
}

// tick 循环按覆盖值调度：低速覆盖（2 tick/s）下 1.2 秒只应推进 2 tick 左右，
// 若覆盖没生效会按配置的 10 tick/s 推进十几个。
func TestRunUsesTickRateOverride(t *testing.T) {
	core := newTestCore(t)
	core.ApplyTickRateOverride(2)
	go core.Run()
	time.Sleep(1200 * time.Millisecond)
	core.Stop()

	ticks := core.CurrentTick()
	if ticks == 0 {
		t.Fatalf("tick loop did not run")
	}
	if ticks > 5 {
		t.Fatalf("tick loop ignored override: %d ticks in 1.2s at 2 tick/s", ticks)
	}
}
