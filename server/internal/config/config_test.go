package config

import "testing"

func TestApplyDefaultsFillsServerAndPlayerDefaults(t *testing.T) {
	cfg := &Config{
		Players: []PlayerConfig{{
			PlayerID: "p1",
			Key:      "key-1",
		}},
	}

	if err := ApplyDefaults(cfg); err != nil {
		t.Fatalf("apply defaults: %v", err)
	}

	if cfg.Battlefield.MaxTickRate != 10 {
		t.Fatalf("expected default tick rate 10, got %d", cfg.Battlefield.MaxTickRate)
	}
	if cfg.Server.SnapshotMaxEvents != 200 {
		t.Fatalf("expected default snapshot max events 200, got %d", cfg.Server.SnapshotMaxEvents)
	}
	if cfg.Server.DataDir != "data" {
		t.Fatalf("expected default data dir data, got %q", cfg.Server.DataDir)
	}
	if cfg.Players[0].TeamID != "p1" {
		t.Fatalf("expected default team_id p1, got %q", cfg.Players[0].TeamID)
	}
	if cfg.Players[0].Role != "commander" {
		t.Fatalf("expected default role commander, got %q", cfg.Players[0].Role)
	}
	if len(cfg.Players[0].Permissions) != 1 || cfg.Players[0].Permissions[0] != "*" {
		t.Fatalf("expected commander wildcard permissions, got %+v", cfg.Players[0].Permissions)
	}
}

func TestApplyDefaultsRejectsNegativeAutoSaveInterval(t *testing.T) {
	cfg := &Config{
		Players: []PlayerConfig{{
			PlayerID: "p1",
			Key:      "key-1",
		}},
		Server: ServerConfig{
			AutoSaveIntervalSeconds: -1,
		},
	}

	if err := ApplyDefaults(cfg); err == nil {
		t.Fatal("expected negative auto save interval to be rejected")
	}
}
