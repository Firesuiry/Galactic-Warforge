package model

import "testing"

func TestPowerGridGraphLineConnection(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	b1 := newTestBuilding("b1", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	b2 := newTestBuilding("b2", BuildingTypeWindTurbine, Position{X: 2, Y: 1})
	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2

	graph := BuildPowerGridGraph(ws)
	edge, ok := graph.Edges[b1.ID][b2.ID]
	if !ok {
		t.Fatalf("expected edge between %s and %s", b1.ID, b2.ID)
	}
	if edge.Kind != PowerLinkLine {
		t.Fatalf("expected line edge, got %s", edge.Kind)
	}
	if err := graph.Validate(); err != nil {
		t.Fatalf("validate graph: %v", err)
	}
}

func TestPowerGridGraphWirelessConnection(t *testing.T) {
	ws := NewWorldState("p1", 20, 20)
	b1 := newTestBuilding("b1", BuildingTypeWirelessPowerTower, Position{X: 1, Y: 1})
	b2 := newTestBuilding("b2", BuildingTypeWindTurbine, Position{X: 1 + DefaultWirelessPowerTowerRange - 1, Y: 1})
	b3 := newTestBuilding("b3", BuildingTypeWindTurbine, Position{X: 1 + DefaultWirelessPowerTowerRange + 1, Y: 1})
	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2
	ws.Buildings[b3.ID] = b3

	graph := BuildPowerGridGraph(ws)
	edge, ok := graph.Edges[b1.ID][b2.ID]
	if !ok {
		t.Fatalf("expected wireless edge between %s and %s", b1.ID, b2.ID)
	}
	if edge.Kind != PowerLinkWireless {
		t.Fatalf("expected wireless edge, got %s", edge.Kind)
	}
	if _, ok := graph.Edges[b1.ID][b3.ID]; ok {
		t.Fatalf("expected no edge between %s and %s", b1.ID, b3.ID)
	}
}

func TestPowerGridGraphRemoval(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	b1 := newTestBuilding("b1", BuildingTypeWindTurbine, Position{X: 3, Y: 3})
	b2 := newTestBuilding("b2", BuildingTypeWindTurbine, Position{X: 4, Y: 3})
	ws.Buildings[b1.ID] = b1
	ws.Buildings[b2.ID] = b2

	graph := BuildPowerGridGraph(ws)
	graph.RemoveBuilding(b2.ID)

	if graph.Nodes[b2.ID] != nil {
		t.Fatalf("expected node %s removed", b2.ID)
	}
	if len(graph.Edges[b1.ID]) != 0 {
		t.Fatalf("expected edges for %s cleared", b1.ID)
	}
	if err := graph.Validate(); err != nil {
		t.Fatalf("validate graph after removal: %v", err)
	}
}

func newTestBuilding(id string, btype BuildingType, pos Position) *Building {
	profile := BuildingProfileFor(btype, 1)
	return &Building{
		ID:       id,
		Type:     btype,
		OwnerID:  "player-1",
		Position: pos,
		Runtime:  profile.Runtime,
	}
}

// 无线覆盖半径收敛进建筑 runtime 定义（catalog 与电网结算同源，不再各自硬编码）。
func TestPowerGridWirelessRangeFromDefinition(t *testing.T) {
	cases := map[BuildingType]int{
		BuildingTypeTeslaTower:          DefaultTeslaTowerRange,
		BuildingTypeWirelessPowerTower:  DefaultWirelessPowerTowerRange,
		BuildingTypeSatelliteSubstation: DefaultSatelliteSubstationRange,
		BuildingTypeWindTurbine:         0,
	}
	for btype, want := range cases {
		if got := powerGridWirelessRange(btype); got != want {
			t.Errorf("powerGridWirelessRange(%s) = %d, want %d", btype, got, want)
		}
		def, ok := BuildingRuntimeDefinitionByID(btype)
		if !ok {
			t.Errorf("missing runtime definition for %s", btype)
			continue
		}
		if want > 0 && (def.Functions.PowerGrid == nil || def.Functions.PowerGrid.WirelessRange != want) {
			t.Errorf("expected %s power grid module wireless range %d, got %+v", btype, want, def.Functions.PowerGrid)
		}
		if want == 0 && def.Functions.PowerGrid != nil {
			t.Errorf("expected %s without power grid module, got %+v", btype, def.Functions.PowerGrid)
		}
	}

	// 放置后的建筑实例 runtime 从定义深拷贝，携带 power_grid 模块供前端读取。
	tower := newTestBuilding("t-1", BuildingTypeTeslaTower, Position{X: 0, Y: 0})
	if tower.Runtime.Functions.PowerGrid == nil || tower.Runtime.Functions.PowerGrid.WirelessRange != DefaultTeslaTowerRange {
		t.Fatalf("expected placed tesla tower to carry power grid module, got %+v", tower.Runtime.Functions.PowerGrid)
	}
}
