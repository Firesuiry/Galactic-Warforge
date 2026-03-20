package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Blueprint captures a reusable layout definition.
type Blueprint struct {
	Metadata BlueprintMetadata `json:"metadata"`
	Items    []BlueprintItem   `json:"items"`
}

// BlueprintMetadata contains envelope information for a blueprint.
type BlueprintMetadata struct {
	Version   int             `json:"version"`
	CreatedAt time.Time       `json:"created_at"`
	CreatedBy string          `json:"created_by,omitempty"`
	Size      Footprint       `json:"size"`
	Bounds    BlueprintBounds `json:"bounds"`
}

// BlueprintBounds describes the inclusive bounding box for blueprint offsets.
type BlueprintBounds struct {
	MinX int `json:"min_x"`
	MinY int `json:"min_y"`
	MaxX int `json:"max_x"`
	MaxY int `json:"max_y"`
}

// BlueprintItem describes one building placement inside a blueprint.
type BlueprintItem struct {
	BuildingType BuildingType    `json:"building_type"`
	Params       BlueprintParams `json:"params"`
	Offset       GridOffset      `json:"offset"`
	Rotation     PlanRotation    `json:"rotation"`
}

// BlueprintParams captures per-building parameter payloads.
type BlueprintParams map[string]any

// EncodeBlueprint serializes a validated blueprint for storage or transport.
func EncodeBlueprint(bp Blueprint) ([]byte, error) {
	if err := bp.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(bp)
}

// DecodeBlueprint deserializes a blueprint payload and validates it.
func DecodeBlueprint(data []byte) (Blueprint, error) {
	var bp Blueprint
	if err := json.Unmarshal(data, &bp); err != nil {
		return Blueprint{}, err
	}
	if err := bp.Validate(); err != nil {
		return Blueprint{}, err
	}
	return bp, nil
}

// Valid returns true when the rotation enum is supported.
func (r PlanRotation) Valid() bool {
	switch r {
	case PlanRotation0, PlanRotation90, PlanRotation180, PlanRotation270:
		return true
	default:
		return false
	}
}

// Validate checks blueprint metadata and items for consistency.
func (bp Blueprint) Validate() error {
	if err := bp.Metadata.Validate(); err != nil {
		return fmt.Errorf("metadata: %w", err)
	}
	if len(bp.Items) == 0 {
		return fmt.Errorf("items empty")
	}

	minX := bp.Items[0].Offset.X
	minY := bp.Items[0].Offset.Y
	maxX := bp.Items[0].Offset.X
	maxY := bp.Items[0].Offset.Y

	for i, item := range bp.Items {
		if err := item.Validate(); err != nil {
			return fmt.Errorf("items[%d]: %w", i, err)
		}
		if item.Offset.X < bp.Metadata.Bounds.MinX || item.Offset.X > bp.Metadata.Bounds.MaxX ||
			item.Offset.Y < bp.Metadata.Bounds.MinY || item.Offset.Y > bp.Metadata.Bounds.MaxY {
			return fmt.Errorf("items[%d]: offset out of bounds", i)
		}
		if item.Offset.X < minX {
			minX = item.Offset.X
		}
		if item.Offset.Y < minY {
			minY = item.Offset.Y
		}
		if item.Offset.X > maxX {
			maxX = item.Offset.X
		}
		if item.Offset.Y > maxY {
			maxY = item.Offset.Y
		}
	}

	if minX != bp.Metadata.Bounds.MinX || minY != bp.Metadata.Bounds.MinY ||
		maxX != bp.Metadata.Bounds.MaxX || maxY != bp.Metadata.Bounds.MaxY {
		return fmt.Errorf("bounds do not match item offsets")
	}

	return nil
}

// Validate ensures metadata fields are complete and consistent.
func (meta BlueprintMetadata) Validate() error {
	if meta.Version <= 0 {
		return fmt.Errorf("version must be positive")
	}
	if meta.CreatedAt.IsZero() {
		return fmt.Errorf("created_at required")
	}
	if meta.CreatedBy != "" && strings.TrimSpace(meta.CreatedBy) == "" {
		return fmt.Errorf("created_by empty")
	}
	if meta.Size.Width <= 0 || meta.Size.Height <= 0 {
		return fmt.Errorf("size must be positive")
	}
	if err := meta.Bounds.Validate(); err != nil {
		return fmt.Errorf("bounds: %w", err)
	}
	width := meta.Bounds.MaxX - meta.Bounds.MinX + 1
	height := meta.Bounds.MaxY - meta.Bounds.MinY + 1
	if width != meta.Size.Width || height != meta.Size.Height {
		return fmt.Errorf("size does not match bounds")
	}
	return nil
}

// Validate ensures bounds are well-formed.
func (b BlueprintBounds) Validate() error {
	if b.MaxX < b.MinX {
		return fmt.Errorf("max_x before min_x")
	}
	if b.MaxY < b.MinY {
		return fmt.Errorf("max_y before min_y")
	}
	return nil
}

// Validate ensures item fields are populated and valid.
func (item BlueprintItem) Validate() error {
	if item.BuildingType == "" {
		return fmt.Errorf("building_type required")
	}
	if _, ok := BuildingDefinitionByID(item.BuildingType); !ok {
		return fmt.Errorf("unknown building_type")
	}
	if item.Params == nil {
		return fmt.Errorf("params required")
	}
	for key, value := range item.Params {
		if strings.TrimSpace(key) == "" {
			return fmt.Errorf("params contain empty key")
		}
		if value == nil {
			return fmt.Errorf("params[%s] is null", key)
		}
	}
	if !item.Rotation.Valid() {
		return fmt.Errorf("invalid rotation")
	}
	return nil
}
