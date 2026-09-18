package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func TestManualMineItemAllowsVegetationRenewables(t *testing.T) {
	cases := []struct {
		name     string
		node     *model.ResourceNodeState
		wantOK   bool
		wantItem string
	}{
		{
			name: "renewable log node is hand-minable",
			node: &model.ResourceNodeState{
				Kind:     string(mapmodel.ResourceLog),
				Behavior: string(mapmodel.ResourceRenewable),
			},
			wantOK:   true,
			wantItem: model.ItemLog,
		},
		{
			name: "renewable plant fuel node is hand-minable",
			node: &model.ResourceNodeState{
				Kind:     string(mapmodel.ResourcePlantFuel),
				Behavior: string(mapmodel.ResourceRenewable),
			},
			wantOK:   true,
			wantItem: model.ItemPlantFuel,
		},
		{
			name: "finite rare ore stays hand-minable",
			node: &model.ResourceNodeState{
				Kind:     string(mapmodel.ResourceKimberliteOre),
				Behavior: string(mapmodel.ResourceFinite),
			},
			wantOK:   true,
			wantItem: model.ItemKimberliteOre,
		},
		{
			name: "renewable water is liquid and excluded",
			node: &model.ResourceNodeState{
				Kind:     string(mapmodel.ResourceWater),
				Behavior: string(mapmodel.ResourceRenewable),
			},
			wantOK: false,
		},
		{
			name: "decay crude oil remains excluded",
			node: &model.ResourceNodeState{
				Kind:     string(mapmodel.ResourceCrudeOil),
				Behavior: string(mapmodel.ResourceDecay),
			},
			wantOK: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			itemID, ok := manualMineItem(tc.node)
			if ok != tc.wantOK {
				t.Fatalf("manualMineItem ok mismatch: want %v got %v", tc.wantOK, ok)
			}
			if ok && itemID != tc.wantItem {
				t.Fatalf("manualMineItem item mismatch: want %s got %s", tc.wantItem, itemID)
			}
		})
	}
}

func TestCollectorOutputItemIDCoversNewKinds(t *testing.T) {
	ws := &model.WorldState{
		Resources: map[string]*model.ResourceNodeState{},
		MapWidth:  len(testCollectorKinds),
		MapHeight: 1,
	}
	// resourceNodeForBuilding resolves through the grid, so exercise the kind
	// switch directly via a building parked on each node.
	ws.Grid = make([][]model.MapTile, 1)
	ws.Grid[0] = make([]model.MapTile, len(testCollectorKinds))
	for i, kc := range testCollectorKinds {
		nodeID := "node-" + kc.kind
		ws.Resources[nodeID] = &model.ResourceNodeState{ID: nodeID, Kind: kc.kind}
		ws.Grid[0][i].ResourceNodeID = nodeID
		b := &model.Building{Position: model.Position{X: i, Y: 0}}
		got := collectorOutputItemID(ws, b)
		if got != kc.wantItem {
			t.Fatalf("kind %s: want item %s got %q", kc.kind, kc.wantItem, got)
		}
	}
}

var testCollectorKinds = []struct {
	kind     string
	wantItem string
}{
	{kind: string(mapmodel.ResourceKimberliteOre), wantItem: model.ItemKimberliteOre},
	{kind: string(mapmodel.ResourceSpiniformStalagmiteCrystal), wantItem: model.ItemSpiniformStalagmiteCrystal},
	{kind: string(mapmodel.ResourceOrganicCrystal), wantItem: model.ItemOrganicCrystal},
	{kind: string(mapmodel.ResourceSulfuricAcid), wantItem: model.ItemSulfuricAcid},
	{kind: string(mapmodel.ResourceLog), wantItem: model.ItemLog},
	{kind: string(mapmodel.ResourcePlantFuel), wantItem: model.ItemPlantFuel},
}
