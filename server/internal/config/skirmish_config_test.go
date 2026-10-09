package config

import (
	"path/filepath"
	"testing"
)

func TestSkirmishConfigPaceAndTimeLimit(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "config-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load config-skirmish: %v", err)
	}
	if cfg.Battlefield.PaceResearch != 2 || cfg.Battlefield.PaceBuild != 2 || cfg.Battlefield.PaceOutput != 2 {
		t.Fatalf("unexpected pace: %+v", cfg.Battlefield)
	}
	if cfg.Battlefield.TimeLimitTicks != 54000 {
		t.Fatalf("time limit %d, want 54000", cfg.Battlefield.TimeLimitTicks)
	}
	if cfg.Battlefield.ThreatGrowthScale != 1.5 {
		t.Fatalf("threat scale %v, want 1.5", cfg.Battlefield.ThreatGrowthScale)
	}
	if len(cfg.Players) < 1 {
		t.Fatal("skirmish config needs players")
	}
}

// 开局物资包必须带 4 玻璃（矩阵研究站成本），双方同一份；
// 其余数量覆盖「风机×3、电感应塔×4、采矿机×4、电弧熔炉×2、制造台×1、传送带×20、矩阵研究站×1」。
func TestSkirmishKitIncludesMatrixLabGlass(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "config-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load config-skirmish: %v", err)
	}
	want := map[string]int{
		"iron_ingot": 110, "gear": 40, "magnetic_coil": 30,
		"circuit_board": 24, "stone_brick": 4, "glass": 4, "coal": 20,
	}
	if len(cfg.Players) < 2 {
		t.Fatalf("skirmish needs p1/p2, got %d players", len(cfg.Players))
	}
	for _, pc := range cfg.Players {
		got := map[string]int{}
		for _, item := range pc.Bootstrap.Inventory {
			got[item.ItemID] = item.Quantity
		}
		for itemID, qty := range want {
			if got[itemID] != qty {
				t.Fatalf("%s bootstrap %s = %d, want %d (%v)", pc.PlayerID, itemID, got[itemID], qty, got)
			}
		}
		if pc.Bootstrap.Minerals < 910 || pc.Bootstrap.Energy < 350 {
			t.Fatalf("%s kit resources too small for the opening combo: %+v", pc.PlayerID, pc.Bootstrap)
		}
	}
}

func TestApplyDefaultsKeepsHistoricalPace(t *testing.T) {
	cfg := &Config{Players: []PlayerConfig{{PlayerID: "p1", Key: "k"}}}
	if err := ApplyDefaults(cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Battlefield.PaceResearch != 1 || cfg.Battlefield.PaceBuild != 1 || cfg.Battlefield.PaceOutput != 1 || cfg.Battlefield.ThreatGrowthScale != 1 || cfg.Battlefield.TimeLimitTicks != 0 {
		t.Fatalf("defaults must match current pace, got %+v", cfg.Battlefield)
	}
}
