package mapgen

import (
	"math"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
)

func generateEnvironment(rng *rng, orbit mapmodel.Orbit, star mapmodel.Star, cfg mapconfig.EnvironmentConfig) mapmodel.PlanetEnvironment {
	windMin, windMax := rangeOrDefault(cfg.Wind, 0.6, 1.4)
	lightMin, lightMax := rangeOrDefault(cfg.Light, 0.6, 1.5)
	dayMin, dayMax := rangeOrDefault(cfg.DayLengthHours, 12, 48)
	wind := rng.RangeFloat(windMin, windMax)

	lightBase := 1.0
	if orbit.DistanceAU > 0 {
		lightBase = star.Luminosity / math.Pow(orbit.DistanceAU, 2)
	}
	light := lightBase * rng.RangeFloat(lightMin, lightMax)

	dayLength := rng.RangeFloat(dayMin, dayMax)
	lockChance := valueOr(cfg.TidalLockChance, 0.1)
	tidalLocked := rng.Float64() < lockChance
	if tidalLocked {
		dayLength = orbit.PeriodDays * 24
	}

	return mapmodel.PlanetEnvironment{
		WindFactor:     wind,
		LightFactor:    light,
		TidalLocked:    tidalLocked,
		DayLengthHours: dayLength,
	}
}

func valueOr(ptr *float64, def float64) float64 {
	if ptr == nil {
		return def
	}
	return *ptr
}

func rangeOrDefault(cfg mapconfig.RangeConfig, defMin, defMax float64) (float64, float64) {
	min := defMin
	max := defMax
	if cfg.Min != nil {
		min = *cfg.Min
	}
	if cfg.Max != nil {
		max = *cfg.Max
	}
	return min, max
}
