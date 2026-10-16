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
	if cfg.Battlefield.TimeLimitTicks != 180000 {
		t.Fatalf("time limit %d, want 180000", cfg.Battlefield.TimeLimitTicks)
	}
	if cfg.Battlefield.BotFirstAttackTick != 60000 {
		t.Fatalf("bot first attack tick %d, want 60000", cfg.Battlefield.BotFirstAttackTick)
	}
	if cfg.Battlefield.ThreatGrowthScale != 1.5 {
		t.Fatalf("threat scale %v, want 1.5", cfg.Battlefield.ThreatGrowthScale)
	}
	if len(cfg.Players) < 1 {
		t.Fatal("skirmish config needs players")
	}
}

// 遭遇战开局物资包（第 16 轮：去掉资金维度后是实物）：数量够「3 风机 + 2 矿机 +
// 1 熔炉 + 若干电塔 + 20 传送带 + 4 分拣器」，双方同一份；bot 是 easy 难度。
func TestSkirmishStartsWithItemKit(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "config-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load config-skirmish: %v", err)
	}
	if len(cfg.Players) < 2 {
		t.Fatalf("skirmish needs p1/p2, got %d players", len(cfg.Players))
	}
	kitWant := map[string]int{
		"gear":          32,
		"circuit_board": 15,
		"iron_ingot":    96,
		"magnetic_coil": 22,
		"stone_brick":   3,
	}
	for _, pc := range cfg.Players {
		got := map[string]int{}
		for _, item := range pc.Bootstrap.Items {
			got[item.ItemID] = item.Quantity
		}
		if len(got) != len(kitWant) {
			t.Fatalf("%s bootstrap items = %v, want %v", pc.PlayerID, got, kitWant)
		}
		for itemID, qty := range kitWant {
			if got[itemID] != qty {
				t.Fatalf("%s bootstrap %s = %d, want %d", pc.PlayerID, itemID, got[itemID], qty)
			}
		}
	}
	if len(cfg.Players[0].Bootstrap.Items) != len(cfg.Players[1].Bootstrap.Items) {
		t.Fatalf("both sides must start from the same kit: %+v vs %+v", cfg.Players[0].Bootstrap, cfg.Players[1].Bootstrap)
	}
	if cfg.Players[1].Bot != "easy" {
		t.Fatalf("bot difficulty = %q, want easy", cfg.Players[1].Bot)
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
