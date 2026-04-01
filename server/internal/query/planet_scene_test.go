package query

import (
	"reflect"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
	"siliconworld/internal/visibility"
)

func TestPlanetSummaryProvidesCountsWithoutHeavyPayload(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 400, 300)
	ws.Buildings["b-1"] = &model.Building{ID: "b-1", OwnerID: "p1", Position: model.Position{X: 5, Y: 5}, VisionRange: 1}
	ws.Buildings["b-2"] = &model.Building{ID: "b-2", OwnerID: "p2", Position: model.Position{X: 50, Y: 50}, VisionRange: 1}
	ws.Units["u-1"] = &model.Unit{ID: "u-1", OwnerID: "p1", Position: model.Position{X: 6, Y: 5}, VisionRange: 1}
	ws.Units["u-2"] = &model.Unit{ID: "u-2", OwnerID: "p2", Position: model.Position{X: 60, Y: 60}, VisionRange: 1}
	ws.Resources["r-1"] = &model.ResourceNodeState{ID: "r-1", PlanetID: planetID, Position: model.Position{X: 10, Y: 10}}
	ws.Resources["r-2"] = &model.ResourceNodeState{ID: "r-2", PlanetID: planetID, Position: model.Position{X: 20, Y: 20}}

	view, ok := ql.PlanetSummary(ws, "p1", planetID)
	if !ok {
		t.Fatal("expected summary view")
	}
	if view.BuildingCount != 1 || view.UnitCount != 1 || view.ResourceCount != 2 {
		t.Fatalf("unexpected summary counts: buildings=%d units=%d resources=%d", view.BuildingCount, view.UnitCount, view.ResourceCount)
	}
	if view.MapWidth != 400 || view.MapHeight != 300 {
		t.Fatalf("unexpected map size: %dx%d", view.MapWidth, view.MapHeight)
	}

	heavy := map[string]bool{
		"Terrain":   true,
		"Fog":       true,
		"Buildings": true,
		"Units":     true,
		"Resources": true,
	}
	rt := reflect.TypeOf(*view)
	for i := 0; i < rt.NumField(); i++ {
		if heavy[rt.Field(i).Name] {
			t.Fatalf("summary should not expose heavy payload field: %s", rt.Field(i).Name)
		}
	}
}

func TestPlanetSceneTileModeClampsBoundsAndReturnsEntitiesInBounds(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 400, 300)
	ws.Buildings["b-in"] = &model.Building{ID: "b-in", OwnerID: "p1", Position: model.Position{X: 10, Y: 10}, VisionRange: 4}
	ws.Buildings["b-out"] = &model.Building{ID: "b-out", OwnerID: "p1", Position: model.Position{X: 300, Y: 10}, VisionRange: 1}
	ws.Units["u-in"] = &model.Unit{ID: "u-in", OwnerID: "p1", Position: model.Position{X: 12, Y: 12}, VisionRange: 3}
	ws.Units["u-out"] = &model.Unit{ID: "u-out", OwnerID: "p1", Position: model.Position{X: 280, Y: 280}, VisionRange: 1}
	ws.Resources["r-in"] = &model.ResourceNodeState{ID: "r-in", PlanetID: planetID, Position: model.Position{X: 20, Y: 20}}
	ws.Resources["r-out"] = &model.ResourceNodeState{ID: "r-out", PlanetID: planetID, Position: model.Position{X: 280, Y: 20}}

	req := PlanetSceneRequest{
		DetailLevel: "tile",
		MinX:        -10,
		MinY:        -20,
		MaxX:        500,
		MaxY:        500,
	}
	view, ok := ql.PlanetScene(ws, "p1", planetID, req)
	if !ok {
		t.Fatal("expected tile scene view")
	}
	if view.Bounds.MinX != 0 || view.Bounds.MinY != 0 || view.Bounds.MaxX != 255 || view.Bounds.MaxY != 255 {
		t.Fatalf("unexpected clamped bounds: %+v", view.Bounds)
	}
	if len(view.Terrain) != 256 || len(view.Terrain[0]) != 256 {
		t.Fatalf("unexpected terrain crop size: %dx%d", len(view.Terrain[0]), len(view.Terrain))
	}
	if len(view.Fog.Visible) != 256 || len(view.Fog.Visible[0]) != 256 {
		t.Fatalf("unexpected fog crop size: %dx%d", len(view.Fog.Visible[0]), len(view.Fog.Visible))
	}
	if _, exists := view.Buildings["b-in"]; !exists {
		t.Fatal("expected in-bounds building to be returned")
	}
	if _, exists := view.Buildings["b-out"]; exists {
		t.Fatal("did not expect out-of-bounds building in tile scene")
	}
	if _, exists := view.Units["u-in"]; !exists {
		t.Fatal("expected in-bounds unit to be returned")
	}
	if _, exists := view.Units["u-out"]; exists {
		t.Fatal("did not expect out-of-bounds unit in tile scene")
	}
	if !containsResource(view.Resources, "r-in") {
		t.Fatal("expected in-bounds resource to be returned")
	}
	if containsResource(view.Resources, "r-out") {
		t.Fatal("did not expect out-of-bounds resource in tile scene")
	}
}

