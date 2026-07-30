package gamecore

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// A finite node mined down to zero must flip its depleted marker so scene
// output can render it as exhausted instead of a live resource point.
func TestMineResourceMarksFiniteNodeDepleted(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	node := &model.ResourceNodeState{
		ID:           "r1",
		PlanetID:     ws.PlanetID,
		Kind:         "crude_oil",
		Behavior:     "finite",
		MaxAmount:    100,
		Remaining:    5,
		BaseYield:    8,
		CurrentYield: 8,
	}
	ws.Resources["r1"] = node
	ws.Grid[0][0].ResourceNodeID = "r1"
	miner := &model.Building{ID: "miner", Position: model.Position{X: 0, Y: 0}}

	if got := mineResource(ws, miner, 8); got != 5 {
		t.Fatalf("expected to extract remaining 5, got %d", got)
	}
	if node.Remaining != 0 || !node.Depleted {
		t.Fatalf("expected node depleted at remaining 0, got remaining=%d depleted=%v", node.Remaining, node.Depleted)
	}
}

// Renewable nodes deplete when drained and recover the marker once regen
// brings the remaining amount back above zero.
func TestRenewableNodeDepletedFollowsRegen(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	node := &model.ResourceNodeState{
		ID:           "r1",
		PlanetID:     ws.PlanetID,
		Kind:         "water",
		Behavior:     "renewable",
		MaxAmount:    100,
		Remaining:    3,
		BaseYield:    8,
		CurrentYield: 8,
		RegenPerTick: 2,
	}
	ws.Resources["r1"] = node
	ws.Grid[0][0].ResourceNodeID = "r1"
	pump := &model.Building{ID: "pump", Position: model.Position{X: 0, Y: 0}}

	if got := mineResource(ws, pump, 8); got != 3 {
		t.Fatalf("expected to extract remaining 3, got %d", got)
	}
	if !node.Depleted {
		t.Fatal("expected renewable node depleted after being drained")
	}

	regenResourceNodes(ws)
	if node.Remaining != 2 || node.Depleted {
		t.Fatalf("expected regen to clear depleted marker, got remaining=%d depleted=%v", node.Remaining, node.Depleted)
	}
}

// A node without any amount to extract is depleted from the start.
func TestSyncDepletedTreatsZeroMaxAmountAsDepleted(t *testing.T) {
	node := &model.ResourceNodeState{MaxAmount: 0, Remaining: 0}
	node.SyncDepleted()
	if !node.Depleted {
		t.Fatal("expected max_amount=0 node to be depleted")
	}
	node = &model.ResourceNodeState{MaxAmount: 10, Remaining: 10}
	node.SyncDepleted()
	if node.Depleted {
		t.Fatal("expected stocked node to not be depleted")
	}
}

// The depleted marker must reach API consumers: present when depleted,
// omitted otherwise.
func TestResourceNodeDepletedJSONShape(t *testing.T) {
	depleted, err := json.Marshal(model.ResourceNodeState{ID: "r1", MaxAmount: 100, Remaining: 0, Depleted: true})
	if err != nil {
		t.Fatalf("marshal depleted node: %v", err)
	}
	if !strings.Contains(string(depleted), `"depleted":true`) {
		t.Fatalf("expected depleted:true in payload, got %s", depleted)
	}
	live, err := json.Marshal(model.ResourceNodeState{ID: "r1", MaxAmount: 100, Remaining: 50})
	if err != nil {
		t.Fatalf("marshal live node: %v", err)
	}
	if strings.Contains(string(live), "depleted") {
		t.Fatalf("expected depleted to be omitted for live nodes, got %s", live)
	}
}

// Build validation treats depleted nodes like any other tile: the point
// stays on the map but no longer blocks construction.
func TestBuildOnDepletedResourceNodeAllowed(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "solar_collection")

	pos, err := findOpenTileNearExecutor(ws, "p1")
	if err != nil {
		t.Fatalf("find open tile near executor: %v", err)
	}
	node := &model.ResourceNodeState{
		ID:        "r-depleted",
		PlanetID:  ws.PlanetID,
		Kind:      "crude_oil",
		Behavior:  "finite",
		Position:  *pos,
		MaxAmount: 100,
		Remaining: 0,
	}
	node.SyncDepleted()
	if !node.Depleted {
		t.Fatal("test setup: node must be depleted")
	}
	ws.Resources[node.ID] = node
	ws.Grid[pos.Y][pos.X].ResourceNodeID = node.ID

	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("building on a depleted resource node must be allowed, got %s (%s)", res.Status, res.Message)
	}
}

// findOpenTileNearExecutor returns the closest buildable, unoccupied,
// resource-free tile inside the player's executor operate range.
func findOpenTileNearExecutor(ws *model.WorldState, playerID string) (*model.Position, error) {
	player := ws.Players[playerID]
	if player == nil {
		return nil, fmt.Errorf("player %s missing", playerID)
	}
	execState := player.ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		return nil, fmt.Errorf("player %s has no executor on %s", playerID, ws.PlanetID)
	}
	execUnit, ok := ws.Units[execState.UnitID]
	if !ok {
		return nil, fmt.Errorf("executor unit %s missing", execState.UnitID)
	}
	center := execUnit.Position
	for dist := 0; dist <= execState.OperateRange; dist++ {
		for y := center.Y - dist; y <= center.Y+dist; y++ {
			for x := center.X - dist; x <= center.X+dist; x++ {
				pos := model.Position{X: x, Y: y}
				if model.ManhattanDist(center, pos) != dist {
					continue
				}
				if !ws.InBounds(x, y) || !ws.Grid[y][x].Terrain.Buildable() {
					continue
				}
				if ws.Grid[y][x].ResourceNodeID != "" {
					continue
				}
				if _, occupied := ws.TileBuilding[model.TileKey(x, y)]; occupied {
					continue
				}
				return &pos, nil
			}
		}
	}
	return nil, fmt.Errorf("no open tile within range %d of executor at %v", execState.OperateRange, center)
}
