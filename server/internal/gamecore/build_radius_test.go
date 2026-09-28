package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// D2 建造半径：建造中心覆盖范围内无需执行体在场即可建造；范围外回退执行体校验。

func TestD2BuildRadiusAllowsRemoteBuildNearHQ(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Minerals = 10000
	player.Resources.Energy = 10000
	grantAllItems(ws, "p1", 100)

	// HQ 在 (20,20)，执行体在游戏初始位置（远离目标点）。
	hq := newBuilding("hq-d2", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 20, Y: 20})
	hq.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, hq)

	// HQ 半径（24）内、执行体操作范围外的可建格：应可建造。
	execState := player.ExecutorForPlanet(ws.PlanetID)
	execUnit := ws.Units[execState.UnitID]
	var target *model.Position
	for _, candidate := range ws.SurfaceDisc(hq.Position, 20) {
		if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() || ws.TileBuilding[model.TileKey(candidate.X, candidate.Y)] != "" {
			continue
		}
		d := ws.SurfaceDistance(hq.Position, candidate)
		if d < 8 || d > 20 {
			continue
		}
		if ws.SurfaceDistance(execUnit.Position, candidate) <= execState.OperateRange {
			continue
		}
		c := candidate
		target = &c
		break
	}
	if target == nil {
		t.Fatal("test setup: no buildable tile inside HQ radius outside executor range")
	}
	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: target},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("build inside HQ radius rejected: %+v", res)
	}

	// 远离 HQ 且远离执行体的位置：必须拒绝。
	far := model.Position{X: 90, Y: 90}
	if ws.SurfaceDistance(hq.Position, far) <= 24 {
		t.Fatal("test setup: far point inside HQ radius")
	}
	res, _ = core.execBuild(ws, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &far},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code == model.CodeOK {
		t.Fatal("build outside both HQ radius and executor range must be rejected")
	}
}
