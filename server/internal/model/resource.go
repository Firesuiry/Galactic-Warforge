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

// ResourceBaselineEntry 是资源节点在地图生成（含 bootstrap 注入的开局矿簇）后、
// 任何结算发生之前的基线：这些字段只由地图配置与 seed 决定，可由 mapgen 确定性
// 重建。细分网格后全图资源 cell 上万，快照只存与基线的差异（remaining/
// current_yield/depleted），读档时用基线还原种类/位置/储量上限/基础产速。
type ResourceBaselineEntry struct {
	Kind         string
	Behavior     string
	X            int
	Y            int
	ClusterID    string
	MaxAmount    int
	BaseYield    int
	MinYield     int
	RegenPerTick int
	DecayPerTick int
	IsRare       bool
}

// ResourceNodeDelta 是资源节点相对基线的可变字段（结算真正会改动的部分）。
// Node 只在节点不在基线里时出现（合成世界/测试直接往 ws.Resources 里塞的节点），
// 此时静态字段无处可重建，必须整节点写进快照。
type ResourceNodeDelta struct {
	Remaining    int                `json:"remaining"`
	CurrentYield int                `json:"current_yield"`
	Depleted     bool               `json:"depleted,omitempty"`
	Node         *ResourceNodeState `json:"node,omitempty"`
}

// SetResourceBaseline 记录当前资源节点为基线（在地图生成 / bootstrap 完成后调用一次）。
func (ws *WorldState) SetResourceBaseline() {
	if ws == nil {
		return
	}
	ws.ResourceBaseline = make(map[string]ResourceBaselineEntry, len(ws.Resources))
	for id, node := range ws.Resources {
		if node == nil {
			continue
		}
		ws.ResourceBaseline[id] = ResourceBaselineEntry{
			Kind:         node.Kind,
			Behavior:     node.Behavior,
			X:            node.Position.X,
			Y:            node.Position.Y,
			ClusterID:    node.ClusterID,
			MaxAmount:    node.MaxAmount,
			BaseYield:    node.BaseYield,
			MinYield:     node.MinYield,
			RegenPerTick: node.RegenPerTick,
			DecayPerTick: node.DecayPerTick,
			IsRare:       node.IsRare,
		}
	}
}

// ResourceDeltas 收集当前资源节点相对基线的差异；与基线一致的节点不进结果。
func (ws *WorldState) ResourceDeltas() map[string]ResourceNodeDelta {
	if ws == nil {
		return nil
	}
	out := make(map[string]ResourceNodeDelta, len(ws.Resources))
	for id, node := range ws.Resources {
		if node == nil {
			continue
		}
		if !ws.MapResourceIDs[id] {
			// 不是 mapgen 直接产出的节点（bootstrap 注入的开局矿簇、合成世界/测试
			// 直接塞进来的节点）：读档时重建地图模型拿不到它的静态字段，整节点入快照。
			// 必须拷贝：快照会被持有到世界继续推进之后（自动存档/回放/存档点），
			// 直接放指针会让快照跟着活世界一起变。
			cp := *node
			out[id] = ResourceNodeDelta{Remaining: node.Remaining, CurrentYield: node.CurrentYield, Depleted: node.Depleted, Node: &cp}
			continue
		}
		base, ok := ws.ResourceBaseline[id]
		if !ok {
			cp := *node
			out[id] = ResourceNodeDelta{Remaining: node.Remaining, CurrentYield: node.CurrentYield, Depleted: node.Depleted, Node: &cp}
			continue
		}
		// Depleted 是 Remaining/MaxAmount 的纯函数，不单独比较：基线里储量本就为 0
		// 的节点（地图上的空矿点）不该每 tick 都被当成"变化"。
		if node.Remaining == base.MaxAmount && node.CurrentYield == base.BaseYield {
			continue
		}
		out[id] = ResourceNodeDelta{Remaining: node.Remaining, CurrentYield: node.CurrentYield, Depleted: node.Depleted}
	}
	return out
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
