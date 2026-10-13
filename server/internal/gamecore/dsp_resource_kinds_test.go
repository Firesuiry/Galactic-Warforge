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

// 每种资源节点 kind 都在物品目录里登记同名物品，采集产物即该物品。
func TestCollectorOutputItemIDCoversAllResourceKinds(t *testing.T) {
	kinds := mapmodel.AllResourceKinds()
	// 细分网格：采集覆盖 = 占地 + 1 圈，行主序取第一个覆盖到的资源格——相邻的
	// 资源格会互相"串味"。这里每个 kind 之间隔开足够远（每 8 格一个），
	// 用 1×1 的建筑让覆盖范围内只有它自己的资源格。
	ws := &model.WorldState{
		Resources: map[string]*model.ResourceNodeState{},
		MapWidth:  8 * len(kinds),
		MapHeight: 1,
	}
	ws.Grid = make([][]model.MapTile, 1)
	ws.Grid[0] = make([]model.MapTile, 8*len(kinds))
	for i, kind := range kinds {
		x := i * 8
		nodeID := "node-" + string(kind)
		ws.Resources[nodeID] = &model.ResourceNodeState{ID: nodeID, Kind: string(kind)}
		ws.Grid[0][x].ResourceNodeID = nodeID
		b := &model.Building{Type: model.BuildingTypeConveyorBeltMk1, Position: model.Position{X: x, Y: 0}}
		if got := collectorOutputItemID(ws, b); got != string(kind) {
			t.Fatalf("kind %s: want same-named catalog item, got %q", kind, got)
		}
	}
	if got := resourceKindToItemID("not_a_resource"); got != "" {
		t.Fatalf("unknown kind must yield no item, got %q", got)
	}
}
