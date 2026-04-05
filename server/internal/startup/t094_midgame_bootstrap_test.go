package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
