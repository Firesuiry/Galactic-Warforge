package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

// roundTripSkirmishCore 把当前对局导出成存档、再读回来（与真实读档同路径）。
func roundTripSkirmishCore(t *testing.T, core *GameCore) *GameCore {
	t.Helper()
	save, err := core.ExportSaveFile("test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	raw, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal save: %v", err)
	}
	var decoded gamedir.SaveFile
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal save: %v", err)
	}
	mapCfg, err := mapconfig.Load("../../map-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	maps := mapgen.Generate(mapCfg, core.cfg.Battlefield.MapSeed)
	restored, err := NewFromSave(core.cfg, maps, queue.New(), NewEventBus(), nil, &decoded)
	if err != nil {
		t.Fatalf("restore from save: %v", err)
	}
	return restored
}

// 细分网格后 tick 0 快照的体积上限（软上限默认 2MB）。
//
// 回归背景：网格边长 ×3 后世界状态整体 ×9，整幅地形（49.8 万格）与全部资源节点
// （3.4 万个）的静态字段一度被整表写进快照，tick 0 就有 57MB，自动存档/存档点/
// 读档全被拖垮。地形只由地图配置 + seed 决定、资源静态字段同理，因此快照只存
// 「地形非 buildable 格的行内游程」与「与资源基线的差异」。
const skirmishSnapshotBudgetBytes = 2 * 1024 * 1024

func TestFineGridSnapshotStaysWithinBudget(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	snap := snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime)
	data, err := snapshot.Encode(snap)
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	if int64(len(data)) > skirmishSnapshotBudgetBytes {
		t.Fatalf("tick 0 快照 %d 字节超过软上限 %d：地形/资源静态字段又被整表写进快照了",
			len(data), skirmishSnapshotBudgetBytes)
	}
	t.Logf("tick 0 快照 %d 字节（预算 %d）", len(data), skirmishSnapshotBudgetBytes)
}

// 存档 → 读档后世界必须等价：地形、资源节点（含被开采后变化的 remaining/
// current_yield）、建筑/单位占用、可再生索引都要逐项一致。
//
// 回归背景：地形与资源静态字段不再逐格进快照（只存地形游程与资源差异），
// 一旦基线重建的口径和 mapgen + bootstrap 注入的不一致，读档就会悄悄少掉整批
// 资源节点（曾实测 34404 → 3047）或把地形抹平——两个都会让对局静默走样。
func TestSaveRestoreKeepsWorldEquivalent(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	// 跑到矿机真的在采矿、bot 也建了东西的时点，remaining/current_yield 有真实变化。
	for ws.Tick < 3000 {
		core.processTick()
	}
	restored := roundTripSkirmishCore(t, core).World()

	if restored.Tick != ws.Tick {
		t.Fatalf("tick 不一致：读档 %d != 原局 %d", restored.Tick, ws.Tick)
	}
	if restored.MapWidth != ws.MapWidth || restored.MapHeight != ws.MapHeight {
		t.Fatalf("地图尺寸不一致：读档 %dx%d != 原局 %dx%d",
			restored.MapWidth, restored.MapHeight, ws.MapWidth, ws.MapHeight)
	}

	// 1) 地形逐格一致，且格子上的资源/建筑占用引用一致。
	for y := 0; y < ws.MapHeight; y++ {
		for x := 0; x < ws.MapWidth; x++ {
			got, want := restored.Grid[y][x], ws.Grid[y][x]
			if got.Terrain != want.Terrain {
				t.Fatalf("地形不一致 (%d,%d)：读档 %s != 原局 %s", x, y, got.Terrain, want.Terrain)
			}
			if got.ResourceNodeID != want.ResourceNodeID {
				t.Fatalf("格子资源引用不一致 (%d,%d)：读档 %q != 原局 %q",
					x, y, got.ResourceNodeID, want.ResourceNodeID)
			}
			if got.BuildingID != want.BuildingID {
				t.Fatalf("格子建筑引用不一致 (%d,%d)：读档 %q != 原局 %q",
					x, y, got.BuildingID, want.BuildingID)
			}
		}
	}

	// 2) 资源节点逐个字段一致（这条覆盖"读档少一批节点"与"静态字段丢失"）。
	if len(restored.Resources) != len(ws.Resources) {
		t.Fatalf("资源节点数不一致：读档 %d != 原局 %d", len(restored.Resources), len(ws.Resources))
	}
	changed := 0
	for id, want := range ws.Resources {
		got := restored.Resources[id]
		if got == nil {
			t.Fatalf("读档丢了资源节点 %s（kind=%s pos=%+v）", id, want.Kind, want.Position)
		}
		if *got != *want {
			t.Fatalf("资源节点 %s 不一致：\n读档 %+v\n原局 %+v", id, *got, *want)
		}
		if want.Remaining != want.MaxAmount || want.CurrentYield != want.BaseYield {
			changed++
		}
	}
	if changed == 0 {
		t.Fatal("跑到 3000 tick 仍无任何资源节点被改动：测试夹具失效（差异编码未被覆盖）")
	}

	// 3) 可再生索引重建后数量一致（每 tick 的再生结算只扫这张表）。
	if len(restored.RenewableResources) != len(ws.RenewableResources) {
		t.Fatalf("可再生矿脉索引不一致：读档 %d != 原局 %d",
			len(restored.RenewableResources), len(ws.RenewableResources))
	}

	// 4) 建筑与单位一致。
	if len(restored.Buildings) != len(ws.Buildings) || len(restored.Units) != len(ws.Units) {
		t.Fatalf("建筑/单位数不一致：读档 %d/%d != 原局 %d/%d",
			len(restored.Buildings), len(restored.Units), len(ws.Buildings), len(ws.Units))
	}
	for id, want := range ws.Buildings {
		got := restored.Buildings[id]
		if got == nil || got.Type != want.Type || got.OwnerID != want.OwnerID || got.Position != want.Position {
			t.Fatalf("建筑 %s 不一致：读档 %+v 原局 %+v", id, got, want)
		}
	}
	for id, want := range ws.Units {
		got := restored.Units[id]
		if got == nil || got.Type != want.Type || got.OwnerID != want.OwnerID || got.Position != want.Position {
			t.Fatalf("单位 %s 不一致：读档 %+v 原局 %+v", id, got, want)
		}
	}
	t.Logf("tick=%d 资源 %d 个（其中 %d 个已偏离基线）建筑 %d 单位 %d 读档后逐项一致",
		ws.Tick, len(ws.Resources), changed, len(ws.Buildings), len(ws.Units))
}

