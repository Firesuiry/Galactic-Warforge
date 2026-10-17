package checkpointbuild

import "testing"

// advance_to_tick 的目标 tick 已过去时必须显式报错（试玩 1016 报告问题 1
// 排查时踩过）：前一条命令会自己推进一 tick，记录里的下一条 advance_to_tick
// 若正好等于「命令前的 tick + 1」，旧实现静默停在原地，后面的命令在「比记录
// 晚一 tick」的状态下执行，失败信息与记录完全对不上。
func TestAdvanceTargetError(t *testing.T) {
	if got := advanceTargetError(3, 10, 10); got != "" {
		t.Fatalf("目标 == 当前 tick 不该报错：%s", got)
	}
	if got := advanceTargetError(3, 12, 10); got != "" {
		t.Fatalf("目标在未来不该报错：%s", got)
	}
	got := advanceTargetError(12, 2910, 3446)
	if got == "" {
		t.Fatal("目标已过去必须报错")
	}
	if want := "第 12 步 advance_to_tick 2910 已过去（当前 tick 3446）"; len(got) < len(want) || got[:len(want)] != want {
		t.Fatalf("失败原因不清晰：%s", got)
	}
}
