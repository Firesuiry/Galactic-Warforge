package mapgen

import (
	"fmt"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
)

// Generate builds an immutable map model from config and seed.
func Generate(cfg *mapconfig.Config, seed string) *mapmodel.Universe {
	u := &mapmodel.Universe{
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
			PlanetIDs: make([]string, 0, cfg.System.PlanetsPerSystem),
		}
		u.Systems[sysID] = sys
		u.SystemOrder = append(u.SystemOrder, sysID)
		galaxy.SystemIDs = append(galaxy.SystemIDs, sysID)

		for j := 0; j < cfg.System.PlanetsPerSystem; j++ {
			planetID := fmt.Sprintf("planet-%d-%d", i+1, j+1)
			planet := &mapmodel.Planet{
				ID:              planetID,
				Name:            fmt.Sprintf("Planet-%d-%d", i+1, j+1),
				SystemID:        sysID,
				Width:           cfg.Planet.Width,
				Height:          cfg.Planet.Height,
				Seed:            int64(hashString(seed + ":" + planetID)),
				ResourceDensity: cfg.Planet.ResourceDensity,
			}
			u.Planets[planetID] = planet
			u.PlanetOrder = append(u.PlanetOrder, planetID)
			sys.PlanetIDs = append(sys.PlanetIDs, planetID)

			if u.PrimaryPlanetID == "" {
				u.PrimaryPlanetID = planetID
			}
		}
	}

	return u
}

func hashString(s string) uint64 {
	var h uint64 = 14695981039346656037
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}
