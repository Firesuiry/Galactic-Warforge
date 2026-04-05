package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestT103BuildAccessMatchesPublicClosure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	pos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile for automatic_piler: %v", err)
	}
	if pos == nil {
		t.Fatal("expected open tile for automatic_piler test")
	}

	automaticPilerRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: pos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeAutomaticPiler),
		},
	})
	if automaticPilerRes.Code != model.CodeValidationFailed || !strings.Contains(automaticPilerRes.Message, "building type not buildable") {
		t.Fatalf("expected automatic_piler to be rejected as not buildable, got code=%s message=%q", automaticPilerRes.Code, automaticPilerRes.Message)
	}

	satellitePos, err := findOpenTile(ws, 2)
	if err != nil {
		t.Fatalf("find open tile for satellite_substation: %v", err)
	}
	if satellitePos == nil {
		t.Fatal("expected open tile for satellite_substation test")
	}

	lockedSatelliteRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: satellitePos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeSatelliteSubstation),
		},
	})
	if lockedSatelliteRes.Code != model.CodeValidationFailed || !strings.Contains(lockedSatelliteRes.Message, "requires research to unlock") {
		t.Fatalf("expected locked satellite_substation to require research, got code=%s message=%q", lockedSatelliteRes.Code, lockedSatelliteRes.Message)
	}

	grantTechs(ws, "p1", "satellite_power")

	unlockedSatelliteRes, _ := core.execBuild(ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: satellitePos},
		Payload: map[string]any{
			"building_type": string(model.BuildingTypeSatelliteSubstation),
		},
	})
	if unlockedSatelliteRes.Code != model.CodeOK {
		t.Fatalf("expected satellite_substation to be buildable after satellite_power, got code=%s message=%q", unlockedSatelliteRes.Code, unlockedSatelliteRes.Message)
	}
}
