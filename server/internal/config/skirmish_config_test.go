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

func TestApplyDefaultsKeepsHistoricalPace(t *testing.T) {
	cfg := &Config{Players: []PlayerConfig{{PlayerID: "p1", Key: "k"}}}
	if err := ApplyDefaults(cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Battlefield.PaceResearch != 1 || cfg.Battlefield.PaceBuild != 1 || cfg.Battlefield.PaceOutput != 1 || cfg.Battlefield.ThreatGrowthScale != 1 || cfg.Battlefield.TimeLimitTicks != 0 {
		t.Fatalf("defaults must match current pace, got %+v", cfg.Battlefield)
	}
}
