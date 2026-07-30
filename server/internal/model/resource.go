package model

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
