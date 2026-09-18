package query

import (
	"testing"

	"siliconworld/internal/model"
)

// Stacked layers (Position.Z > 0) share the ground tile registration and only
// exist in ws.Buildings; inspect by ID must still resolve them, and the fog
// filter must list them alongside the base layer.
func TestPlanetInspectStackedLayerBuilding(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 64, 64)
	profile := model.BuildingProfileFor(model.BuildingTypeMatrixLab, 1)
	base := &model.Building{
		ID:          "lab-base",
		Type:        model.BuildingTypeMatrixLab,
		OwnerID:     "p1",
		Position:    model.Position{X: 8, Y: 9},
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	stacked := &model.Building{
		ID:          "lab-z1",
		Type:        model.BuildingTypeMatrixLab,
		OwnerID:     "p1",
		Position:    model.Position{X: 8, Y: 9, Z: 1},
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	ws.Buildings[base.ID] = base
	ws.TileBuilding[model.TileKey(base.Position.X, base.Position.Y)] = base.ID
	ws.Buildings[stacked.ID] = stacked

	view, ok := ql.PlanetInspect(ws, "p1", planetID, PlanetInspectRequest{
		TargetType: "building",
		TargetID:   stacked.ID,
	})
	if !ok || view.Building == nil {
		t.Fatalf("stacked layer inspect failed: ok=%v view=%+v", ok, view)
	}
	if view.Building.ID != stacked.ID || view.Building.Position.Z != 1 {
		t.Fatalf("inspect must return the Z=1 layer, got %+v", view.Building)
	}

	view, ok = ql.PlanetInspect(ws, "p1", planetID, PlanetInspectRequest{
		TargetType: "building",
		TargetID:   base.ID,
	})
	if !ok || view.Building == nil || view.Building.Position.Z != 0 {
		t.Fatalf("base layer inspect broke: ok=%v view=%+v", ok, view)
	}
}
