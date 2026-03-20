package persistence_test

import (
	"testing"
	"time"

	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/terrain"
)

func TestSnapshotPolicyShouldSnapshot(t *testing.T) {
	policy := persistence.SnapshotPolicy{IntervalTicks: 5}
	if !policy.ShouldSnapshot(0) {
		t.Fatalf("expected tick 0 to match interval")
	}
	if !policy.ShouldSnapshot(5) {
		t.Fatalf("expected tick 5 to match interval")
	}
	if policy.ShouldSnapshot(6) {
		t.Fatalf("expected tick 6 to miss interval")
	}
}

func TestStoreRetentionByCount(t *testing.T) {
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 2,
		RetentionTicks: 1000,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	store.SaveSnapshot(testSnapshot(1))
	store.SaveSnapshot(testSnapshot(2))
	store.SaveSnapshot(testSnapshot(3))

	snaps := store.Snapshots()
	if len(snaps) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(snaps))
	}
	if snaps[0].Tick != 2 || snaps[1].Tick != 3 {
		t.Fatalf("expected ticks 2,3 got %d,%d", snaps[0].Tick, snaps[1].Tick)
	}
}

func TestStoreRetentionByTick(t *testing.T) {
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionTicks: 5,
		RetentionCount: 10,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	store.SaveSnapshot(testSnapshot(10))
	store.SaveSnapshot(testSnapshot(12))
	store.SaveSnapshot(testSnapshot(16))

	snaps := store.Snapshots()
	if len(snaps) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(snaps))
	}
	if snaps[0].Tick != 12 || snaps[1].Tick != 16 {
		t.Fatalf("expected ticks 12,16 got %d,%d", snaps[0].Tick, snaps[1].Tick)
	}
}

func TestCommandLogCutoffTick(t *testing.T) {
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 2,
		RetentionTicks: 1000,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	store.SaveSnapshot(testSnapshot(4))
	store.SaveSnapshot(testSnapshot(8))
	if got := store.OldestSnapshotTick(); got != 4 {
		t.Fatalf("expected oldest tick 4, got %d", got)
	}
	store.SaveSnapshot(testSnapshot(12))
	if got := store.OldestSnapshotTick(); got != 8 {
		t.Fatalf("expected oldest tick 8 after prune, got %d", got)
	}
}

func TestSnapshotLookup(t *testing.T) {
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 10,
		RetentionTicks: 1000,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	store.SaveSnapshot(testSnapshot(5))
	store.SaveSnapshot(testSnapshot(10))

	if snap := store.SnapshotAt(5); snap == nil || snap.Tick != 5 {
		t.Fatalf("expected snapshot at tick 5")
	}
	if snap := store.SnapshotAt(6); snap != nil {
		t.Fatalf("expected no snapshot at tick 6")
	}
	if snap := store.SnapshotAtOrBefore(7); snap == nil || snap.Tick != 5 {
		t.Fatalf("expected snapshot at or before tick 7 to be 5")
	}
	if snap := store.SnapshotAtOrBefore(0); snap == nil || snap.Tick != 5 {
		t.Fatalf("expected earliest snapshot for tick 0 lookup")
	}
}

func TestStoreTrimAfter(t *testing.T) {
	store, err := persistence.New(t.TempDir(), persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 10,
		RetentionTicks: 1000,
	})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	store.SaveSnapshot(testSnapshot(5))
	store.SaveSnapshot(testSnapshot(10))
	store.SaveSnapshot(testSnapshot(15))

	if err := store.SaveDelta("cmdlog", 5, 6, []byte("delta-1")); err != nil {
		t.Fatalf("save delta: %v", err)
	}
	if err := store.SaveDelta("cmdlog", 10, 12, []byte("delta-2")); err != nil {
		t.Fatalf("save delta: %v", err)
	}

	trimmedSnaps, trimmedDeltas := store.TrimAfter(10)
	if trimmedSnaps == 0 {
		t.Fatalf("expected snapshots trimmed")
	}
	if trimmedDeltas == 0 {
		t.Fatalf("expected deltas trimmed")
	}
	if snap := store.SnapshotAt(15); snap != nil {
		t.Fatalf("expected snapshot at tick 15 trimmed")
	}
	if snap := store.SnapshotAt(10); snap == nil {
		t.Fatalf("expected snapshot at tick 10 retained")
	}
	stats := store.SnapshotStats()
	if stats.LatestSnapshotTick != 10 {
		t.Fatalf("expected latest snapshot tick 10, got %d", stats.LatestSnapshotTick)
	}
	if stats.DeltaCount != 1 {
		t.Fatalf("expected 1 delta retained, got %d", stats.DeltaCount)
	}
}

func testSnapshot(tick int64) *snapshot.Snapshot {
	return &snapshot.Snapshot{
		Version:   snapshot.CurrentVersion,
		Tick:      tick,
		Timestamp: time.Unix(0, 0).UTC(),
		World: &snapshot.WorldSnapshot{
			Tick:      tick,
			PlanetID:  "p-1",
			MapWidth:  1,
			MapHeight: 1,
			Players:   map[string]*model.PlayerState{},
			Buildings: map[string]*snapshot.BuildingSnapshot{},
			Units:     map[string]*model.Unit{},
			Resources: map[string]*model.ResourceNodeState{},
			Terrain:   [][]terrain.TileType{{terrain.TileBuildable}},
		},
	}
}
