package model

import "testing"

func TestBuildingRotationTransformsFootprintAndPorts(t *testing.T) {
	b := &Building{Runtime: BuildingRuntime{Params: BuildingRuntimeParams{Footprint: Footprint{Width: 2, Height: 3}, IOPorts: []IOPort{{ID: "input", Offset: GridOffset{X: 1, Y: 0}}}}}}
	ApplyBuildingRotation(b, PlanRotation90)
	if b.Runtime.Params.Footprint != (Footprint{Width: 3, Height: 2}) || b.Runtime.Params.IOPorts[0].Offset.X != 2 || b.Runtime.Params.IOPorts[0].Offset.Y != 1 {
		t.Fatalf("rotation mismatch: %+v", b.Runtime.Params)
	}
	for _, typ := range []BuildingType{BuildingTypeFractionator, BuildingTypeSprayCoater} {
		b := &Building{Type: typ, Runtime: BuildingProfileFor(typ, 1).Runtime}
		InitBuildingFractionation(b)
		InitBuildingSprayCoater(b)
		ApplyBuildingRotation(b, PlanRotation90)
		if b.Fractionation != nil {
			if err := b.Fractionation.Validate(); err != nil {
				t.Fatal(err)
			}
		}
		if b.SprayCoater != nil {
			if err := b.SprayCoater.Validate(); err != nil {
				t.Fatal(err)
			}
		}
	}
}
