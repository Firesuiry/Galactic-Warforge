package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

// G6: 非气态巨星星球拒绝建造 orbital_collector，并给出可读错误码与提示。
func TestOrbitalCollectorBuildRejectedOnNonGasGiant(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	planet, ok := core.Maps().Planet(ws.PlanetID)
	if !ok || planet == nil {
		t.Fatalf("expected planet %s in maps", ws.PlanetID)
	}
	if planet.Kind == mapmodel.PlanetKindGasGiant {
		t.Skip("test planet is unexpectedly a gas giant")
	}

	grantTechs(ws, "p1", "gas_giants")
	grantAllItems(ws, "p1", 100)

	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find open tile: %v", err)
	}

	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeOrbitalCollector),
		},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected code %s, got %s (%q)", model.CodeInvalidTarget, res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "气态巨行星") {
		t.Fatalf("expected readable gas giant hint, got %q", res.Message)
	}
}

// G6: 气态巨星星球通过建造校验（不再以 gas giant 为由拒绝）。
func TestOrbitalCollectorBuildAdmittedOnGasGiant(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	core.Maps().Planets["gas-1"] = &mapmodel.Planet{
		ID:       "gas-1",
		SystemID: planetSystemID(core.Maps(), ws.PlanetID),
		Kind:     mapmodel.PlanetKindGasGiant,
		Width:    3,
		Height:   2,
	}

	gasWs := model.NewWorldState("gas-1", 1)
	gasWs.Players = ws.Players

	grantTechs(ws, "p1", "gas_giants")
	player := ws.Players["p1"]
	player.Resources.Energy = 100000
	// 第 21 轮：build 由发令者机甲执行，必须把一台机甲放到 gas-1 上。
	stats := model.UnitStats(model.UnitTypeExecutor)
	gasMecha := &stats
	gasMecha.ID = "u-gas"
	gasMecha.OwnerID = "p1"
	gasMecha.Position = model.Position{X: 0, Y: 0}
	gasWs.Units[gasMecha.ID] = gasMecha
	// 玩家身份已绑定 planet-1-1 的开局机甲：这台 gas-1 机甲改绑给专用发令者。
	player.EnsureMechas()[gasMecha.ID] = &model.MechaRecord{UnitID: gasMecha.ID, PlanetID: gasWs.PlanetID, Operator: "p1-gas"}
	// 故意不发放建造物品：若通过气态巨星校验，应在物品成本处失败。
	pos := model.Position{X: 0, Y: 0}

	res, _ := execCommandAs(core, model.CmdBuild, gasWs, "p1", "p1-gas", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeOrbitalCollector),
		},
	})
	if strings.Contains(res.Message, "气态巨行星") {
		t.Fatalf("expected gas giant gate to admit gas giant planet, got %q", res.Message)
	}
	if res.Code != model.CodeInsufficientResource {
		t.Fatalf("expected code %s after passing the gate, got %s (%q)", model.CodeInsufficientResource, res.Code, res.Message)
	}
}

func planetSystemID(maps *mapmodel.Universe, planetID string) string {
	if maps == nil {
		return ""
	}
	planet, _ := maps.Planet(planetID)
	if planet == nil {
		return ""
	}
	return planet.SystemID
}
