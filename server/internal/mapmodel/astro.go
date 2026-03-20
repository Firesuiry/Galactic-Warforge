package mapmodel

// Vec2 is a 2D coordinate in galaxy space.
type Vec2 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Orbit is a simplified orbital parameter set.
type Orbit struct {
	DistanceAU     float64 `json:"distance_au"`
	PeriodDays     float64 `json:"period_days"`
	InclinationDeg float64 `json:"inclination_deg"`
}

// Star describes a stellar host.
type Star struct {
	Type        string  `json:"type"`
	Mass        float64 `json:"mass_solar"`
	Radius      float64 `json:"radius_solar"`
	Luminosity  float64 `json:"luminosity_solar"`
	Temperature float64 `json:"temperature_k"`
}

// PlanetKind is the simplified planet classification.
type PlanetKind string

const (
	PlanetKindRocky    PlanetKind = "rocky"
	PlanetKindGasGiant PlanetKind = "gas_giant"
	PlanetKindIce      PlanetKind = "ice"
)

// Moon represents a planetary satellite.
type Moon struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Orbit Orbit  `json:"orbit"`
}
