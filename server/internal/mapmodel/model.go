package mapmodel

// Galaxy represents a galaxy node in the map.
type Galaxy struct {
	ID        string
	Name      string
	SystemIDs []string
}

// System represents a stellar system node in the map.
type System struct {
	ID        string
	Name      string
	GalaxyID  string
	PlanetIDs []string
}

// Planet represents a planet node in the map.
type Planet struct {
	ID               string
	Name             string
	SystemID         string
	Width            int
	Height           int
	Seed             int64
	ResourceDensity  int
}

// Universe is the immutable three-layer map model.
type Universe struct {
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
