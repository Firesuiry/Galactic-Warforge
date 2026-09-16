package query

import (
	"encoding/json"
	"siliconworld/internal/model"
	"testing"
)

func TestPlanetSceneExposesTrafficMonitorObservedState(t *testing.T) {
	ql, ws, id := newPlanetQueryFixture(t, 16, 16)
	b := &model.Building{ID: "monitor", Type: model.BuildingTypeTrafficMonitor, OwnerID: "p1", Position: model.Position{X: 3, Y: 3}, VisionRange: 4, Runtime: model.BuildingProfileFor(model.BuildingTypeTrafficMonitor, 1).Runtime}
	model.InitBuildingTrafficMonitor(b)
	s := b.TrafficMonitor
	s.TargetBeltID = "belt"
	s.WindowTicks = 2
	s.State = "flowing"
	s.Samples = []model.TrafficSample{{Tick: 3, Items: 2, QueuedItems: 1}, {Tick: 4, Items: 4, QueuedItems: 1}}
	s.SampleCount = 2
	s.WindowItems = 6
	s.ItemsPerTick = 3
	s.TotalItems = 9
	s.LastSampleTick = 4
	ws.Buildings[b.ID] = b
	view, ok := ql.PlanetScene(ws, "p1", id, PlanetSceneRequest{X: 0, Y: 0, Width: 8, Height: 8})
	if !ok {
		t.Fatal("scene missing")
	}
	encoded, err := json.Marshal(view.Buildings[b.ID])
	if err != nil {
		t.Fatal(err)
	}
	var got model.Building
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got.TrafficMonitor == nil || got.TrafficMonitor.TargetBeltID != "belt" || got.TrafficMonitor.ItemsPerTick != 3 || got.TrafficMonitor.TotalItems != 9 || len(got.TrafficMonitor.Samples) != 2 {
		t.Fatalf("missing observed monitor JSON: %s", encoded)
	}
	clone := b.Clone()
	clone.TrafficMonitor.Samples[0].Items = 99
	if s.Samples[0].Items != 2 {
		t.Fatal("read-only building clone aliases sample window")
	}
}