func TestPlanetSceneSectorModeReturnsAggregatedSectors(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 96, 96)
	ws.Buildings["b-a"] = &model.Building{ID: "b-a", OwnerID: "p1", Position: model.Position{X: 5, Y: 5}, VisionRange: 2}
	ws.Buildings["b-b"] = &model.Building{ID: "b-b", OwnerID: "p1", Position: model.Position{X: 35, Y: 2}, VisionRange: 2}
	ws.Units["u-a"] = &model.Unit{ID: "u-a", OwnerID: "p1", Position: model.Position{X: 34, Y: 33}, VisionRange: 2}
	ws.Resources["r-a"] = &model.ResourceNodeState{ID: "r-a", PlanetID: planetID, Position: model.Position{X: 70, Y: 70}}

	req := PlanetSceneRequest{
		DetailLevel: "sector",
		MinX:        0,
		MinY:        0,
		MaxX:        95,
		MaxY:        95,
	}
	view, ok := ql.PlanetScene(ws, "p1", planetID, req)
	if !ok {
		t.Fatal("expected sector scene view")
	}
	if view.DetailLevel != "sector" {
		t.Fatalf("unexpected detail level: %s", view.DetailLevel)
	}
	if len(view.Sectors) == 0 {
		t.Fatal("expected sector aggregates")
	}

	sec00 := findSector(view.Sectors, 0, 0)
	if sec00 == nil || sec00.BuildingCount != 1 {
		t.Fatalf("unexpected sector(0,0) aggregate: %+v", sec00)
	}
	sec10 := findSector(view.Sectors, 1, 0)
	if sec10 == nil || sec10.BuildingCount != 1 {
		t.Fatalf("unexpected sector(1,0) aggregate: %+v", sec10)
	}
	sec11 := findSector(view.Sectors, 1, 1)
	if sec11 == nil || sec11.UnitCount != 1 {
		t.Fatalf("unexpected sector(1,1) aggregate: %+v", sec11)
	}
	sec22 := findSector(view.Sectors, 2, 2)
	if sec22 == nil || sec22.ResourceCount != 1 {
		t.Fatalf("unexpected sector(2,2) aggregate: %+v", sec22)
	}
}

func TestPlanetSceneSectorModeDoesNotApplyTileClamp(t *testing.T) {
	ql, ws, planetID := newPlanetQueryFixture(t, 400, 300)
	ws.Buildings["b-far"] = &model.Building{ID: "b-far", OwnerID: "p1", Position: model.Position{X: 300, Y: 10}, VisionRange: 2}
	ws.Resources["r-far"] = &model.ResourceNodeState{ID: "r-far", PlanetID: planetID, Position: model.Position{X: 280, Y: 280}}

	req := PlanetSceneRequest{
		DetailLevel: "sector",
		MinX:        -20,
		MinY:        -20,
		MaxX:        500,
		MaxY:        500,
	}
	view, ok := ql.PlanetScene(ws, "p1", planetID, req)
	if !ok {
		t.Fatal("expected sector scene view")
	}
	if view.Bounds.MinX != 0 || view.Bounds.MinY != 0 || view.Bounds.MaxX != 399 || view.Bounds.MaxY != 299 {
		t.Fatalf("unexpected sector bounds: %+v", view.Bounds)
	}

	sec90 := findSector(view.Sectors, 9, 0)
	if sec90 == nil || sec90.BuildingCount != 1 {
		t.Fatalf("unexpected sector(9,0) aggregate: %+v", sec90)
	}
	sec88 := findSector(view.Sectors, 8, 8)
	if sec88 == nil || sec88.ResourceCount != 1 {
		t.Fatalf("unexpected sector(8,8) aggregate: %+v", sec88)
	}
}

func newPlanetQueryFixture(t *testing.T, width, height int) (*Layer, *model.WorldState, string) {
	t.Helper()

	planetID := "planet-1"
	terrainGrid := make([][]terrain.TileType, height)
	for y := 0; y < height; y++ {
		row := make([]terrain.TileType, width)
		for x := 0; x < width; x++ {
			row[x] = terrain.TileBuildable
		}
		terrainGrid[y] = row
	}

	universe := &mapmodel.Universe{
		Galaxies: map[string]*mapmodel.Galaxy{
			"galaxy-1": {ID: "galaxy-1", SystemIDs: []string{"sys-1"}},
		},
		Systems: map[string]*mapmodel.System{
			"sys-1": {ID: "sys-1", GalaxyID: "galaxy-1", PlanetIDs: []string{planetID}},
		},
		Planets: map[string]*mapmodel.Planet{
			planetID: {
				ID:       planetID,
				SystemID: "sys-1",
				Kind:     mapmodel.PlanetKindRocky,
				Width:    width,
				Height:   height,
				Terrain:  terrainGrid,
				Resources: []mapmodel.ResourceNode{
					{ID: "static-r-1", PlanetID: planetID, Position: mapmodel.GridPos{X: 1, Y: 1}, Kind: mapmodel.ResourceIronOre, Behavior: mapmodel.ResourceFinite, Total: 100, BaseYield: 1},
				},
			},
		},
		PrimaryGalaxyID: "galaxy-1",
		PrimaryPlanetID: planetID,
	}

	discovery := mapstate.NewDiscovery([]config.PlayerConfig{
		{PlayerID: "p1"},
		{PlayerID: "p2"},
	}, universe)
	ql := New(visibility.New(), universe, discovery)
	ws := model.NewWorldState(planetID, width, height)
	ws.Tick = 1
	return ql, ws, planetID
}

func containsResource(items []*model.ResourceNodeState, id string) bool {
	for _, item := range items {
		if item != nil && item.ID == id {
			return true
		}
	}
	return false
}

func findSector(items []PlanetSectorView, sectorX, sectorY int) *PlanetSectorView {
	for i := range items {
		if items[i].SectorX == sectorX && items[i].SectorY == sectorY {
			return &items[i]
		}
	}
	return nil
}
