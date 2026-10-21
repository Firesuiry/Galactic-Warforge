package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 第 22 轮契约 §1：开局只在出生星球（InitialActivePlanetID）给每个玩家建基站、
// 造一台绑定的机甲、发一次 bootstrap；其它已加载行星什么都不建（没有基站、
// 没有机甲、没有物资），必须靠 dispatch_mecha 把机甲投送过去。
func TestMultiPlanetStarterMechaBindsOnlyStarterPlanet(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:               "multi-starter-seed",
			MaxTickRate:           10,
			InitialActivePlanetID: "planet-1-2",
			EnemyDifficulty:       "off",
		},
		Players: []config.PlayerConfig{
			{
				PlayerID: "p1",
				Key:      "key1",
				Bootstrap: config.PlayerBootstrapConfig{Items: []config.BootstrapItemConfig{
					{ItemID: model.ItemIronIngot, Quantity: 100},
					{ItemID: model.ItemGear, Quantity: 40},
				}},
			},
			{
				PlayerID: "p2",
				Key:      "key2",
				Bootstrap: config.PlayerBootstrapConfig{Items: []config.BootstrapItemConfig{
					{ItemID: model.ItemIronIngot, Quantity: 100},
					{ItemID: model.ItemGear, Quantity: 40},
				}},
			},
		},
		Server: config.ServerConfig{Port: 9999},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 2, GasGiantRatio: 0},
		Planet: mapconfig.PlanetConfig{FaceSize: 24, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core := New(cfg, maps, queue.New(), NewEventBus(), nil)

	planetA := core.WorldForPlanet("planet-1-1")
	planetB := core.WorldForPlanet("planet-1-2")
	if planetA == nil || planetB == nil {
		t.Fatalf("expected both planets loaded, got A=%v B=%v", planetA != nil, planetB != nil)
	}
	// 出生星球 = 全局活动行星（planet-1-2，InitialActivePlanetID）。
	starterPlanetID := core.ActivePlanetID()
	if starterPlanetID != "planet-1-2" {
		t.Fatalf("active planet = %s, want planet-1-2", starterPlanetID)
	}
	worlds := map[string]*model.WorldState{"planet-1-1": planetA, "planet-1-2": planetB}
	otherPlanetID := "planet-1-1"
	for _, playerID := range []string{"p1", "p2"} {
		player := planetA.Players[playerID]
		if player == nil {
			t.Fatalf("player %s missing", playerID)
		}
		bound := 0
		var boundRecord *model.MechaRecord
		for _, record := range player.SortedMechas() {
			if record.Operator != "" {
				if record.Operator != playerID {
					t.Fatalf("%s: unexpected operator %q on %s", playerID, record.Operator, record.UnitID)
				}
				bound++
				boundRecord = record
			}
		}
		if bound != 1 {
			t.Fatalf("%s: starter mecha bound to player must be exactly 1, got %d", playerID, bound)
		}
		if boundRecord.PlanetID != starterPlanetID {
			t.Fatalf("%s: bound mecha must be on the starter planet %s, got %s", playerID, starterPlanetID, boundRecord.PlanetID)
		}
		if got := boundRecord.Inventory[model.ItemIronIngot]; got != 100 {
			t.Fatalf("%s: bootstrap iron = %d, want 100 (only once)", playerID, got)
		}
		if got := boundRecord.Inventory[model.ItemGear]; got != 40 {
			t.Fatalf("%s: bootstrap gear = %d, want 40 (only once)", playerID, got)
		}
		// 非出生行星上什么都没有：没有基站、没有机甲。
		other := worlds[otherPlanetID]
		if other == nil {
			t.Fatalf("%s: expected runtime for %s", playerID, otherPlanetID)
		}
		if record := mechaOnPlanet(other, playerID, otherPlanetID); record != nil {
			t.Fatalf("%s: non-starter planet must not get a starter mecha, got %s", playerID, record.UnitID)
		}
		for _, unit := range other.Units {
			if unit != nil && unit.OwnerID == playerID {
				t.Fatalf("%s: non-starter planet must not get any unit, got %s", playerID, unit.ID)
			}
		}
		for _, building := range other.Buildings {
			if building != nil && building.OwnerID == playerID {
				t.Fatalf("%s: non-starter planet must not get a base, got %s", playerID, building.ID)
			}
		}
		if playerHasFootholdOnWorld(other, playerID) {
			t.Fatalf("%s: non-starter planet must not have a foothold", playerID)
		}
	}
}
