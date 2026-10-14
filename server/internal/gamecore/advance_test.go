package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 狂飙模式（advance.go）测试：到达目标、各停止条件、显式关闭、取消、并发 409、
// 快进与定时 tick 的确定性一致、以及快进前后存读档一致。

func p1OwnedTargets(core *GameCore) map[string]struct{} {
	return core.AdvanceOwnedTargets(map[string]struct{}{"p1": {}})
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(200 * time.Microsecond)
	}
	return cond()
}

// 到达目标（ticks 形态）：推进指定 tick 数，结束后定时 tick 路径照常工作。
func TestAdvanceReachesTargetTick(t *testing.T) {
	core := newE2ETestCore(t)
	start := core.CurrentTick()

	res, err := core.Advance(AdvanceSpec{Ticks: 5, StopOn: AdvanceStopOn{}}, nil)
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.StartTick != start || res.EndTick != start+5 {
		t.Fatalf("tick range = %d → %d, want %d → %d", res.StartTick, res.EndTick, start, start+5)
	}
	if res.StoppedReason != model.AdvanceStoppedReached {
		t.Fatalf("stopped_reason = %q, want reached", res.StoppedReason)
	}
	if res.TicksPerSec <= 0 {
		t.Fatalf("ticks_per_sec = %v, want > 0", res.TicksPerSec)
	}
	if core.FastForwarding() {
		t.Fatal("fast forward flag must be cleared after Advance returns")
	}
	// 定时 tick 路径不受影响：advance 之后还能继续按原节奏推进。
	core.runScheduledTick()
	if got := core.CurrentTick(); got != start+6 {
		t.Fatalf("scheduled tick after advance = %d, want %d", got, start+6)
	}
}

// 到达目标（to_tick 形态）：推进到绝对 tick。
func TestAdvanceReachesAbsoluteTick(t *testing.T) {
	core := newE2ETestCore(t)
	start := core.CurrentTick()
	res, err := core.Advance(AdvanceSpec{ToTick: start + 7, StopOn: AdvanceStopOn{}}, nil)
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.EndTick != start+7 || res.StoppedReason != model.AdvanceStoppedReached {
		t.Fatalf("end_tick = %d (%s), want %d (reached)", res.EndTick, res.StoppedReason, start+7)
	}
}

// 对局结束停止条件：宣判后立刻停下，不跑满目标。
func TestAdvanceStopsOnGameOver(t *testing.T) {
	core := newE2ETestCore(t)
	eliminatePlayerForTest(core.World(), "p2")

	start := core.CurrentTick()
	res, err := core.Advance(AdvanceSpec{Ticks: 500, StopOn: AdvanceStopOn{GameOver: true}}, nil)
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.StoppedReason != model.AdvanceStoppedGameOver {
		t.Fatalf("stopped_reason = %q (detail=%q), want game_over", res.StoppedReason, res.Detail)
	}
	if res.EndTick >= start+500 {
		t.Fatalf("advance must stop early on game over, end_tick = %d", res.EndTick)
	}
	if !core.Finished() {
		t.Fatal("game must be finished")
	}
}

// 我方受袭停止条件：敌方单位攻击我方单位时立刻停下，detail 指明目标。
func TestAdvanceStopsOnUnderAttack(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 4)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}
	victim := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", *pos)
	victim.HP, victim.MaxHP = 100000, 100000
	attacker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: pos.X + 1, Y: pos.Y})
	attacker.Attack = 500
	attacker.HP, attacker.MaxHP = 100000, 100000
	attacker.AttackTarget = victim.ID

	res, err := core.Advance(AdvanceSpec{Ticks: 120, StopOn: AdvanceStopOn{UnderAttack: true}}, p1OwnedTargets(core))
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.StoppedReason != model.AdvanceStoppedUnderAttack {
		t.Fatalf("stopped_reason = %q (detail=%q), want under_attack", res.StoppedReason, res.Detail)
	}
	if victim.HP >= victim.MaxHP {
		t.Fatalf("victim must have taken damage, hp=%d/%d", victim.HP, victim.MaxHP)
	}
}

