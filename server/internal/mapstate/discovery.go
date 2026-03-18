package mapstate

import (
	"sync"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
)

// PlayerDiscovery tracks discovered nodes per player.
type PlayerDiscovery struct {
	Galaxies map[string]bool
	Systems  map[string]bool
	Planets  map[string]bool
}

// Discovery stores discovery state for all players.
type Discovery struct {
	mu      sync.RWMutex
	players map[string]*PlayerDiscovery
}

// NewDiscovery creates discovery state and marks the primary galaxy as discovered for all players.
func NewDiscovery(players []config.PlayerConfig, maps *mapmodel.Universe) *Discovery {
	d := &Discovery{
		players: make(map[string]*PlayerDiscovery, len(players)),
	}
	for _, p := range players {
		d.players[p.PlayerID] = &PlayerDiscovery{
			Galaxies: make(map[string]bool),
			Systems:  make(map[string]bool),
			Planets:  make(map[string]bool),
		}
		if maps.PrimaryGalaxyID != "" {
			d.players[p.PlayerID].Galaxies[maps.PrimaryGalaxyID] = true
		}
		if maps.PrimaryPlanetID != "" {
			planet := maps.Planets[maps.PrimaryPlanetID]
			if planet != nil {
				d.players[p.PlayerID].Systems[planet.SystemID] = true
				d.players[p.PlayerID].Planets[planet.ID] = true
			}
		}
	}
	return d
}

func (d *Discovery) IsGalaxyDiscovered(playerID, galaxyID string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	pd, ok := d.players[playerID]
	if !ok {
		return false
	}
	return pd.Galaxies[galaxyID]
}

func (d *Discovery) IsSystemDiscovered(playerID, systemID string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	pd, ok := d.players[playerID]
	if !ok {
		return false
	}
	return pd.Systems[systemID]
}

func (d *Discovery) IsPlanetDiscovered(playerID, planetID string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	pd, ok := d.players[playerID]
	if !ok {
		return false
	}
	return pd.Planets[planetID]
}

func (d *Discovery) DiscoverGalaxy(playerID, galaxyID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	pd, ok := d.players[playerID]
	if !ok {
		return false
	}
	if pd.Galaxies[galaxyID] {
		return false
	}
	pd.Galaxies[galaxyID] = true
	return true
}

func (d *Discovery) DiscoverSystem(playerID, systemID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	pd, ok := d.players[playerID]
	if !ok {
		return false
	}
	if pd.Systems[systemID] {
		return false
	}
	pd.Systems[systemID] = true
	return true
}

func (d *Discovery) DiscoverPlanet(playerID, planetID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	pd, ok := d.players[playerID]
	if !ok {
		return false
	}
	if pd.Planets[planetID] {
		return false
	}
	pd.Planets[planetID] = true
	return true
}

func (d *Discovery) DiscoverSystems(playerID string, systemIDs []string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	pd, ok := d.players[playerID]
	if !ok {
		return 0
	}
	added := 0
	for _, id := range systemIDs {
		if !pd.Systems[id] {
			pd.Systems[id] = true
			added++
		}
	}
	return added
}
