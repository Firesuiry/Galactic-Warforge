package query

import (
	"testing"

	"siliconworld/internal/model"
)

func TestPlanetInspectBuildingReturnsStructuredDetails(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 64, 64)
	ws.Buildings["b-inspect"] = &model.Building{
		ID:          "b-inspect",
		Type:        model.BuildingTypeMiningMachine,
		OwnerID:     "p1",
		Position:    model.Position{X: 8, Y: 9},
		HP:          120,
		MaxHP:       150,
		Level:       2,
		VisionRange: 5,
	}

	req := PlanetInspectRequest{
		TargetType: "building",
		TargetID:   "b-inspect",
	}
	view, ok := ql.PlanetInspect(ws, "p1", planetID, req)
	if !ok {
		t.Fatal("expected inspect view")
	}
	if view.TargetType != "building" {
		t.Fatalf("unexpected target type: %s", view.TargetType)
	}
	if view.Building == nil {
		t.Fatal("expected building details")
	}
	if view.Building.ID != "b-inspect" || view.Building.Type != model.BuildingTypeMiningMachine {
		t.Fatalf("unexpected building identity: %+v", view.Building)
	}
	if view.Building.Position.X != 8 || view.Building.Position.Y != 9 {
		t.Fatalf("unexpected building position: %+v", view.Building.Position)
	}
	if view.Building.HP != 120 || view.Building.MaxHP != 150 || view.Building.Level != 2 {
		t.Fatalf("unexpected building stats: %+v", view.Building)
	}
}
