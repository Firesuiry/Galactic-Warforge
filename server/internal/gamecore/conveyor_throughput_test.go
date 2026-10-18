package gamecore

import (
	"strconv"
	"testing"

	"siliconworld/internal/model"
)

// 第 19 轮契约 §2：传送带分档稳态吞吐回归。
//
// 夹具：30 格直带（x=0..29，向东），源头每 tick 尽量塞满（塞到带子容量为止），
// 尾端每 tick 全部取走（无限吸收）。跑 600 tick，只统计后 300 tick 从尾端取走的
// 件数 / 300 = 件/tick。比例断言 mk1 : mk2 : mk3 = 1 : 2 : 5（±10%）。
//
// 同时统计守恒量：塞入的总件数 == 尾端取走的 + 结束时刻还留在带上的。
// 结算改成「流水线口径」（送出即腾位，见 settleConveyors 注释）后，吞吐不再依赖
// stack_limit 放大，所以还有 TestConveyorThroughputSurvivesTightStackLimit 守着
// 「stack_limit 只留物理余量」这件事。

const (
	beltThroughputCells = 30
	beltThroughputTicks = 600
	beltMeasureFrom     = 300
)

type beltThroughputResult struct {
	perTick float64
	total   int
	// 守恒量：inserted == drained + onBelt。
	inserted int
	drained  int
	onBelt   int
}

// measureBeltThroughput 返回后 300 tick 的稳态吞吐（件/tick）。
func measureBeltThroughput(t *testing.T, btype model.BuildingType, mixed bool) beltThroughputResult {
	t.Helper()
	return measureBeltThroughputWithStack(t, btype, mixed, 0)
}

// measureBeltThroughputWithStack 同上，stackOverride > 0 时把每格 stack_limit 压到该值
// （用来验证吞吐只受 throughput 约束，不再被 stack_limit/2 卡住）。
func measureBeltThroughputWithStack(t *testing.T, btype model.BuildingType, mixed bool, stackOverride int) beltThroughputResult {
	t.Helper()
	ws := model.NewWorldState("planet-1", beltThroughputCells)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	belts := make([]*model.Building, 0, beltThroughputCells)
	for x := 0; x < beltThroughputCells; x++ {
		belt := newConveyorBuildingOfType("belt-"+strconv.Itoa(x), btype, model.Position{X: x, Y: 0}, model.ConveyorEast)
		if stackOverride > 0 {
			belt.Conveyor.MaxStack = stackOverride
		}
		attachBuilding(ws, belt)
		belts = append(belts, belt)
	}
	head, tail := belts[0], belts[len(belts)-1]

	sink := 0
	inserted := 0
	drained := 0
	for tick := int64(0); tick < beltThroughputTicks; tick++ {
		ws.Tick = tick
		// 源头持续塞满：塞到这一格再也放不下为止。
		for {
			item := model.ItemIronOre
			if mixed && (tick+int64(head.Conveyor.TotalItems()))%2 == 1 {
				item = model.ItemCopperOre
			}
			accepted, _, err := head.Conveyor.Insert(item, 1)
			if err != nil {
				t.Fatalf("insert into belt head: %v", err)
			}
			if accepted <= 0 {
				break
			}
			inserted += accepted
		}
		settleConveyors(ws)
		// 尾端无限吸收。
		taken := tail.Conveyor.Take(tail.Conveyor.TotalItems())
		moved := countStacks(taken)
		drained += moved
		if tick >= beltMeasureFrom {
			sink += moved
		}
	}
	onBelt := 0
	for _, belt := range belts {
		onBelt += belt.Conveyor.TotalItems()
	}
	return beltThroughputResult{
		perTick:  float64(sink) / float64(beltThroughputTicks-beltMeasureFrom),
		total:    sink,
		inserted: inserted,
		drained:  drained,
		onBelt:   onBelt,
	}
}

// assertBeltLineConserved 断言「塞入 = 抽走 + 还留在带上」（不丢件、不复制件）。
func assertBeltLineConserved(t *testing.T, label string, res beltThroughputResult) {
	t.Helper()
	if res.inserted != res.drained+res.onBelt {
		t.Fatalf("%s: items not conserved: inserted=%d drained=%d onBelt=%d", label, res.inserted, res.drained, res.onBelt)
	}
}

