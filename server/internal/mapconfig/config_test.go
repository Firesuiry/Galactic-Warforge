package mapconfig

import "testing"

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
