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

	if cfg.Planet.FaceSize != 816 {
		t.Fatalf("expected default planet width 816, got %d", cfg.Planet.FaceSize)
	}
	if cfg.Planet.FaceSize != 816 {
		t.Fatalf("expected default planet height 816, got %d", cfg.Planet.FaceSize)
	}
}

func TestLoadReadsSpawnPoints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "map.yaml")
	content := `planet:
  face_size: 64
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
  face_size: 64
spawn_points:
  - {x: 192, y: 8}
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write map config: %v", err)
	}
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "spawn_points") {
		t.Fatalf("expected out-of-bounds spawn point rejected, got %v", err)
	}
}

func TestLoadRejectsLegacyPlanarDimensions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "map.yaml")
	if err := os.WriteFile(path, []byte("planet:\n  width: 64\n  height: 64\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("legacy width/height must not silently generate a different world")
	}
}
