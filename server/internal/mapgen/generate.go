package mapgen

import (
	"fmt"
	"math"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
)

const (
	firstOrbitMinAU      = 0.3
	firstOrbitMaxAU      = 0.6
	orbitFactorMin       = 1.4
	orbitFactorMax       = 2.2
	planetInclinationMax = 6.0
	moonFirstOrbitMinAU  = 0.00005
	moonFirstOrbitMaxAU  = 0.0002
	moonOrbitFactorMin   = 1.4
	moonOrbitFactorMax   = 2.4
	moonInclinationMax   = 10.0
)

// Generate builds an immutable map model from config and seed.
func Generate(cfg *mapconfig.Config, seed string) *mapmodel.Universe {
	mapconfig.ApplyDefaults(cfg)
	rng := newRNG(seed)
	u := &mapmodel.Universe{
		Seed:        seed,
		Galaxies:    make(map[string]*mapmodel.Galaxy),
		Systems:     make(map[string]*mapmodel.System),
		Planets:     make(map[string]*mapmodel.Planet),
		GalaxyOrder: make([]string, 0, 1),
		SystemOrder: make([]string, 0, cfg.Galaxy.SystemCount),
		PlanetOrder: make([]string, 0, cfg.Galaxy.SystemCount*cfg.System.PlanetsPerSystem),
	}

	galaxyID := "galaxy-1"
	galaxy := &mapmodel.Galaxy{
		ID:        galaxyID,
		Name:      "Galaxy-1",
		Width:     cfg.Galaxy.Width,
		Height:    cfg.Galaxy.Height,
		SystemIDs: make([]string, 0, cfg.Galaxy.SystemCount),
	}
	u.Galaxies[galaxyID] = galaxy
	u.GalaxyOrder = append(u.GalaxyOrder, galaxyID)
	u.PrimaryGalaxyID = galaxyID

	for i := 0; i < cfg.Galaxy.SystemCount; i++ {
		sysID := fmt.Sprintf("sys-%d", i+1)
		sys := &mapmodel.System{
			ID:        sysID,
			Name:      fmt.Sprintf("System-%d", i+1),
			GalaxyID:  galaxyID,
			Position:  mapmodel.Vec2{X: rng.RangeFloat(0, cfg.Galaxy.Width), Y: rng.RangeFloat(0, cfg.Galaxy.Height)},
			Star:      generateStar(rng),
			PlanetIDs: make([]string, 0, cfg.System.PlanetsPerSystem),
		}
		u.Systems[sysID] = sys
		u.SystemOrder = append(u.SystemOrder, sysID)
		galaxy.SystemIDs = append(galaxy.SystemIDs, sysID)

		orbitAU := rng.RangeFloat(firstOrbitMinAU, firstOrbitMaxAU)
		for j := 0; j < cfg.System.PlanetsPerSystem; j++ {
			if j > 0 {
				orbitAU = nextOrbitDistance(orbitAU, rng)
			}
			planetID := fmt.Sprintf("planet-%d-%d", i+1, j+1)
			planetSeed := int64(hashString(seed + ":" + planetID))
			planetRNG := newRNG(fmt.Sprintf("planet:%d", planetSeed))
			kind := choosePlanetKind(rng, orbitAU, sys.Star, cfg.System.GasGiantRatio)
			orbit := mapmodel.Orbit{
				DistanceAU:     orbitAU,
				PeriodDays:     orbitPeriodDays(orbitAU, sys.Star.Mass),
				InclinationDeg: rng.RangeFloat(-planetInclinationMax, planetInclinationMax),
			}
			planet := &mapmodel.Planet{
				ID:              planetID,
				Name:            fmt.Sprintf("Planet-%d-%d", i+1, j+1),
				SystemID:        sysID,
				Kind:            kind,
				Orbit:           orbit,
				Moons:           generateMoons(rng, planetID, kind, cfg.System.MaxMoons),
				Width:           cfg.Planet.Width,
				Height:          cfg.Planet.Height,
				Seed:            planetSeed,
				ResourceDensity: cfg.Planet.ResourceDensity,
				Terrain:         generateTerrain(planetRNG, cfg.Planet.Terrain, cfg.Planet.Width, cfg.Planet.Height),
				Environment:     generateEnvironment(planetRNG, orbit, sys.Star, cfg.Planet.Environment),
			}
			planet.Resources = generateResources(planetRNG, planet, cfg.Planet.Resources)
			u.Planets[planetID] = planet
			u.PlanetOrder = append(u.PlanetOrder, planetID)
			sys.PlanetIDs = append(sys.PlanetIDs, planetID)

			if u.PrimaryPlanetID == "" {
				u.PrimaryPlanetID = planetID
			}
		}
	}

	galaxy.DistanceMatrix = buildDistanceMatrix(galaxy.SystemIDs, u.Systems)
	return u
}

