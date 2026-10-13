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
	// 细分网格：cell 单位把遭遇战地图从 96 格放大到 288 cell（×3），
	// 世界尺度不变；旧 96 会让出生点间距与基地布局全部错位。
	if cfg.Planet.FaceSize != 288 {
		t.Fatalf("face_size = %d, want 288 (96 cells x 3)", cfg.Planet.FaceSize)
	}
	if !cfg.Planet.Resources.ContestedCenter {
		t.Fatal("skirmish map must enable contested_center")
	}
}
