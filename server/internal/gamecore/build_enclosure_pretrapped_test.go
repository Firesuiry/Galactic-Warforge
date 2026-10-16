package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 早已被困住的单位（四邻在本次建造前就全堵）不能连累别处的建造：
// 围死判定只看**本次落点**新堵上的出口。
//
// 真 bug：第一遍判定漏了「本次建造是否真的堵上了出口」这一条，于是全图任何一处
// 建造都会被那台旧单位拒掉。实测 bot 长跑里一台步兵被自家建筑困住后，p2 的每一次
// 建造都回 INVALID_TARGET，产业彻底冻结（TestPhase1BotIndustrialCycle 从 74s
// 涨到 >600s 超时）。
func TestPreTrappedUnitDoesNotBlockUnrelatedBuilds(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 40, Y: 40})

	// 用已存在的建筑把它围死（绕过建造命令的校验，模拟"命令下达后单位走进
	// 即将合拢的口袋"这种真实路径）。
	for _, n := range ws.SurfaceNeighbors(unit.Position) {
		placeBuilding(ws, newBuilding(ws.NextEntityID("b"), model.BuildingTypeConveyorBeltMk1, "p1", n))
	}
	blocked := 0
	for _, n := range ws.SurfaceNeighbors(unit.Position) {
		if unitTileBlockedBeforeBuild(ws, n) {
			blocked++
		}
	}
	if blocked != len(ws.SurfaceNeighbors(unit.Position)) {
		t.Fatalf("夹具前置：单位应已被完全堵死，got %d/%d", blocked, len(ws.SurfaceNeighbors(unit.Position)))
	}

	// 远处空地的建造与那台单位无关，必须照常放行。
	far := model.Position{X: 44, Y: 40}
	if info := buildingEnclosure(ws, model.BuildingTypeConveyorBeltMk1, model.PlanRotation0, far); info != nil {
		t.Fatalf("远处落点不该被旧单位连累，got %s", enclosureMessage(info))
	}
	if res := buildAt(t, core, ws, far, model.BuildingTypeConveyorBeltMk1); res.Code != model.CodeOK {
		t.Fatalf("远处建造应放行，got %s (%s)", res.Code, res.Message)
	}

	// 而**真的**把一台单位的最后一个出口堵上时仍然要拒（判定不能被削弱）：
	// 另起一台干净的步兵，先堵三面，第四面必须被拒。
	other := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 50, Y: 40})
	neighbors := ws.SurfaceNeighbors(other.Position)
	if len(neighbors) != 4 {
		t.Fatalf("expected 4 neighbors, got %d", len(neighbors))
	}
	for i := 0; i < 3; i++ {
		if res := buildAt(t, core, ws, neighbors[i], model.BuildingTypeConveyorBeltMk1); res.Code != model.CodeOK {
			t.Fatalf("先堵第 %d 面应放行，got %s (%s)", i+1, res.Code, res.Message)
		}
	}
	res := buildAt(t, core, ws, neighbors[3], model.BuildingTypeConveyorBeltMk1)
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("堵死最后一个出口仍必须被拒，got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "最后一个出口") {
		t.Fatalf("回执应点名最后出口，got %q", res.Message)
	}
}