// 关键警报停止条件：缺电（无电网供电）的采矿机触发 power_shortage。
func TestAdvanceStopsOnCriticalAlert(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTileForType(ws, 4, model.BuildingTypeMiningMachine)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}
	miner := newBuilding("miner-alert", model.BuildingTypeMiningMachine, "p1", *pos)
	placeBuilding(ws, miner)
	// 采矿机必须覆盖到矿脉才会工作（进而因缺电进入 no_power）。
	addResourceNode(ws, "node-alert", miner.Position, 6)

	res, err := core.Advance(AdvanceSpec{Ticks: 120, StopOn: AdvanceStopOn{CriticalAlert: true}}, nil)
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.StoppedReason != model.AdvanceStoppedCriticalAlert {
		t.Fatalf("stopped_reason = %q (detail=%q), want critical_alert", res.StoppedReason, res.Detail)
	}
	if miner.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("miner state = %s, want no_power", miner.Runtime.State)
	}
}

// 显式关闭停止条件：同样的受袭场景，stop_on 全关时照常跑满目标。
func TestAdvanceStopConditionsCanBeDisabled(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 4)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}
	victim := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", *pos)
	victim.HP, victim.MaxHP = 100000, 100000
	attacker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: pos.X + 1, Y: pos.Y})
	attacker.Attack = 500
	attacker.HP, attacker.MaxHP = 100000, 100000
	attacker.AttackTarget = victim.ID

	start := core.CurrentTick()
	res, err := core.Advance(AdvanceSpec{Ticks: 40, StopOn: AdvanceStopOn{}}, p1OwnedTargets(core))
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.StoppedReason != model.AdvanceStoppedReached || res.EndTick != start+40 {
		t.Fatalf("with stop_on off the advance must reach the target, got %q at %d", res.StoppedReason, res.EndTick)
	}
	if victim.HP >= victim.MaxHP {
		t.Fatal("fixture must actually deal damage during the window")
	}
}