// 存档体积不能随世界推进回涨：跑一段后再存，体积仍要在预算内。
func TestFineGridSnapshotStaysWithinBudgetMidGame(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	for ws.Tick < 6000 {
		core.processTick()
	}
	// 二次读档再存：读档后重建的地图资源 id 必须重新标记为"基线内"，
	// 否则下一次存档会把 3.4 万个资源节点整份写回（实测 0.8MB → 17MB）。
	core = roundTripSkirmishCore(t, core)
	snap := snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime)
	data, err := snapshot.Encode(snap)
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	if int64(len(data)) > skirmishSnapshotBudgetBytes {
		t.Fatalf("读档后再存档 %d 字节超过软上限 %d：资源节点被整份写回快照了",
			len(data), skirmishSnapshotBudgetBytes)
	}
	t.Logf("读档后再存档 %d 字节（预算 %d）", len(data), skirmishSnapshotBudgetBytes)
}

// 从磁盘读回来的快照（基线快照 / 存档点 / 回滚 / 回放的起点）也要能还原资源：
// ResourceBaseline 标了 json:"-"，JSON 往返后为空，必须由地图模型重新挂上，
// 否则恢复出来的世界一个资源节点都没有（矿机全部空转）。
func TestSnapshotFromJSONRestoresResourcesWithAttachedBaseline(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()
	for ws.Tick < 1500 {
		core.processTick()
	}
	// 走一次 JSON 往返：模拟磁盘快照 / 存档点里的基线快照。
	raw, err := json.Marshal(snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime))
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	decoded, err := snapshot.Decode(raw)
	if err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if decoded.World.ResourceBaseline != nil {
		t.Fatal("JSON 往返后不该带资源基线（json:\"-\"）：测试夹具失效")
	}
	mapCfg, err := mapconfig.Load("../../map-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	maps := mapgen.Generate(mapCfg, core.cfg.Battlefield.MapSeed)
	attachSnapshotResourceBaseline(decoded, maps)
	worlds, activePlanetID, _, err := decoded.RestoreRuntime()
	if err != nil {
		t.Fatalf("restore runtime: %v", err)
	}
	restored := worlds[activePlanetID]
	if restored == nil {
		t.Fatal("active world missing after restore")
	}
	if len(restored.Resources) != len(ws.Resources) {
		t.Fatalf("JSON 快照恢复后资源节点数 %d != 原局 %d（基线没挂上）",
			len(restored.Resources), len(ws.Resources))
	}
	for id, want := range ws.Resources {
		got := restored.Resources[id]
		if got == nil || *got != *want {
			t.Fatalf("资源节点 %s 不一致：读档 %+v 原局 %+v", id, got, want)
		}
	}
	t.Logf("JSON 快照 + 挂基线后恢复 %d 个资源节点，逐项一致", len(restored.Resources))
}
