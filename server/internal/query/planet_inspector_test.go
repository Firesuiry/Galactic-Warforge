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

func TestPlanetInspectUnitReturnsStructuredDetails(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 64, 64)
	ws.Units["u-inspect"] = &model.Unit{
		ID:          "u-inspect",
		Type:        model.UnitTypeWorker,
		OwnerID:     "p1",
		Position:    model.Position{X: 8, Y: 9},
		HP:          24,
		MaxHP:       30,
		Attack:      3,
		Defense:     2,
		AttackRange: 1,
		MoveRange:   4,
		VisionRange: 5,
	}

	view, ok := ql.PlanetInspect(ws, "p1", planetID, PlanetInspectRequest{
		TargetType: "unit",
		TargetID:   "u-inspect",
	})
	if !ok {
		t.Fatal("expected inspect view")
	}
	if view.TargetType != "unit" || view.Unit == nil {
		t.Fatalf("unexpected unit inspect payload: %+v", view)
	}
	if view.Unit.ID != "u-inspect" || view.Unit.Type != model.UnitTypeWorker {
		t.Fatalf("unexpected unit identity: %+v", view.Unit)
	}
}

func TestPlanetInspectResourceReturnsStructuredDetails(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 64, 64)
	ws.Buildings["vision"] = &model.Building{
		ID:          "vision",
		OwnerID:     "p1",
		Position:    model.Position{X: 10, Y: 10},
		VisionRange: 4,
	}
	ws.Resources["r-inspect"] = &model.ResourceNodeState{
		ID:           "r-inspect",
		PlanetID:     planetID,
		Kind:         "iron_ore",
		Behavior:     "finite",
		Position:     model.Position{X: 11, Y: 10},
		Remaining:    800,
		CurrentYield: 3,
	}

	view, ok := ql.PlanetInspect(ws, "p1", planetID, PlanetInspectRequest{
		TargetType: "resource",
		TargetID:   "r-inspect",
	})
	if !ok {
		t.Fatal("expected inspect view")
	}
	if view.TargetType != "resource" || view.Resource == nil {
		t.Fatalf("unexpected resource inspect payload: %+v", view)
	}
	if view.Resource.ID != "r-inspect" || view.Resource.Kind != "iron_ore" {
		t.Fatalf("unexpected resource identity: %+v", view.Resource)
	}
}

func TestPlanetInspectSectorReturnsSyntheticSummary(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 64, 64)

	view, ok := ql.PlanetInspect(ws, "p1", planetID, PlanetInspectRequest{
		TargetType: "sector",
		TargetID:   "1:2",
	})
	if !ok {
		t.Fatal("expected inspect view")
	}
	if view.TargetType != "sector" || view.TargetID != "1:2" {
		t.Fatalf("unexpected sector inspect payload: %+v", view)
	}
	if view.Title != "Sector 1:2" {
		t.Fatalf("unexpected sector title: %q", view.Title)
	}
}