func nextOrbitDistance(prev float64, rng *rng) float64 {
	return prev * rng.RangeFloat(orbitFactorMin, orbitFactorMax)
}

func orbitPeriodDays(distanceAU, centralMass float64) float64 {
	if centralMass <= 0 {
		centralMass = 1
	}
	return math.Sqrt(distanceAU*distanceAU*distanceAU/centralMass) * 365
}

func choosePlanetKind(rng *rng, orbitAU float64, star mapmodel.Star, gasRatio float64) mapmodel.PlanetKind {
	snowLine := 2.7 * math.Sqrt(star.Luminosity)
	if orbitAU >= snowLine && rng.Float64() < gasRatio {
		return mapmodel.PlanetKindGasGiant
	}
	if orbitAU >= snowLine*1.4 && rng.Float64() < 0.5 {
		return mapmodel.PlanetKindIce
	}
	return mapmodel.PlanetKindRocky
}

func generateMoons(rng *rng, planetID string, kind mapmodel.PlanetKind, maxMoons int) []mapmodel.Moon {
	if maxMoons <= 0 {
		return nil
	}
	limit := maxMoons
	if kind == mapmodel.PlanetKindRocky || kind == mapmodel.PlanetKindIce {
		limit = maxMoons / 2
		if limit < 1 {
			limit = 1
		}
	}
	count := rng.Intn(limit + 1)
	if count == 0 {
		return nil
	}

	moons := make([]mapmodel.Moon, 0, count)
	distance := rng.RangeFloat(moonFirstOrbitMinAU, moonFirstOrbitMaxAU)
	centralMass := planetMassSolar(kind)
	for i := 0; i < count; i++ {
		if i > 0 {
			distance *= rng.RangeFloat(moonOrbitFactorMin, moonOrbitFactorMax)
		}
		orbit := mapmodel.Orbit{
			DistanceAU:     distance,
			PeriodDays:     orbitPeriodDays(distance, centralMass),
			InclinationDeg: rng.RangeFloat(-moonInclinationMax, moonInclinationMax),
		}
		moonID := fmt.Sprintf("%s-moon-%d", planetID, i+1)
		moons = append(moons, mapmodel.Moon{
			ID:    moonID,
			Name:  fmt.Sprintf("Moon-%s-%d", planetID, i+1),
			Orbit: orbit,
		})
	}
	return moons
}

func planetMassSolar(kind mapmodel.PlanetKind) float64 {
	switch kind {
	case mapmodel.PlanetKindGasGiant:
		return 0.001
	case mapmodel.PlanetKindIce:
		return 0.000002
	default:
		return 0.000003
	}
}

func buildDistanceMatrix(systemIDs []string, systems map[string]*mapmodel.System) [][]float64 {
	n := len(systemIDs)
	matrix := make([][]float64, n)
	for i := 0; i < n; i++ {
		matrix[i] = make([]float64, n)
	}
	for i := 0; i < n; i++ {
		sysA := systems[systemIDs[i]]
		if sysA == nil {
			continue
		}
		for j := i + 1; j < n; j++ {
			sysB := systems[systemIDs[j]]
			if sysB == nil {
				continue
			}
			dx := sysA.Position.X - sysB.Position.X
			dy := sysA.Position.Y - sysB.Position.Y
			d := math.Hypot(dx, dy)
			matrix[i][j] = d
			matrix[j][i] = d
		}
	}
	return matrix
}