func newConveyorBuildingOfType(id string, btype model.BuildingType, pos model.Position, output model.ConveyorDirection) *model.Building {
	profile := model.BuildingProfileFor(btype, 1)
	b := &model.Building{
		ID:          id,
		Type:        btype,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b)
	b.Conveyor.Output = output
	b.Conveyor.Input = output.Opposite()
	b.Runtime.State = model.BuildingWorkRunning
	return b
}

// TestConveyorTierThroughputRatio 固化分档吞吐比例 1 : 2 : 5。
func TestConveyorTierThroughputRatio(t *testing.T) {
	mk1 := measureBeltThroughput(t, model.BuildingTypeConveyorBeltMk1, false)
	mk2 := measureBeltThroughput(t, model.BuildingTypeConveyorBeltMk2, false)
	mk3 := measureBeltThroughput(t, model.BuildingTypeConveyorBeltMk3, false)
	mixed := measureBeltThroughput(t, model.BuildingTypeConveyorBeltMk3, true)
	t.Logf("steady-state throughput: mk1=%.3f mk2=%.3f mk3=%.3f mixed_mk3=%.3f items/tick",
		mk1.perTick, mk2.perTick, mk3.perTick, mixed.perTick)

	if mk1.perTick <= 0 {
		t.Fatalf("mk1 throughput must be positive, got %.3f", mk1.perTick)
	}
	if ratio := mk2.perTick / mk1.perTick; ratio < 1.8 || ratio > 2.2 {
		t.Fatalf("mk2/mk1 throughput = %.3f, want 2±10%% (mk1=%.3f mk2=%.3f)", ratio, mk1.perTick, mk2.perTick)
	}
	if ratio := mk3.perTick / mk1.perTick; ratio < 4.5 || ratio > 5.5 {
		t.Fatalf("mk3/mk1 throughput = %.3f, want 5±10%% (mk1=%.3f mk3=%.3f)", ratio, mk1.perTick, mk3.perTick)
	}
	// 混合物品带子不能因为分流启发式降速。
	if ratio := mixed.perTick / mk3.perTick; ratio < 0.9 {
		t.Fatalf("mixed-item belt throughput %.3f is below 90%% of single-item mk3 %.3f", mixed.perTick, mk3.perTick)
	}
	// 每条带子（含混带）都要守恒：塞入 = 抽走 + 还留在带上。
	assertBeltLineConserved(t, "mk1", mk1)
	assertBeltLineConserved(t, "mk2", mk2)
	assertBeltLineConserved(t, "mk3", mk3)
	assertBeltLineConserved(t, "mixed_mk3", mixed)
}

// TestConveyorThroughputSurvivesTightStackLimit 守住「吞吐只由 throughput 决定」：
// stack_limit 只留物理余量（throughput+1）时，稳态吞吐一点都不能掉。
// 旧口径（每格接收容量按 tick 初缓冲算，送出腾出的位不记回）下这里是 min(throughput,
// stack_limit/2)，mk3 会从 5 掉到 3 —— 这条用例就是拦这个回归的。
func TestConveyorThroughputSurvivesTightStackLimit(t *testing.T) {
	for _, tc := range []struct {
		btype model.BuildingType
		want  float64
	}{
		{model.BuildingTypeConveyorBeltMk1, 1},
		{model.BuildingTypeConveyorBeltMk2, 2},
		{model.BuildingTypeConveyorBeltMk3, 5},
	} {
		stack := int(tc.want) + 1
		got := measureBeltThroughputWithStack(t, tc.btype, false, stack)
		t.Logf("stack_limit=%d: %s -> %.3f items/tick", stack, tc.btype, got.perTick)
		if got.perTick < tc.want*0.95 || got.perTick > tc.want*1.05 {
			t.Fatalf("%s with stack_limit=%d (throughput+1): %.3f items/tick, want %.3f±5%%",
				tc.btype, stack, got.perTick, tc.want)
		}
		assertBeltLineConserved(t, string(tc.btype), got)
	}
}
