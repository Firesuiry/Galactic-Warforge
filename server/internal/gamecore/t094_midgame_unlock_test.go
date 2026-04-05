package gamecore

import (
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func TestT094OfficialMidgameBuildCommandsAreNoLongerBlockedByResearch(t *testing.T) {
	core := newOfficialMidgameTestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	if exec := player.ExecutorForPlanet(ws.PlanetID); exec != nil {
		exec.OperateRange = 100
	}
	player.SyncLegacyExecutor(ws.PlanetID)

	cases := []struct {
		name  string
		pos   model.Position
		btype model.BuildingType
	}{
		{
			name:  "recomposing assembler",
			pos:   model.Position{X: 8, Y: 6},
			btype: model.BuildingTypeRecomposingAssembler,
		},
		{
			name:  "pile sorter",
			pos:   model.Position{X: 8, Y: 7},
			btype: model.BuildingTypePileSorter,
		},
		{
			name:  "advanced mining machine",
			pos:   model.Position{X: 10, Y: 7},
			btype: model.BuildingTypeAdvancedMiningMachine,
		},
	}

	for _, tc := range cases {
		res := issueInternalCommand(core, "p1", model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &tc.pos},
			Payload: map[string]any{
				"building_type": string(tc.btype),
			},
		})
		if strings.Contains(res.Message, "requires research to unlock") {
			t.Fatalf("expected %s not to be blocked by research, got %s (%s)", tc.name, res.Code, res.Message)
		}
	}
}

func TestT094OfficialMidgameStillBlocksPhotonModeWithoutDiracInversion(t *testing.T) {
	core := newOfficialMidgameTestCore(t)
	ws := core.World()

	receiver := newBuilding("rr-t094", model.BuildingTypeRayReceiver, "p1", model.Position{X: 6, Y: 6})
	receiver.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, receiver)

	res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdSetRayReceiverMode,
		Payload: map[string]any{
			"building_id": receiver.ID,
			"mode":        "photon",
		},
	})
	if res.Code == model.CodeOK {
		t.Fatalf("expected photon mode to stay locked in official midgame, got %+v", res)
	}
	if !strings.Contains(res.Message, "dirac_inversion") {
		t.Fatalf("expected photon lock to mention dirac_inversion, got %+v", res)
	}
}

func newOfficialMidgameTestCore(t *testing.T) *GameCore {
	t.Helper()

	cfgPath := filepath.Join("..", "..", "config-midgame.yaml")
	mapCfgPath := filepath.Join("..", "..", "map-midgame.yaml")

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load midgame config: %v", err)
	}
	cfg.Server.DataDir = t.TempDir()

	mapCfg, err := mapconfig.Load(mapCfgPath)
	if err != nil {
		t.Fatalf("load midgame map config: %v", err)
	}

	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	return New(cfg, maps, queue.New(), NewEventBus(), nil)
}
