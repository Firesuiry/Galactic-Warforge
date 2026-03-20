package mapmodel

// GridPos represents a 2D grid position on a planet.
type GridPos struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// ResourceKind identifies the resource type.
type ResourceKind string

const (
	ResourceIronOre        ResourceKind = "iron_ore"
	ResourceCopperOre      ResourceKind = "copper_ore"
	ResourceStoneOre       ResourceKind = "stone_ore"
	ResourceSiliconOre     ResourceKind = "silicon_ore"
	ResourceTitaniumOre    ResourceKind = "titanium_ore"
	ResourceCoal           ResourceKind = "coal"
	ResourceCrudeOil       ResourceKind = "crude_oil"
	ResourceWater          ResourceKind = "water"
	ResourceFireIce        ResourceKind = "fire_ice"
	ResourceFractalSilicon ResourceKind = "fractal_silicon"
	ResourceGratingCrystal ResourceKind = "grating_crystal"
	ResourceMonopoleMagnet ResourceKind = "monopole_magnet"
)

// ResourceBehavior defines depletion behavior for a resource node.
type ResourceBehavior string

const (
	ResourceFinite    ResourceBehavior = "finite"
	ResourceDecay     ResourceBehavior = "decay"
	ResourceRenewable ResourceBehavior = "renewable"
)

// ResourceNode represents a resource node on a planet.
type ResourceNode struct {
	ID           string           `json:"id"`
	PlanetID     string           `json:"planet_id"`
	Kind         ResourceKind     `json:"kind"`
	Behavior     ResourceBehavior `json:"behavior"`
	Position     GridPos          `json:"position"`
	ClusterID    string           `json:"cluster_id,omitempty"`
	Total        int              `json:"total"`
	BaseYield    int              `json:"base_yield"`
	MinYield     int              `json:"min_yield,omitempty"`
	RegenPerTick int              `json:"regen_per_tick,omitempty"`
	DecayPerTick int              `json:"decay_per_tick,omitempty"`
	IsRare       bool             `json:"is_rare,omitempty"`
}
