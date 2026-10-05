package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func TestPhase1BuildApproachWaitsAndMoves(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	executor := player.ExecutorForPlanet(ws.PlanetID)
	unit := ws.Units[executor.UnitID]
	var target *model.Position
	for _, p := range ws.SurfaceDisc(unit.Position, 32) {
		if core.requireBuildRange(ws, "p1", p) == nil || !ws.Grid[p.Y][p.X].Terrain.Buildable() || ws.TileBuilding[model.TileKey(p.X, p.Y)] != "" {
			continue
		}
		if u, path := planBuildApproach(ws, "p1", p); u != nil && len(path) > 1 {
			c := p
			target = &c
			break
		}
	}
	if target == nil {
		t.Fatal("no reachable out-of-range fixture")
	}

	def, _ := model.BuildingDefinitionByID(model.BuildingTypeWindTurbine)
	player.Resources.Minerals = 1000
	player.Resources.Energy = 1000
	player.AddItems(def.BuildCost.Items)
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{Target: model.CommandTarget{Position: target}, Payload: map[string]any{"building_type": "wind_turbine", "auto_approach": true, "rotation": 90}})
	if res.Code != model.CodeOK || !unit.HasPath() {
		t.Fatalf("approach rejected: %+v", res)
	}
	var task *model.ConstructionTask
	for _, candidate := range ws.Construction.Tasks {
		if candidate.Position == *target {
			task = candidate
		}
	}
	if task == nil || task.Rotation != model.PlanRotation90 {
		t.Fatal("rotation or construction missing")
	}
	core.settleConstructionQueue(ws)
	if task.State != model.ConstructionPending {
		t.Fatal("out-of-range construction started early")
	}
	for i := 0; i < 300 && unit.HasPath(); i++ {
		ws.Tick++
		settleUnitMovement(ws)
	}
	if unit.HasPath() || core.requireBuildRange(ws, "p1", *target) != nil {
		t.Fatal("executor never reached build range")
	}
	core.settleConstructionQueue(ws)
	if task.State != model.ConstructionInProgress {
		t.Fatalf("construction failed to start: %+v", task)
	}
}
