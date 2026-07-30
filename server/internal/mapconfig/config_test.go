package mapconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyDefaultsSetsPlanetScaleToTwoThousand(t *testing.T) {
	cfg := &Config{}

	ApplyDefaults(cfg)

	if cfg.Planet.Width != 2000 {
		t.Fatalf("expected default planet width 2000, got %d", cfg.Planet.Width)
	}
	if cfg.Planet.Height != 2000 {
		t.Fatalf("expected default planet height 2000, got %d", cfg.Planet.Height)
	}
}

func TestLoadReadsSpawnPoints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "map.yaml")
	content := `planet:
  width: 64
  height: 64
spawn_points:
  - {x: 8, y: 8}
  - {x: 55, y: 55}
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write map config: %v", err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load map config: %v", err)
	}
	if len(cfg.SpawnPoints) != 2 || cfg.SpawnPoints[0] != (SpawnPointConfig{X: 8, Y: 8}) || cfg.SpawnPoints[1] != (SpawnPointConfig{X: 55, Y: 55}) {
		t.Fatalf("expected spawn points parsed, got %+v", cfg.SpawnPoints)
	}
}

func TestLoadRejectsOutOfBoundsSpawnPoint(t *testing.T) {
	path := filepath.Join(t.TempDir(), "map.yaml")
	content := `planet:
  width: 64
  height: 64
spawn_points:
  - {x: 64, y: 8}
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write map config: %v", err)
	}
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "spawn_points") {
		t.Fatalf("expected out-of-bounds spawn point rejected, got %v", err)
	}
}
