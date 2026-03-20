package model

// SolarSailOrbitState tracks solar sails in orbit around a star.
type SolarSailOrbitState struct {
	PlayerID     string              `json:"player_id"`
	SystemID    string              `json:"system_id"`
	Sails       []SolarSail         `json:"sails"`
	TotalEnergy  int                 `json:"total_energy"`
}

// SolarSail represents a single solar sail in orbit.
type SolarSail struct {
	ID            string  `json:"id"`
	OrbitRadius   float64 `json:"orbit_radius"`   // distance from star in AU
	Inclination   float64 `json:"inclination"`    // orbital inclination in degrees
	LaunchTick    int64   `json:"launch_tick"`
	LifetimeTicks int64   `json:"lifetime_ticks"` // how long the sail lasts
	EnergyPerTick int     `json:"energy_per_tick"` // energy produced per tick
}

// SolarSailSwarm represents a group of solar sails working together.
type SolarSailSwarm struct {
	ID          string      `json:"id"`
	PlayerID    string      `json:"player_id"`
	SystemID    string      `json:"system_id"`
	MemberIDs   []string    `json:"member_ids"` // IDs of SolarSail members
	TotalCount  int         `json:"total_count"`
	EnergyBonus float64     `json:"energy_bonus"` // efficiency bonus from swarm
}

// SolarSailOrbitParams defines parameters for solar sail orbits.
type SolarSailOrbitParams struct {
	DefaultRadius      float64 `json:"default_radius"`
	DefaultInclination float64 `json:"default_inclination"`
	DefaultLifetime    int64   `json:"default_lifetime"`    // in ticks
	EnergyPerSail      int     `json:"energy_per_sail"`     // base energy per sail per tick
	SwarmBonusPerSail  float64 `json:"swarm_bonus_per_sail"` // additional efficiency per sail in swarm
}

// DefaultSolarSailOrbitParams returns sensible defaults.
func DefaultSolarSailOrbitParams() SolarSailOrbitParams {
	return SolarSailOrbitParams{
		DefaultRadius:      1.0,  // 1 AU
		DefaultInclination: 0.0,
		DefaultLifetime:    36000, // ~1 hour at 10 ticks/sec (36000 ticks)
		EnergyPerSail:      10,    // 10 kW per sail
		SwarmBonusPerSail:  0.01,  // 1% additional efficiency per sail in swarm
	}
}

// CalcSwarmBonus calculates the energy bonus from having multiple sails in swarm formation.
func CalcSwarmBonus(sailCount int, params SolarSailOrbitParams) float64 {
	if sailCount <= 1 {
		return 1.0
	}
	bonus := 1.0 + float64(sailCount-1)*params.SwarmBonusPerSail
	if bonus > 2.0 {
		return 2.0 // cap at 2x bonus
	}
	return bonus
}

// SolarSailEnergyOutput calculates total energy output from solar sails.
func SolarSailEnergyOutput(sailCount int, params SolarSailOrbitParams) int {
	if sailCount <= 0 {
		return 0
	}
	swarmBonus := CalcSwarmBonus(sailCount, params)
	baseEnergy := sailCount * params.EnergyPerSail
	return int(float64(baseEnergy) * swarmBonus)
}