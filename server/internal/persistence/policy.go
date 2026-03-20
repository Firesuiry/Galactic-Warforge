package persistence

const (
	// DefaultSnapshotIntervalTicks controls the default snapshot cadence.
	// At 10 tick/s, 100 ticks ~= 10 seconds.
	DefaultSnapshotIntervalTicks int64 = 100
	// DefaultSnapshotRetentionCount caps the number of retained snapshots.
	DefaultSnapshotRetentionCount = 60
	// DefaultSnapshotMaxBytes is the soft size ceiling for snapshot JSON payloads.
	DefaultSnapshotMaxBytes int64 = 2 * 1024 * 1024
	// DefaultSnapshotDeltaMaxBytes is the soft size ceiling for delta payloads.
	DefaultSnapshotDeltaMaxBytes int64 = 1 * 1024 * 1024
)

// SnapshotPolicy defines snapshot cadence and retention.
// Zero values are treated as "use defaults".
type SnapshotPolicy struct {
	IntervalTicks    int64 // full snapshot interval (tick-based)
	RetentionTicks   int64 // keep snapshots within the last N ticks
	RetentionCount   int   // keep at most N snapshots
	MaxSnapshotBytes int64 // warn when a snapshot exceeds this size
	MaxDeltaBytes    int64 // warn when a delta exceeds this size
}

// Normalize fills missing values with defaults and returns a sanitized policy.
func (p SnapshotPolicy) Normalize() SnapshotPolicy {
	if p.IntervalTicks <= 0 {
		p.IntervalTicks = DefaultSnapshotIntervalTicks
	}
	if p.RetentionCount <= 0 {
		p.RetentionCount = DefaultSnapshotRetentionCount
	}
	if p.RetentionTicks <= 0 {
		p.RetentionTicks = p.IntervalTicks * int64(p.RetentionCount)
	}
	if p.MaxSnapshotBytes <= 0 {
		p.MaxSnapshotBytes = DefaultSnapshotMaxBytes
	}
	if p.MaxDeltaBytes <= 0 {
		p.MaxDeltaBytes = DefaultSnapshotDeltaMaxBytes
	}
	return p
}

// ShouldSnapshot returns true when the tick matches the policy interval.
func (p SnapshotPolicy) ShouldSnapshot(tick int64) bool {
	p = p.Normalize()
	if p.IntervalTicks <= 0 {
		return true
	}
	return tick%p.IntervalTicks == 0
}
