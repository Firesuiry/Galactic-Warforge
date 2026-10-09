package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 试玩报告 G：同格重复建造的回执要区分「你的施工任务 / 你的建筑 / 别人的建筑」。
func TestBuildReceiptDistinguishesOccupancy(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	pos := model.Position{X: 24, Y: 24}

	// 1) 第一次建造成功 → 该格成了"你的施工任务"。
	res := buildAt(t, core, ws, pos, model.BuildingTypeWindTurbine)
	if res.Code != model.CodeOK {
		t.Fatalf("first build: %s (%s)", res.Code, res.Message)
	}
	res = buildAt(t, core, ws, pos, model.BuildingTypeWindTurbine)
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("repeat build must be rejected as occupied, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "该格已有你的施工任务") || !strings.Contains(res.Message, "风力涡轮机") {
		t.Fatalf("repeat build must name the player's own pending task, got %q", res.Message)
	}

	// 2) 施工完成 → 该格成了"你的建筑"。
	taskID := ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)]
	if taskID == "" {
		t.Fatal("expected the tile to be reserved by the pending task")
	}
	task := ws.Construction.Tasks[taskID]
	building := newBuilding("wind-g", task.BuildingType, "p1", pos)
	building.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, building)
	ws.Construction.Remove(taskID)
	res = buildAt(t, core, ws, pos, model.BuildingTypeWindTurbine)
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("build on own building must be rejected as occupied, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "该格已有你的建筑") {
		t.Fatalf("build on own building must say so, got %q", res.Message)
	}

	// 3) 别人的建筑。
	enemy := newBuilding("wind-enemy-g", model.BuildingTypeWindTurbine, "p2", model.Position{X: 26, Y: 24})
	enemy.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, enemy)
	res = buildAt(t, core, ws, enemy.Position, model.BuildingTypeWindTurbine)
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("build on an enemy building must be rejected, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "该格已有其他玩家的建筑") {
		t.Fatalf("build on an enemy building must say so, got %q", res.Message)
	}

	// 4) 别人的施工任务。
	enemyTask := &model.ConstructionTask{
		ID:           "c-enemy-g",
		PlayerID:     "p2",
		RegionID:     constructionRegionKey(ws, model.Position{X: 28, Y: 24}),
		BuildingType: model.BuildingTypeWindTurbine,
		Position:     model.Position{X: 28, Y: 24},
		State:        model.ConstructionPending,
	}
	if err := ws.Construction.Enqueue(ws, enemyTask); err != nil {
		t.Fatalf("enqueue enemy task: %v", err)
	}
	res = buildAt(t, core, ws, enemyTask.Position, model.BuildingTypeWindTurbine)
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("build on another player's pending task must be rejected, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "该格已有其他玩家的施工任务") {
		t.Fatalf("build on another player's pending task must say so, got %q", res.Message)
	}
}
