package mapstate

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
)

func TestNewDiscoverySeedsPrimaryNodesAndRoundTripsSnapshot(t *testing.T) {
	maps := &mapmodel.Universe{
		PrimaryGalaxyID: "g-1",
		PrimaryPlanetID: "p-1",
		Planets: map[string]*mapmodel.Planet{
			"p-1": {ID: "p-1", SystemID: "s-1"},
		},
	}
	players := []config.PlayerConfig{{PlayerID: "p1"}}

	discovery := NewDiscovery(players, maps)
	if !discovery.IsGalaxyDiscovered("p1", "g-1") {
		t.Fatal("expected primary galaxy discovered by default")
	}
	if !discovery.IsSystemDiscovered("p1", "s-1") {
		t.Fatal("expected primary system discovered by default")
	}
	if !discovery.IsPlanetDiscovered("p1", "p-1") {
		t.Fatal("expected primary planet discovered by default")
	}

	discovery.DiscoverSystem("p1", "s-2")
	restored := discovery.Snapshot().Restore()
	if !restored.IsSystemDiscovered("p1", "s-2") {
		t.Fatal("expected restored snapshot to retain discovered systems")
	}
}
