package gamecore

import (
	"fmt"
	"strings"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// newEnclosureTestCore 一张全是 buildable 的小行星，p1 有一台机甲和 2000 矿。
func newEnclosureTestCore(t *testing.T) *GameCore {
	t.Helper()
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Minerals = 5000
	player.Resources.Energy = 5000
	grantAllItems(ws, "p1", 200)
	// 清掉自动生成的地形障碍，保证测试里的建造位置可控。
	for y := range ws.Grid {
		for x := range ws.Grid[y] {
			ws.Grid[y][x].Terrain = terrain.TileBuildable
		}
	}
	return core
}

// findExecutorUnit 返回 p1 的机甲实体。
func findExecutorUnit(t *testing.T, ws *model.WorldState) *model.Unit {
	t.Helper()
	state := ws.Players["p1"].ExecutorForPlanet(ws.PlanetID)
	if state == nil {
		t.Fatal("expected p1 executor state")
	}
	unit := ws.Units[state.UnitID]
	if unit == nil {
		t.Fatalf("expected executor unit %s", state.UnitID)
	}
	return unit
}

// buildAt 下达一次建造并立即完成（跳过施工时长），返回命令结果。
func buildAt(t *testing.T, core *GameCore, ws *model.WorldState, pos model.Position, btype model.BuildingType) model.CommandResult {
	t.Helper()
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &pos},
		Payload: map[string]any{
			"building_type": string(btype),
		},
	})
	return res
}

// 建造不能把己方地面单位（含机甲）四邻全堵死（试玩报告新问题 #5：
// 玩家机甲被自家建筑围死，只能拆家自救）。
func TestBuildRejectsEnclosingFriendlyUnit(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	mecha := findExecutorUnit(t, ws)

	// 先把机甲挪到一块空地（四邻可建）。
	target := model.Position{X: 20, Y: 20}
	if res, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: mecha.ID, Position: &target}}); res.Code != model.CodeOK {
		t.Fatalf("move mecha: %s (%s)", res.Code, res.Message)
	}
	for mecha.Position != target {
		ws.Tick++
		settleUnitMovement(ws)
	}
	// 机甲四周先建 3 座风机，第 4 座必须被拒绝。
	neighbors := ws.SurfaceNeighbors(target)
	if len(neighbors) != 4 {
		t.Fatalf("expected 4 neighbors, got %d", len(neighbors))
	}
	for i := 0; i < 3; i++ {
		res := buildAt(t, core, ws, neighbors[i], model.BuildingTypeWindTurbine)
		if res.Code != model.CodeOK {
			t.Fatalf("build %d at %+v: %s (%s)", i, neighbors[i], res.Code, res.Message)
		}
	}
	res := buildAt(t, core, ws, neighbors[3], model.BuildingTypeWindTurbine)
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("enclosing build must be rejected, got %s (%s)", res.Code, res.Message)
	}
	if res.Message == "" || !containsChinese(res.Message) {
		t.Fatalf("rejection must carry a Chinese explanation, got %q", res.Message)
	}
	// 回执要具体：写明被围单位的名称与坐标，以及最后被堵死的那个出口（试玩报告 H）。
	if !strings.Contains(res.Message, "机甲") {
		t.Fatalf("rejection must name the enclosed unit, got %q", res.Message)
	}
	if !strings.Contains(res.Message, fmt.Sprintf("（%d,%d）", target.X, target.Y)) {
		t.Fatalf("rejection must carry the enclosed unit's coordinates, got %q", res.Message)
	}
	if !strings.Contains(res.Message, "最后一个出口") ||
		!strings.Contains(res.Message, fmt.Sprintf("（%d,%d）", neighbors[3].X, neighbors[3].Y)) {
		t.Fatalf("rejection must name the last blocked exit %+v, got %q", neighbors[3], res.Message)
	}
}

