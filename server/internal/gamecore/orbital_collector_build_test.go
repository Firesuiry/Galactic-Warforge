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

	res, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeOrbitalCollector),
		},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected code %s, got %s (%q)", model.CodeInvalidTarget, res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "gas giant") {
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
	player.Resources.Minerals = 100000
	player.Resources.Energy = 100000
	// 故意不发放建造物品：若通过气态巨星校验，应在物品成本处失败。
	pos := model.Position{X: 0, Y: 0}

	res, _ := core.execBuild(gasWs, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeOrbitalCollector),
		},
	})
	if strings.Contains(res.Message, "gas giant") {
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
