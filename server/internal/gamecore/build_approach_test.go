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
	site := findApproachSite(t, core, ws, "p1", model.BuildingTypeWindTurbine, 2)
	target = &site

	def, _ := model.BuildingDefinitionByID(model.BuildingTypeWindTurbine)
	player.Resources.Energy = 1000
	player.AddItems(def.BuildCost.Items, 0)
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

// findApproachSite 找一个「超出建造中心半径、但机甲能走到作业范围内」的施工点。
// 细分网格下建造中心半径 ×3（HQ 24→72），"HQ 附近随手一个格子"多半仍在范围内，
// 必须整块 footprint 可落、且真的需要走近才建。
func findApproachSite(t *testing.T, core *GameCore, ws *model.WorldState, playerID string, btype model.BuildingType, minPath int) model.Position {
	t.Helper()
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		t.Fatalf("unknown building type %s", btype)
	}
	// 细分网格：建造中心半径 ×3（HQ 24→72）后，测试地图（96×64，最远 72 格）里
	// 已不存在"超出建造中心范围"的格子，auto_approach 无从触发。这些测试关心的是
	// "走近再建"的机制本身，因此把建造中心临时让开（HP=0 会被 requireBuildRange
	// 跳过），退回执行体作业半径，并保证它足够大。
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID {
			continue
		}
		d, ok := model.BuildingDefinitionByID(b.Type)
		if ok && d.BuildRadius > 0 {
			b.HP = 0 // 让开建造中心，退回执行体作业半径
		}
	}
	if exec := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID); exec != nil && exec.OperateRange < 12 {
		exec.OperateRange = 12
	}
	exec := ws.Players[playerID].ExecutorForPlanet(ws.PlanetID)
	start := model.Position{}
	if exec != nil {
		if u := ws.Units[exec.UnitID]; u != nil {
			start = u.Position
		}
	}
	// SurfaceDisc 按图距由近及远返回，取第一个"整块可落 + 需要走近"的点，
	// 保证行走距离尽量短（否则机甲的能量与 tick 预算会成为不稳定因素）。
	for _, p := range ws.SurfaceDisc(start, 64) {
		if !ws.FootprintFits(p, def.Footprint, btype, "") {
			continue
		}
		unit, path := planBuildApproach(ws, playerID, p)
		if unit == nil || len(path) < minPath {
			continue
		}
		return p
	}
	t.Fatalf("no reachable build site for %s", btype)
	return model.Position{}
}
