package mapmodel

import "testing"

func TestUniversePrimaryLookups(t *testing.T) {
	u := &Universe{
		Galaxies: map[string]*Galaxy{
			"g-1": {ID: "g-1", Name: "alpha"},
		},
		Systems: map[string]*System{
			"s-1": {ID: "s-1", GalaxyID: "g-1"},
		},
		Planets: map[string]*Planet{
			"p-1": {ID: "p-1", SystemID: "s-1"},
		},
		PrimaryGalaxyID: "g-1",
		PrimaryPlanetID: "p-1",
	}

	if got := u.PrimaryGalaxy(); got == nil || got.ID != "g-1" {
		t.Fatalf("expected primary galaxy g-1, got %+v", got)
	}
	if got := u.PrimaryPlanet(); got == nil || got.ID != "p-1" {
		t.Fatalf("expected primary planet p-1, got %+v", got)
	}
	if _, ok := u.System("s-1"); !ok {
		t.Fatal("expected system lookup to succeed")
	}
}
