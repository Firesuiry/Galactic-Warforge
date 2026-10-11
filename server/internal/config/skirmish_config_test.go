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

// 无开局物资包：双方背包为空，minerals/energy 只留「第一座风机通电前」的启动量
// （这两者在通电前没有任何产出途径，必须给，否则死锁）；bot 是 easy 难度。
func TestSkirmishStartsWithoutKit(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "config-skirmish.yaml"))
	if err != nil {
		t.Fatalf("load config-skirmish: %v", err)
	}
	if len(cfg.Players) < 2 {
		t.Fatalf("skirmish needs p1/p2, got %d players", len(cfg.Players))
	}
	for _, pc := range cfg.Players {
		if len(pc.Bootstrap.Inventory) != 0 {
			t.Fatalf("%s bootstrap inventory must be empty, got %v", pc.PlayerID, pc.Bootstrap.Inventory)
		}
		// 启动量必须够「手搓 → 建第一座风机/电塔/矿机」：风机 30 矿物 + 齿轮/铁块/磁线圈，
		// 再加 2 座电塔（20 矿物/座）与第二座矿机（50 矿物）。实测 200 矿物时 bot
		// 正好把 3 风机 + 2 矿机建完就归零，连 20 矿物的电塔都建不起，整局冻结。
		if pc.Bootstrap.Minerals < 300 || pc.Bootstrap.Minerals > 800 {
			t.Fatalf("%s minerals = %d, want a small starter amount (300–800)", pc.PlayerID, pc.Bootstrap.Minerals)
		}
		if pc.Bootstrap.Energy < 50 || pc.Bootstrap.Energy > 200 {
			t.Fatalf("%s energy = %d, want a small starter amount (50–200)", pc.PlayerID, pc.Bootstrap.Energy)
		}
	}
	if cfg.Players[0].Bootstrap.Minerals != cfg.Players[1].Bootstrap.Minerals ||
		cfg.Players[0].Bootstrap.Energy != cfg.Players[1].Bootstrap.Energy {
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
