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
}

// Clone returns a copy of the resource node state.
func (r *ResourceNodeState) Clone() *ResourceNodeState {
	if r == nil {
		return nil
	}
	out := *r
	return &out
}
