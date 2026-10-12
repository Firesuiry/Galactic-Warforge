package model

import (
	"fmt"
	"sort"
)

// ResourceNodeState captures the mutable state of a resource node.
type ResourceNodeState struct {
	ID           string   `json:"id"`
	PlanetID     string   `json:"planet_id"`
	Kind         string   `json:"kind"`
	Behavior     string   `json:"behavior"`
	Position     Position `json:"position"`
	ClusterID    string   `json:"cluster_id,omitempty"`
	MaxAmount    int      `json:"max_amount"`
	Remaining    int      `json:"remaining"`
	BaseYield    int      `json:"base_yield"`
	CurrentYield int      `json:"current_yield"`
	MinYield     int      `json:"min_yield"`
	RegenPerTick int      `json:"regen_per_tick"`
	DecayPerTick int      `json:"decay_per_tick"`
	IsRare       bool     `json:"is_rare,omitempty"`
	Depleted     bool     `json:"depleted,omitempty"`
}

// SyncDepleted refreshes the depleted marker from the remaining amount. A
// node is depleted when nothing can be extracted from it anymore; depleted
// nodes stay visible on the map and remain buildable for any building.
func (r *ResourceNodeState) SyncDepleted() {
	if r == nil {
		return
	}
	r.Depleted = r.Remaining <= 0 || r.MaxAmount <= 0
}

// Clone returns a copy of the resource node state.
func (r *ResourceNodeState) Clone() *ResourceNodeState {
	if r == nil {
		return nil
	}
	out := *r
	return &out
}

// ValidateCollectorSite is shared by commands, blueprints and completion.
// A collector covers its whole footprint plus one surrounding ring, so a
// resource node anywhere in that area makes the site valid (DSP-style
// box-select mining); the anchor cell alone is no longer required.
func ValidateCollectorSite(ws *WorldState, btype BuildingType, rotation PlanRotation, pos Position) error {
	def, ok := BuildingDefinitionByID(btype)
	if !ok || !def.RequiresResourceNode {
		return nil
	}
	if ws == nil || !ws.InBounds(pos.X, pos.Y) {
		return fmt.Errorf("资源点超出地图范围")
	}
	node := coveredResourceNode(ws, btype, rotation, pos)
	if node == nil {
		return fmt.Errorf("%s 占地及外圈没有可开采的资源节点", btype)
	}
	collect := BuildingProfileFor(btype, 1).Runtime.Functions.Collect
	if collect != nil {
		for _, kind := range collect.AllowedResources {
			if node.Kind == kind {
				return nil
			}
		}
	}
	return fmt.Errorf("%s 无法开采资源 %s", btype, node.Kind)
}

// coveredResourceNode returns the first (deterministic) allowed resource node
// inside the collector's coverage area: its footprint expanded by the collect
// module's extra rings (at least one ring).
func coveredResourceNode(ws *WorldState, btype BuildingType, rotation PlanRotation, pos Position) *ResourceNodeState {
	if ws == nil {
		return nil
	}
	for _, cell := range CollectorCoverageCells(ws, btype, rotation, pos) {
		node := ws.Resources[ws.Grid[cell.Y][cell.X].ResourceNodeID]
		if node != nil {
			return node
		}
	}
	return nil
}

// CollectorCoverageCells lists the cells a collector of btype covers at pos:
// every footprint cell plus `max(1, coverage_radius)` surrounding rings, in a
// stable (row-major) order so selection is deterministic.
func CollectorCoverageCells(ws *WorldState, btype BuildingType, rotation PlanRotation, pos Position) []Position {
	if ws == nil {
		return nil
	}
	fp, ok := FootprintOf(btype, rotation)
	if !ok {
		return nil
	}
	rings := 1
	if def, ok := BuildingRuntimeDefinitionByID(btype); ok && def.Functions.Collect != nil {
		if def.Functions.Collect.CoverageRadius > rings {
			rings = def.Functions.Collect.CoverageRadius
		}
	}
	out := make([]Position, 0, (fp.Width+2*rings)*(fp.Height+2*rings))
	seen := make(map[Position]bool, cap(out))
	for y := -rings; y < fp.Height+rings; y++ {
		for x := -rings; x < fp.Width+rings; x++ {
			cell := ws.SurfaceOffset(pos, x, y)
			if !ws.InBounds(cell.X, cell.Y) || seen[cell] {
				continue
			}
			seen[cell] = true
			out = append(out, cell)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Y != out[j].Y {
			return out[i].Y < out[j].Y
		}
		return out[i].X < out[j].X
	})
	return out
}
