package model

import (
	"reflect"
	"testing"
	"time"
)

func sampleBlueprint() Blueprint {
	created := time.Date(2026, 3, 19, 12, 0, 0, 0, time.UTC)
	return Blueprint{
		Metadata: BlueprintMetadata{
			Version:   1,
			CreatedAt: created,
			CreatedBy: "tester",
			Size:      Footprint{Width: 2, Height: 1},
			Bounds:    BlueprintBounds{MinX: 0, MinY: 0, MaxX: 1, MaxY: 0},
		},
		Items: []BlueprintItem{
			{
				BuildingType: BuildingTypeConveyorBeltMk1,
				Params:       BlueprintParams{},
				Offset:       GridOffset{X: 0, Y: 0},
				Rotation:     PlanRotation0,
			},
			{
				BuildingType: BuildingTypeConveyorBeltMk1,
				Params:       BlueprintParams{},
				Offset:       GridOffset{X: 1, Y: 0},
				Rotation:     PlanRotation0,
			},
		},
	}
}

func TestBlueprintValidateOK(t *testing.T) {
	bp := sampleBlueprint()
	if err := bp.Validate(); err != nil {
		t.Fatalf("expected valid blueprint, got %v", err)
	}
}

func TestBlueprintValidateRotation(t *testing.T) {
	bp := sampleBlueprint()
	bp.Items[0].Rotation = PlanRotation("45")
	if err := bp.Validate(); err == nil {
		t.Fatalf("expected rotation error")
	}
}

func TestBlueprintValidateParamsRequired(t *testing.T) {
	bp := sampleBlueprint()
	bp.Items[0].Params = nil
	if err := bp.Validate(); err == nil {
		t.Fatalf("expected params error")
	}
}

func TestBlueprintValidateBoundsMismatch(t *testing.T) {
	bp := sampleBlueprint()
	bp.Metadata.Bounds = BlueprintBounds{MinX: 0, MinY: 0, MaxX: 0, MaxY: 0}
	bp.Metadata.Size = Footprint{Width: 1, Height: 1}
	if err := bp.Validate(); err == nil {
		t.Fatalf("expected bounds mismatch error")
	}
}

func TestBlueprintEncodeDecode(t *testing.T) {
	bp := sampleBlueprint()
	data, err := EncodeBlueprint(bp)
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}
	decoded, err := DecodeBlueprint(data)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !reflect.DeepEqual(bp, decoded) {
		t.Fatalf("roundtrip mismatch: %#v != %#v", bp, decoded)
	}
}
