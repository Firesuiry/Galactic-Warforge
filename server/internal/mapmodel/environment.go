package mapmodel

// PlanetEnvironment describes simplified environmental parameters.
type PlanetEnvironment struct {
	WindFactor     float64 `json:"wind_factor"`
	LightFactor    float64 `json:"light_factor"`
	TidalLocked    bool    `json:"tidal_locked"`
	DayLengthHours float64 `json:"day_length_hours"`
}
