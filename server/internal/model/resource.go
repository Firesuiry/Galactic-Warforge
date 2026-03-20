package model

// ResourceNodeState captures the mutable state of a resource node.
type ResourceNodeState struct {
	ID           string   `json:"id"`
	PlanetID     string   `json:"planet_id"`
	Kind         string   `json:"kind"`
	Behavior     string   `json:"behavior"`
	Position     Position `json:"position"`
	ClusterID    string   `json:"cluster_id,omitempty"`
	MaxAmount    int      `json:"max_amount,omitempty"`
	Remaining    int      `json:"remaining,omitempty"`
	BaseYield    int      `json:"base_yield"`
	CurrentYield int      `json:"current_yield"`
	MinYield     int      `json:"min_yield,omitempty"`
	RegenPerTick int      `json:"regen_per_tick,omitempty"`
	DecayPerTick int      `json:"decay_per_tick,omitempty"`
	IsRare       bool     `json:"is_rare,omitempty"`
}
