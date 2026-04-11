package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestT094OfficialMidgameBootstrapAddsLeafUnlocksWithoutDiracInversion(t *testing.T) {
	cfgPath := filepath.Join("..", "..", "config-midgame.yaml")
	mapCfgPath := filepath.Join("..", "..", "map-midgame.yaml")

	rawCfg, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read midgame config: %v", err)
	}

	tempCfgPath := filepath.Join(t.TempDir(), "config-midgame.yaml")
	rewritten := strings.Replace(string(rawCfg), `data_dir: "data-midgame"`, `data_dir: "`+t.TempDir()+`"`, 1)
	if err := os.WriteFile(tempCfgPath, []byte(rewritten), 0o644); err != nil {
		t.Fatalf("write temp midgame config: %v", err)
	}

	app, err := LoadRuntime(tempCfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load official midgame runtime: %v", err)
	}
	defer app.Stop()

	for _, playerID := range []string{"p1", "p2"} {
		player := app.Core.World().Players[playerID]
		if player == nil || player.Tech == nil {
			t.Fatalf("expected player %s bootstrap tech state, got %+v", playerID, player)
		}
		for _, techID := range []string{"integrated_logistics", "photon_mining", "annihilation"} {
			if player.Tech.CompletedTechs[techID] == 0 {
				t.Fatalf("expected player %s to bootstrap %s, got %+v", playerID, techID, player.Tech.CompletedTechs)
			}
		}
		if player.Tech.CompletedTechs["dirac_inversion"] != 0 {
			t.Fatalf("expected player %s not to bootstrap dirac_inversion, got %+v", playerID, player.Tech.CompletedTechs)
		}
	}
}

func TestT094OfficialMidgameBootstrapCreatesDysonValidationAnchors(t *testing.T) {
	cfgPath := filepath.Join("..", "..", "config-midgame.yaml")
	mapCfgPath := filepath.Join("..", "..", "map-midgame.yaml")

	rawCfg, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read midgame config: %v", err)
	}

	tempCfgPath := filepath.Join(t.TempDir(), "config-midgame.yaml")
	rewritten := strings.Replace(string(rawCfg), `data_dir: "data-midgame"`, `data_dir: "`+t.TempDir()+`"`, 1)
	if err := os.WriteFile(tempCfgPath, []byte(rewritten), 0o644); err != nil {
		t.Fatalf("write temp midgame config: %v", err)
	}

	app, err := LoadRuntime(tempCfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load official midgame runtime: %v", err)
	}
	defer app.Stop()

	if got := app.Core.ActivePlanetID(); got != "planet-1-2" {
		t.Fatalf("expected active planet planet-1-2, got %s", got)
	}

	ws := app.Core.World()
	if ws == nil {
		t.Fatal("expected active world")
	}
	if ws.PlanetID != "planet-1-2" {
		t.Fatalf("expected active world planet-1-2, got %s", ws.PlanetID)
	}

	var ejectorCount int
	var siloCount int
	var receiverCount int
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != "p1" {
			continue
		}
		switch building.Type {
		case model.BuildingTypeEMRailEjector:
			ejectorCount++
		case model.BuildingTypeVerticalLaunchingSilo:
			siloCount++
		case model.BuildingTypeRayReceiver:
			receiverCount++
		}
	}

	if ejectorCount == 0 || siloCount == 0 || receiverCount == 0 {
		t.Fatalf(
			"expected official midgame bootstrap to place dyson buildings, got ejectors=%d silos=%d receivers=%d",
			ejectorCount,
			siloCount,
			receiverCount,
		)
	}

	systemRuntime := app.Core.SpaceRuntime().PlayerSystem("p1", "sys-1")
	if systemRuntime == nil {
		t.Fatal("expected system runtime bootstrap for sys-1")
	}
	if systemRuntime.DysonSphere == nil || len(systemRuntime.DysonSphere.Layers) == 0 {
		t.Fatalf("expected dyson sphere layers in bootstrap runtime, got %+v", systemRuntime.DysonSphere)
	}
	if len(systemRuntime.DysonSphere.Layers[0].Nodes) == 0 && len(systemRuntime.DysonSphere.Layers[0].Shells) == 0 {
		t.Fatalf("expected bootstrap dyson scaffold, got %+v", systemRuntime.DysonSphere.Layers[0])
	}
	if systemRuntime.SolarSailOrbit == nil || len(systemRuntime.SolarSailOrbit.Sails) == 0 {
		t.Fatalf("expected bootstrap solar sail orbit, got %+v", systemRuntime.SolarSailOrbit)
	}
}