// 堵死的是敌方单位时同样拒绝（避免"把敌人围死"这种取巧玩法）。
func TestBuildRejectsEnclosingEnemyUnit(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 24, Y: 24})
	neighbors := ws.SurfaceNeighbors(enemy.Position)
	for i := 0; i < 3; i++ {
		res := buildAt(t, core, ws, neighbors[i], model.BuildingTypeWindTurbine)
		if res.Code != model.CodeOK {
			t.Fatalf("build %d at %+v: %s (%s)", i, neighbors[i], res.Code, res.Message)
		}
	}
	res := buildAt(t, core, ws, neighbors[3], model.BuildingTypeWindTurbine)
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("enclosing an enemy unit must be rejected, got %s (%s)", res.Code, res.Message)
	}
}

// 空地建造不受影响（单位四邻还有空格，或根本没有单位）。
func TestBuildAllowsNonEnclosingPlacement(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	mecha := findExecutorUnit(t, ws)
	pos := model.Position{X: 30, Y: 24}
	if res, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: mecha.ID, Position: &pos}}); res.Code != model.CodeOK {
		t.Fatalf("move mecha: %s", res.Code)
	}
	for mecha.Position != pos {
		ws.Tick++
		settleUnitMovement(ws)
	}
	// 只在机甲的一个邻格建造：还剩 3 个出口，必须允许。
	res := buildAt(t, core, ws, ws.SurfaceNeighbors(pos)[0], model.BuildingTypeWindTurbine)
	if res.Code != model.CodeOK {
		t.Fatalf("non-enclosing build rejected: %s (%s)", res.Code, res.Message)
	}
	// 远离任何单位的空地也允许（保持在机甲作业范围内）。
	free := ws.SurfaceOffset(pos, 2, 0)
	res = buildAt(t, core, ws, free, model.BuildingTypeWindTurbine)
	if res.Code != model.CodeOK {
		t.Fatalf("free-tile build rejected: %s (%s)", res.Code, res.Message)
	}
}

func containsChinese(s string) bool {
	for _, r := range s {
		if r >= 0x4e00 && r <= 0x9fff {
			return true
		}
	}
	return false
}

// 口袋（连通区）判定：用半径 2 的一整圈建筑把机甲围成 3×3 口袋，内圈全空、
// 四邻都有路，只有"整块区域走不出去"的口袋判定能拦住最后一块。
// 这正是试玩报告 D 的根因（bot 用一圈建筑把自家基地封成 11 格口袋，执行体回不了家）。
func TestBuildRejectsSealingUnitIntoPocket(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	mecha := findExecutorUnit(t, ws)
	target := model.Position{X: 20, Y: 20}
	if res, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: mecha.ID, Position: &target}}); res.Code != model.CodeOK {
		t.Fatalf("move mecha: %s (%s)", res.Code, res.Message)
	}
	for mecha.Position != target {
		ws.Tick++
		settleUnitMovement(ws)
	}
	// 机甲的主基地（家）：口袋判定只保护"回得了家"的单位。
	home, ok := botHomePosition(ws, "p1")
	if !ok {
		t.Fatal("expected p1 home base")
	}
	ring := ws.SurfaceDisc(target, 2)
	rejected := false
	for _, tile := range ring {
		if ws.SurfaceDistance(tile, target) != 2 {
			continue
		}
		res := buildAt(t, core, ws, tile, model.BuildingTypeWindTurbine)
		if res.Code == model.CodeOK {
			continue
		}
		if res.Code != model.CodeInvalidTarget {
			t.Fatalf("build wall at %+v: %s (%s)", tile, res.Code, res.Message)
		}
		// 最后一块被拦下：必须是口袋形态的回执，并点名机甲与坐标。
		if !strings.Contains(res.Message, "机甲") || !strings.Contains(res.Message, "（20,20）") {
			t.Fatalf("rejection must name the trapped unit and its coordinates, got %q", res.Message)
		}
		rejected = true
		break
	}
	if !rejected {
		t.Fatalf("sealing build must be rejected once the pocket closes (home=%+v)", home)
	}
	// 口袋判定不影响远离任何单位/基地的空地建造。
	free := ws.SurfaceOffset(target, 4, 0)
	if res := buildAt(t, core, ws, free, model.BuildingTypeWindTurbine); res.Code != model.CodeOK {
		t.Fatalf("free-tile build must stay allowed: %s (%s)", res.Code, res.Message)
	}
}
