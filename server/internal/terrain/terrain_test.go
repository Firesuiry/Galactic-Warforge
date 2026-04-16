package terrain

import "testing"

func TestTileTypeBuildable(t *testing.T) {
	if !TileBuildable.Buildable() {
		t.Fatal("expected buildable tile to report true")
	}
	if TileBlocked.Buildable() {
		t.Fatal("expected blocked tile to report false")
	}
	if TileWater.Buildable() {
		t.Fatal("expected water tile to report false")
	}
}
