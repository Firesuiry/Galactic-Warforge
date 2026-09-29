package mapconfig

import (
	"path/filepath"
	"testing"
)

func TestDefaultMapKeepsLargeFaceSize(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "map.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Planet.FaceSize != 816 {
		t.Fatalf("default face_size changed to %d", cfg.Planet.FaceSize)
	}
	if cfg.Planet.Resources.ContestedCenter {
		t.Fatal("default map must not enable contested_center")
	}
}

func TestSkirmishMapConfigFaceSize(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "map-skirmish.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Planet.FaceSize < 64 || cfg.Planet.FaceSize > 128 {
		t.Fatalf("face_size %d outside 64-128", cfg.Planet.FaceSize)
	}
	if !cfg.Planet.Resources.ContestedCenter {
		t.Fatal("skirmish map must enable contested_center")
	}
}
