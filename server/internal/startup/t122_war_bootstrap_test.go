package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestT122OfficialWarScenarioBootstrapsAuthoritativeWarAnchors(t *testing.T) {
	cfgPath := filepath.Join("..", "..", "config-war.yaml")
	mapCfgPath := filepath.Join("..", "..", "map-war.yaml")

	rawCfg, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read war config: %v", err)
	}

	tempCfgPath := filepath.Join(t.TempDir(), "config-war.yaml")
	rewritten := strings.Replace(string(rawCfg), `data_dir: "data-war"`, `data_dir: "`+t.TempDir()+`"`, 1)
	if err := os.WriteFile(tempCfgPath, []byte(rewritten), 0o644); err != nil {
		t.Fatalf("write temp war config: %v", err)
	}

	app, err := LoadRuntime(tempCfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load official war runtime: %v", err)
	}
	defer app.Stop()

	if got := app.Core.ActivePlanetID(); got != "planet-1-1" {
		t.Fatalf("expected active planet planet-1-1, got %s", got)
	}

	ws := app.Core.World()
	if ws == nil {
		t.Fatal("expected active world")
	}
	if ws.PlanetID != "planet-1-1" {
		t.Fatalf("expected active world planet-1-1, got %s", ws.PlanetID)
	}

	for _, playerID := range []string{"p1", "p2"} {
		player := ws.Players[playerID]
		if player == nil || player.Tech == nil {
			t.Fatalf("expected player %s bootstrap tech state, got %+v", playerID, player)
		}
		for _, techID := range []string{
			"battlefield_analysis",
			"prototype",
			"precision_drone",
			"corvette",
			"destroyer",
			"integrated_logistics",
		} {
			if player.Tech.CompletedTechs[techID] == 0 {
				t.Fatalf("expected player %s to bootstrap %s, got %+v", playerID, techID, player.Tech.CompletedTechs)
			}
		}
	}

	for _, playerID := range []string{"p1", "p2"} {
		if got := countOwnedBuildingsByTypeT122(ws, playerID, model.BuildingTypeRecomposingAssembler); got < 1 {
			t.Fatalf("expected player %s to have recomposing assembler anchor, got %d", playerID, got)
		}
		if got := countOwnedBuildingsByTypeT122(ws, playerID, model.BuildingTypePlanetaryLogisticsStation); got < 1 {
			t.Fatalf("expected player %s to have planetary logistics anchor, got %d", playerID, got)
		}
		if got := countOwnedBuildingsByTypeT122(ws, playerID, model.BuildingTypeInterstellarLogisticsStation); got < 1 {
			t.Fatalf("expected player %s to have interstellar logistics anchor, got %d", playerID, got)
		}
	}

	if got := totalInventoryByTypeT122(ws, "p1", model.BuildingTypePlanetaryLogisticsStation, model.ItemAmmoBullet); got <= 0 {
		t.Fatalf("expected p1 planetary logistics station to preload ammo, got %d", got)
	}
	if got := totalInventoryByTypeT122(ws, "p1", model.BuildingTypeInterstellarLogisticsStation, model.ItemHydrogenFuelRod); got <= 0 {
		t.Fatalf("expected p1 interstellar logistics station to preload fuel, got %d", got)
	}
}

func countOwnedBuildingsByTypeT122(ws *model.WorldState, ownerID string, buildingType model.BuildingType) int {
	if ws == nil {
		return 0
	}
	count := 0
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != ownerID || building.Type != buildingType {
			continue
		}
		count++
	}
	return count
}

func totalInventoryByTypeT122(ws *model.WorldState, ownerID string, buildingType model.BuildingType, itemID string) int {
	if ws == nil {
		return 0
	}
	total := 0
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != ownerID || building.Type != buildingType {
			continue
		}
		if building.Storage != nil {
			total += building.Storage.Inventory[itemID]
		}
		if station := ws.LogisticsStations[building.ID]; station != nil {
			total += station.Inventory[itemID]
		}
	}
	return total
}
