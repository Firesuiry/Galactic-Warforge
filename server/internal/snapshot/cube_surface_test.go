package snapshot

import (
	"siliconworld/internal/model"
	"testing"
)

func TestRejectLegacyPlanarSnapshot(t *testing.T) {
	snap := CaptureWorld(model.NewWorldState("planet", 4))
	snap.Surface.Topology = ""
	if _, err := snap.Restore(); err == nil {
		t.Fatal("legacy planar save must be rejected")
	}
}
