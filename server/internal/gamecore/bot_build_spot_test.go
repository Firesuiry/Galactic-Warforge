package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// bot 选址复用围死校验（试玩报告 I）：会围死地面单位的格子要提前跳过，
// 不能反复发注定被拒的建造命令。
func TestBotBuildSpotAvoidsEnclosingTile(t *testing.T) {
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
	// 机甲四周先建 3 座风机，第 4 格成了唯一出口。
	neighbors := ws.SurfaceNeighbors(target)
	for i := 0; i < 3; i++ {
		b := newBuilding("wind-"+model.TileKey(neighbors[i].X, neighbors[i].Y), model.BuildingTypeWindTurbine, "p1", neighbors[i])
		b.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, b)
	}
	lastExit := neighbors[3]
	// 从远处扫描：选址必须跳过这个"最后一个出口"。
	pos := botBuildSpotNear(ws, target, 12, model.BuildingTypeWindTurbine)
	if pos == nil {
		t.Fatal("bot must find another build spot instead of the enclosing tile")
	}
	if *pos == lastExit {
		t.Fatalf("bot picked the tile that would enclose the mecha at %+v", lastExit)
	}
	if buildingEnclosure(ws, model.BuildingTypeWindTurbine, model.PlanRotation0, *pos) != nil {
		t.Fatalf("bot picked a spot that would enclose a unit: %+v", *pos)
	}
}

// 没有任何围死风险时，选址照常返回最近的空位（不因新校验退化）。
func TestBotBuildSpotStillFindsOpenTile(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	home := model.Position{X: 20, Y: 20}
	pos := botBuildSpotNear(ws, home, 8, model.BuildingTypeWindTurbine)
	if pos == nil {
		t.Fatal("open field must yield a build spot")
	}
	if ws.SurfaceDistance(home, *pos) > 8 {
		t.Fatalf("spot %+v out of scan radius", *pos)
	}
}