// 取消：长距快进被 CancelAdvance 叫停。
func TestAdvanceCancel(t *testing.T) {
	core := newE2ETestCore(t)
	start := core.CurrentTick()

	done := make(chan *AdvanceResult, 1)
	go func() {
		res, err := core.Advance(AdvanceSpec{Ticks: 20_000_000, StopOn: AdvanceStopOn{}}, nil)
		if err != nil {
			done <- nil
			return
		}
		done <- res
	}()
	if !waitFor(t, 5*time.Second, core.FastForwarding) {
		t.Fatal("advance did not start")
	}
	if !core.CancelAdvance() {
		t.Fatal("cancel must report a running advance")
	}
	select {
	case res := <-done:
		if res == nil {
			t.Fatal("advance returned error")
		}
		if res.StoppedReason != model.AdvanceStoppedCancelled {
			t.Fatalf("stopped_reason = %q, want cancelled", res.StoppedReason)
		}
		if res.EndTick >= start+20_000_000 {
			t.Fatalf("cancelled advance must stop early, end_tick = %d", res.EndTick)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("cancelled advance did not return")
	}
	// 取消后状态复位：还能再开一次。
	if core.FastForwarding() {
		t.Fatal("fast forward flag must be cleared after cancel")
	}
	if _, err := core.Advance(AdvanceSpec{Ticks: 1, StopOn: AdvanceStopOn{}}, nil); err != nil {
		t.Fatalf("advance after cancel: %v", err)
	}
}

// 快进结束事件同时写进事件历史：断线客户端重连后走 /events/snapshot 补拉也能
// 拿到「该全量刷新了」的信号（SSE 只覆盖在线订阅者）。
func TestAdvanceFinishedEventRecordedInHistory(t *testing.T) {
	core := newE2ETestCore(t)
	if _, err := core.Advance(AdvanceSpec{Ticks: 3, StopOn: AdvanceStopOn{}}, nil); err != nil {
		t.Fatalf("advance: %v", err)
	}
	if core.eventHistory == nil {
		t.Fatal("test core must have an event history")
	}
	events, _, _, _ := core.eventHistory.Snapshot(
		[]model.EventType{model.EvtFastForwardFinished}, "", 0, 10)
	if len(events) != 1 {
		t.Fatalf("event history must carry the finished event, got %d", len(events))
	}
	if reason, _ := events[0].Payload["stopped_reason"].(string); reason != model.AdvanceStoppedReached {
		t.Fatalf("finished event reason = %q", reason)
	}
}

// 并发：同一时刻只允许一个快进，第二次调用立刻返回 ErrAdvanceInProgress（不阻塞）。
func TestAdvanceRejectsConcurrentRun(t *testing.T) {
	core := newE2ETestCore(t)
	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := core.Advance(AdvanceSpec{Ticks: 20_000_000, StopOn: AdvanceStopOn{}}, nil); err != nil {
			t.Errorf("first advance: %v", err)
		}
	}()
	if !waitFor(t, 5*time.Second, core.FastForwarding) {
		t.Fatal("advance did not start")
	}

	conflict := make(chan error, 1)
	go func() {
		_, err := core.Advance(AdvanceSpec{Ticks: 1, StopOn: AdvanceStopOn{}}, nil)
		conflict <- err
	}()
	select {
	case err := <-conflict:
		if err != ErrAdvanceInProgress {
			t.Fatalf("second advance error = %v, want ErrAdvanceInProgress", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("concurrent advance must fail fast, not block")
	}

	if !core.CancelAdvance() {
		t.Fatal("cancel must report a running advance")
	}
	<-done
}

// 快进与定时 tick 完全同构：同样的种子跑同样多的 tick，世界摘要一致。
func TestAdvanceMatchesScheduledTicks(t *testing.T) {
	viaAdvance := newE2ETestCore(t)
	viaTicks := newE2ETestCore(t)

	if _, err := viaAdvance.Advance(AdvanceSpec{Ticks: 40, StopOn: AdvanceStopOn{}}, nil); err != nil {
		t.Fatalf("advance: %v", err)
	}
	for i := 0; i < 40; i++ {
		viaTicks.processTick()
	}

	got := digestRuntime(viaAdvance.world, viaAdvance.spaceRuntime)
	want := digestRuntime(viaTicks.world, viaTicks.spaceRuntime)
	if got.Hash != want.Hash {
		t.Fatalf("fast-forward must be identical to scheduled ticking:\n advance=%+v\n ticks  =%+v", got, want)
	}
}

// 快进前后存读档一致：快进后的内存状态与从该存档恢复出的状态摘要一致。
func TestAdvanceSaveLoadConsistency(t *testing.T) {
	core := newSaveStateHarness(t)

	before, err := core.ExportSaveFile("pre-advance")
	if err != nil {
		t.Fatalf("export pre-advance save: %v", err)
	}

	res, err := core.Advance(AdvanceSpec{Ticks: 25, StopOn: AdvanceStopOn{}}, nil)
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if res.StoppedReason != model.AdvanceStoppedReached {
		t.Fatalf("stopped_reason = %q, want reached", res.StoppedReason)
	}

	after, err := core.ExportSaveFile("post-advance")
	if err != nil {
		t.Fatalf("export post-advance save: %v", err)
	}
	if after.Tick != res.EndTick {
		t.Fatalf("save tick = %d, want end_tick %d", after.Tick, res.EndTick)
	}
	if before.Tick != res.StartTick {
		t.Fatalf("pre-advance save tick = %d, want start_tick %d", before.Tick, res.StartTick)
	}

	restored, err := NewFromSave(core.cfg, core.maps, queue.New(), NewEventBus(), nil, after)
	if err != nil {
		t.Fatalf("restore from post-advance save: %v", err)
	}
	if restored.CurrentTick() != core.CurrentTick() {
		t.Fatalf("restored tick = %d, want %d", restored.CurrentTick(), core.CurrentTick())
	}
	got := digestRuntime(restored.world, restored.spaceRuntime)
	want := digestRuntime(core.world, core.spaceRuntime)
	if got.Hash != want.Hash {
		t.Fatalf("save/load after fast-forward drifts:\n restored=%+v\n live    =%+v", got, want)
	}
}

// 快进期间高频事件被降采样（客户端不会被事件风暴刷屏），
// 但 fast_forward_finished 一定送达且带停止原因。
func TestAdvanceDownsamplesEvents(t *testing.T) {
	core := newE2ETestCore(t)
	ch := core.bus.Subscribe("advance-test", nil)
	defer core.bus.Unsubscribe("advance-test")

	if _, err := core.Advance(AdvanceSpec{Ticks: 120, StopOn: AdvanceStopOn{}}, nil); err != nil {
		t.Fatalf("advance: %v", err)
	}

	ticks := 0
	finished := 0
	for {
		select {
		case evt := <-ch:
			switch evt.EventType {
			case model.EvtTickCompleted:
				ticks++
			case model.EvtFastForwardFinished:
				finished++
				if evt.Tick != core.CurrentTick() {
					t.Fatalf("finished event tick = %d, want %d", evt.Tick, core.CurrentTick())
				}
				if reason, _ := evt.Payload["stopped_reason"].(string); reason != model.AdvanceStoppedReached {
					t.Fatalf("finished event reason = %q", reason)
				}
			}
		default:
			// 120 tick 若不做降采样会有 120 条 tick_completed（gap=50 时只剩 2 条）。
			if ticks > 6 {
				t.Fatalf("tick_completed must be downsampled during fast forward, got %d for 120 ticks", ticks)
			}
			if ticks == 0 {
				t.Fatal("fast forward must still emit some tick_completed progress events")
			}
			if finished != 1 {
				t.Fatalf("fast_forward_finished events = %d, want 1", finished)
			}
			return
		}
	}
}

// 降采样是纯函数：非发布 tick 丢高频、保留关键事件；发布 tick 每类型只留最后一条。
func TestDownsampleAdvanceEvents(t *testing.T) {
	moved := []*model.GameEvent{
		{EventType: model.EvtEntityMoved, Payload: map[string]any{"entity_id": "u1"}},
		{EventType: model.EvtEntityMoved, Payload: map[string]any{"entity_id": "u2"}},
		{EventType: model.EvtEntityDestroyed, Payload: map[string]any{"entity_id": "b1"}},
	}
	// tick 3 不是发布 tick：高频全丢，关键事件保留。
	out := downsampleAdvanceEvents(moved, 3)
	if len(out) != 1 || out[0].EventType != model.EvtEntityDestroyed {
		t.Fatalf("non-publish tick must drop throttled events, got %d", len(out))
	}
	// tick 10 是发布 tick：entity_moved 只留最后一条。
	out = downsampleAdvanceEvents(moved, 10)
	if len(out) != 2 {
		t.Fatalf("publish tick must coalesce per type, got %d", len(out))
	}
	if id, _ := out[0].Payload["entity_id"].(string); id != "u2" {
		t.Fatalf("coalescing must keep the latest event, got %q", id)
	}
	// tick_completed 只在每 advanceTickCompletedGap 个 tick 上发布。
	done := []*model.GameEvent{{EventType: model.EvtTickCompleted}}
	if out := downsampleAdvanceEvents(done, 10); len(out) != 0 {
		t.Fatalf("tick_completed on a non-milestone publish tick must be dropped, got %d", len(out))
	}
	if out := downsampleAdvanceEvents(done, 50); len(out) != 1 {
		t.Fatalf("tick_completed on a milestone tick must be kept, got %d", len(out))
	}
}

// 我方目标展开：只收编指定玩家的建筑与单位。
func TestAdvanceOwnedTargetsScoping(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	pos, err := findOpenTile(ws, 4)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}
	p1Unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", *pos)
	p2Unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: pos.X + 2, Y: pos.Y})

	owned := core.AdvanceOwnedTargets(map[string]struct{}{"p1": {}})
	if _, ok := owned[p1Unit.ID]; !ok {
		t.Fatalf("p1 unit %s must be an owned target", p1Unit.ID)
	}
	if _, ok := owned[p2Unit.ID]; ok {
		t.Fatalf("p2 unit %s must not be an owned target", p2Unit.ID)
	}
}
