package mapmodel

import (
	"sort"

	"siliconworld/internal/terrain"
)

// Galaxy represents a galaxy node in the map.
type Galaxy struct {
	ID             string
	Name           string
	Width          float64
	Height         float64
	SystemIDs      []string
	DistanceMatrix [][]float64
}

// System represents a stellar system node in the map.
type System struct {
	ID        string
	Name      string
	GalaxyID  string
	Position  Vec2
	Star      Star
	PlanetIDs []string
}

// Planet represents a planet node in the map.
type Planet struct {
	ID              string
	Name            string
	SystemID        string
	Kind            PlanetKind
	Orbit           Orbit
	Moons           []Moon
	Width           int
	Height          int
	Seed            int64
	ResourceDensity int
	Terrain         [][]terrain.TileType
	Environment     PlanetEnvironment
	Resources       []ResourceNode
}

// Universe is the immutable three-layer map model.
type Universe struct {
	Seed            string
	Galaxies        map[string]*Galaxy
	Systems         map[string]*System
	Planets         map[string]*Planet
	GalaxyOrder     []string
	SystemOrder     []string
	PlanetOrder     []string
	PrimaryGalaxyID string
	PrimaryPlanetID string
}

func (u *Universe) Galaxy(id string) (*Galaxy, bool) {
	g, ok := u.Galaxies[id]
	return g, ok
}

func (u *Universe) System(id string) (*System, bool) {
	s, ok := u.Systems[id]
	return s, ok
}

func (u *Universe) Planet(id string) (*Planet, bool) {
	p, ok := u.Planets[id]
	return p, ok
}

func (u *Universe) PrimaryGalaxy() *Galaxy {
	if u.PrimaryGalaxyID == "" {
		return nil
	}
	return u.Galaxies[u.PrimaryGalaxyID]
}

func (u *Universe) PrimaryPlanet() *Planet {
	if u.PrimaryPlanetID == "" {
		return nil
	}
	return u.Planets[u.PrimaryPlanetID]
}

// SystemsLinkedByLane reports whether two systems in the same galaxy are
// connected by a direct lane. The lane graph mirrors the starmap rendering
// rule: every system links to its neighborCount nearest neighbors (Euclidean
// distance over galaxy positions); a lane exists when either endpoint lists
// the other among its nearest neighbors.
func (u *Universe) SystemsLinkedByLane(fromID, toID string, neighborCount int) bool {
	if u == nil || fromID == "" || toID == "" || fromID == toID || neighborCount < 1 {
		return false
	}
	from, ok := u.Systems[fromID]
	if !ok || from == nil {
		return false
	}
	to, ok := u.Systems[toID]
	if !ok || to == nil {
		return false
	}
	if from.GalaxyID == "" || from.GalaxyID != to.GalaxyID {
		return false
	}
	galaxy, ok := u.Galaxies[from.GalaxyID]
	if !ok || galaxy == nil {
		return false
	}
	return isNearestNeighbor(galaxy.SystemIDs, u.Systems, fromID, toID, neighborCount) ||
		isNearestNeighbor(galaxy.SystemIDs, u.Systems, toID, fromID, neighborCount)
}

// isNearestNeighbor reports whether candidateID is among the neighborCount
// nearest systems of anchorID within the given system list.
func isNearestNeighbor(systemIDs []string, systems map[string]*System, anchorID, candidateID string, neighborCount int) bool {
	anchor := systems[anchorID]
	if anchor == nil {
		return false
	}
	type neighbor struct {
		id string
		d2 float64
	}
	neighbors := make([]neighbor, 0, len(systemIDs))
	for _, id := range systemIDs {
		if id == anchorID {
			continue
		}
		sys := systems[id]
		if sys == nil {
			continue
		}
		dx := anchor.Position.X - sys.Position.X
		dy := anchor.Position.Y - sys.Position.Y
		neighbors = append(neighbors, neighbor{id: id, d2: dx*dx + dy*dy})
	}
	sort.Slice(neighbors, func(i, j int) bool {
		if neighbors[i].d2 == neighbors[j].d2 {
			return neighbors[i].id < neighbors[j].id
		}
		return neighbors[i].d2 < neighbors[j].d2
	})
	limit := neighborCount
	if len(neighbors) < limit {
		limit = len(neighbors)
	}
	for i := 0; i < limit; i++ {
		if neighbors[i].id == candidateID {
			return true
		}
	}
	return false
}
