package snapshot

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/model"
)

// 契约 §3 存档往返：带 elevation 的传送带经 JSON 存档 → 读档后
//   - BeltLayers 索引按 conveyor.elevation 重建（高架带不进 TileBuilding）；
//   - elevation / 朝向 / 带内物品都保留；
//   - 地面层同格不会被高架带占用。
//
// 读档后「链接照旧（货能继续沿坡道走）」由 gamecore 的
// TestBeltElevationSurvivesSnapshotRoundTrip 覆盖（它读档后跑 settleConveyors
// 验证末端收货）；这里专测 JSON 编解码本身没丢字段。
func TestElevatedBeltSnapshotRoundTripRebuildsLayerIndex(t *testing.T) {
	ws := model.NewWorldState("planet", 8)

	ramp := []struct {
		id        string
		pos       model.Position
		elevation int
	}{
		{"s0", model.Position{X: 2, Y: 2}, 0},
		{"s1", model.Position{X: 2, Y: 3}, 1},
		{"s2", model.Position{X: 2, Y: 4}, 1},
		{"s3", model.Position{X: 2, Y: 5}, 0},
	}
	for _, seg := range ramp {
		b := &model.Building{
			ID:       seg.id,
			Type:     model.BuildingTypeConveyorBeltMk1,
			OwnerID:  "p1",
			Position: seg.pos,
			Level:    1,
			Runtime:  model.BuildingProfileFor(model.BuildingTypeConveyorBeltMk1, 1).Runtime,
			Conveyor: &model.ConveyorState{
				Input:      model.ConveyorNorth,
				Output:     model.ConveyorSouth,
				MaxStack:   3,
				Throughput: 1,
				Elevation:  seg.elevation,
			},
		}
		ws.Buildings[b.ID] = b
		if err := ws.IndexBuilding(b); err != nil {
			t.Fatalf("index %s: %v", b.ID, err)
		}
	}
	ws.Buildings["s0"].Conveyor.Insert(model.ItemIronOre, 1)

	snap := CaptureWorld(ws)
	encoded, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded WorldSnapshot
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// JSON 里必须带上 elevation（omitempty 下地面带不写，高架带写）。
	if raw := decoded.Buildings["s1"].Conveyor.Elevation; raw != 1 {
		t.Fatalf("elevation lost in JSON: %d", raw)
	}

	restored, err := decoded.Restore()
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if got := restored.BeltLayerAt(2, 3, 1); got != "s1" {
		t.Fatalf("BeltLayers not rebuilt for s1: %q", got)
	}
	if got := restored.BeltLayerAt(2, 4, 1); got != "s2" {
		t.Fatalf("BeltLayers not rebuilt for s2: %q", got)
	}
	if restored.BeltLayerAt(2, 3, 2) != "" {
		t.Fatal("restore must not invent a layer above the saved one")
	}
	if restored.TileBuilding[model.TileKey(2, 3)] != "" || restored.TileBuilding[model.TileKey(2, 4)] != "" {
		t.Fatal("elevated belts must not occupy ground TileBuilding after restore")
	}
	if got := restored.TileBuilding[model.TileKey(2, 2)]; got != "s0" {
		t.Fatalf("ground belt lost its tile after restore: %q", got)
	}
	s1 := restored.Buildings["s1"]
	if s1.Conveyor == nil || s1.Conveyor.Elevation != 1 || s1.Conveyor.Output != model.ConveyorSouth || s1.Conveyor.Input != model.ConveyorNorth {
		t.Fatalf("elevated belt conveyor state lost: %+v", s1.Conveyor)
	}
	if got := restored.Buildings["s0"].Conveyor.TotalItems(); got != 1 {
		t.Fatalf("belt buffer lost in round trip: %d", got)
	}
}
