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
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 2,
		RetentionTicks: 1000,
	})

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
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionTicks: 5,
		RetentionCount: 10,
	})

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
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 2,
		RetentionTicks: 1000,
	})

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
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 10,
		RetentionTicks: 1000,
	})

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
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 10,
		RetentionTicks: 1000,
	})

	store.SaveSnapshot(testSnapshot(5))
	store.SaveSnapshot(testSnapshot(10))
	store.SaveSnapshot(testSnapshot(15))

	if trimmed := store.TrimAfter(10); trimmed != 1 {
		t.Fatalf("expected 1 snapshot trimmed, got %d", trimmed)
	}
	if snap := store.SnapshotAt(15); snap != nil {
		t.Fatalf("expected snapshot at tick 15 trimmed")
	}
	if snap := store.SnapshotAt(10); snap == nil {
		t.Fatalf("expected snapshot at tick 10 retained")
	}
}

func TestStoreReplaceAllSnapshotsAndAudit(t *testing.T) {
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 4,
		RetentionTicks: 100,
	})

	store.ReplaceSnapshots(testSnapshot(1), testSnapshot(9))
	store.ReplaceAudit([]*model.AuditEntry{{Tick: 9, PlayerID: "p1", Action: "command"}})

	if snap := store.SnapshotAtOrBefore(9); snap == nil || snap.Tick != 9 {
		t.Fatalf("expected restored latest snapshot")
	}
	if got := len(store.AuditEntries()); got != 1 {
		t.Fatalf("expected restored audit entries, got %d", got)
	}
}

func TestStoreReplaceSnapshotsSkipsInvalidAndLastWins(t *testing.T) {
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionCount: 8,
		RetentionTicks: 100,
	})

	firstTick2 := testSnapshot(2)
	firstTick2.World.PlanetID = "planet-first"
	lastTick2 := testSnapshot(2)
	lastTick2.World.PlanetID = "planet-last"
	invalid := &snapshot.Snapshot{Version: 0, Tick: 3}

	store.ReplaceSnapshots(testSnapshot(1), firstTick2, invalid, lastTick2)

	snaps := store.Snapshots()
	if len(snaps) != 2 {
		t.Fatalf("expected only valid snapshots retained, got %d", len(snaps))
	}
	if snaps[0].Tick != 1 || snaps[1].Tick != 2 {
		t.Fatalf("expected ticks 1 and 2, got %d and %d", snaps[0].Tick, snaps[1].Tick)
	}
	if snaps[1].World == nil || snaps[1].World.PlanetID != "planet-last" {
		t.Fatalf("expected duplicate tick to keep last snapshot")
	}
	if snap := store.SnapshotAtOrBefore(3); snap == nil || snap.Tick != 2 {
		t.Fatalf("expected invalid tick 3 snapshot skipped")
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
