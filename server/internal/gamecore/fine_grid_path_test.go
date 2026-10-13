package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 细分网格（§1）的寻路验收：世界边长 ×3 后，跨基地（遭遇战 face 288 上两基地
// 相距 ~180 cell）仍必须一次寻路可达，且路径不穿建筑占地。
// 设计文档要求「寻路预算（800 → 按实测放大，保证跨基地寻路仍可用）」，
// 这里的断言 + BenchmarkFineGridCrossBasePath 就是那次放大的验收。
func TestFineGridCrossBasePathingOnSkirmishGrid(t *testing.T) {
	core := newSkirmishCoreForBench(t)
	ws := core.World()
	p1Home := botPlayerHQQuiet(ws, "p1").Position
	p2Home := botPlayerHQQuiet(ws, "p2").Position
	from := model.Position{X: p2Home.X - 3, Y: p2Home.Y - 8}

	dist := ws.SurfaceDistance(from, p1Home)
	if dist < 150 {
		t.Fatalf("cross-base surface distance = %d, want >= 150 on the x3 grid", dist)
	}
	path, ok := computeUnitPath(ws, from, p1Home, "")
	if !ok {
		t.Fatalf("no cross-base path from %+v to %+v (surface distance %d)", from, p1Home, dist)
	}
	if len(path) < 2 {
		t.Fatalf("path too short: %d", len(path))
	}
	// 路径必须真的走完（终点落在基地邻域），而不是半路截断。
	if end := path[len(path)-1]; ws.SurfaceDistance(end, p1Home) > 2 {
		t.Fatalf("path ended %d cells short of the target base", ws.SurfaceDistance(end, p1Home))
	}
	// 单次 move 的路径上限必须容得下跨基地路线。
	if len(path) > maxMoveRouteTiles {
		t.Fatalf("cross-base path %d tiles exceeds maxMoveRouteTiles %d", len(path), maxMoveRouteTiles)
	}
	// 路径不得穿过任何建筑占地。
	for _, tile := range path {
		if id := ws.TileBuilding[model.TileKey(tile.X, tile.Y)]; id != "" {
			t.Fatalf("path enters building footprint %s at %+v", id, tile)
		}
	}
}

// newSkirmishCoreForBench 与 newSkirmishCoreForSeed 相同，供测试与基准共用。
func newSkirmishCoreForBench(tb testing.TB) *GameCore {
	tb.Helper()
	cfg, err := config.Load("../../config-skirmish.yaml")
	if err != nil {
		tb.Fatal(err)
	}
	cfg.Battlefield.MapSeed = "skirmish-seed-001"
	mapCfg, err := mapconfig.Load("../../map-skirmish.yaml")
	if err != nil {
		tb.Fatal(err)
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	return core
}

// BenchmarkFineGridCrossBasePath 跨基地寻路在 ×3 网格上的耗时：
// 世界生成（face 288）不计入计时，只量一次完整 BFS + 回溯。
func BenchmarkFineGridCrossBasePath(b *testing.B) {
	core := newSkirmishCoreForBench(b)
	ws := core.World()
	p1Home := botPlayerHQQuiet(ws, "p1").Position
	p2Home := botPlayerHQQuiet(ws, "p2").Position
	from := model.Position{X: p2Home.X - 3, Y: p2Home.Y - 8}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, ok := computeUnitPath(ws, from, p1Home, ""); !ok {
			b.Fatal("cross-base path not found")
		}
	}
}

// BenchmarkFineGridShortPath 近距寻路（细分网格把"近距"阈值从 12 提到 36）的耗时。
func BenchmarkFineGridShortPath(b *testing.B) {
	core := newSkirmishCoreForBench(b)
	ws := core.World()
	home := botPlayerHQQuiet(ws, "p2").Position
	from := model.Position{X: home.X - 3, Y: home.Y - 8}
	to := model.Position{X: from.X + 20, Y: from.Y + 12}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		computeUnitPath(ws, from, to, "")
	}
}
