package persistence

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

// Store persists audit logs and tick snapshots
type Store struct {
	mu          sync.Mutex
	dataDir     string
	snapshotDir string
	deltaDir    string
	policy      SnapshotPolicy
	auditLog    []*model.AuditEntry
	snapshots   []snapshotRecord
	deltas      []deltaRecord
}

func New(dataDir string, policy SnapshotPolicy) (*Store, error) {
	if dataDir == "" {
		return nil, fmt.Errorf("data dir is required")
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	snapshotDir := filepath.Join(dataDir, "snapshots")
	deltaDir := filepath.Join(dataDir, "deltas")
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return nil, fmt.Errorf("create snapshot dir: %w", err)
	}
	if err := os.MkdirAll(deltaDir, 0o755); err != nil {
		return nil, fmt.Errorf("create delta dir: %w", err)
	}
	return &Store{
		dataDir:     dataDir,
		snapshotDir: snapshotDir,
		deltaDir:    deltaDir,
		policy:      policy.Normalize(),
	}, nil
}

// SnapshotPolicy returns a copy of the current snapshot policy.
func (s *Store) SnapshotPolicy() SnapshotPolicy {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.policy
}

// AppendAudit records an audit entry in memory and optionally to disk
func (s *Store) AppendAudit(entry *model.AuditEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditLog = append(s.auditLog, entry)
}

// SaveSnapshot saves a world state snapshot
func (s *Store) SaveSnapshot(snap *snapshot.Snapshot) {
	if snap == nil {
		return
	}
	data, err := snapshot.Encode(snap)
	if err != nil {
		log.Printf("[Persistence] marshal snapshot: %v", err)
		return
	}
	rec := snapshotRecord{
		Snapshot:  snap,
		Tick:      snap.Tick,
		Path:      s.snapshotPath(snap.Tick),
		SizeBytes: int64(len(data)),
		SavedAt:   time.Now().UTC(),
	}
	if s.policy.MaxSnapshotBytes > 0 && rec.SizeBytes > s.policy.MaxSnapshotBytes {
		log.Printf("[Persistence] snapshot %d size %d exceeds limit %d", rec.Tick, rec.SizeBytes, s.policy.MaxSnapshotBytes)
	}

	var droppedSnapshots []snapshotRecord
	var droppedDeltas []deltaRecord

	s.mu.Lock()
	// Upsert by tick (replace if same tick)
	insertAt := sort.Search(len(s.snapshots), func(i int) bool {
		return s.snapshots[i].Tick >= rec.Tick
	})
	if insertAt < len(s.snapshots) && s.snapshots[insertAt].Tick == rec.Tick {
		s.snapshots[insertAt] = rec
	} else {
		s.snapshots = append(s.snapshots, snapshotRecord{})
		copy(s.snapshots[insertAt+1:], s.snapshots[insertAt:])
		s.snapshots[insertAt] = rec
	}

	latestTick := rec.Tick
	if len(s.snapshots) > 0 {
		latestTick = s.snapshots[len(s.snapshots)-1].Tick
	}
	droppedSnapshots = append(droppedSnapshots, s.pruneSnapshotsLocked(latestTick)...)
	minTick := s.oldestSnapshotTickLocked()
	droppedDeltas = append(droppedDeltas, s.pruneDeltasLocked(minTick)...)
	s.mu.Unlock()

	if err := os.WriteFile(rec.Path, data, 0o644); err != nil {
		log.Printf("[Persistence] write snapshot: %v", err)
	}

	s.deleteSnapshotFiles(droppedSnapshots)
	s.deleteDeltaFiles(droppedDeltas)
}

// MaybeSaveSnapshot persists a snapshot only when the policy interval matches.
func (s *Store) MaybeSaveSnapshot(snap *snapshot.Snapshot) bool {
	if snap == nil {
		return false
	}
	if !s.policy.ShouldSnapshot(snap.Tick) {
		return false
	}
	s.SaveSnapshot(snap)
	return true
}

// SaveDelta stores an incremental record between snapshots.
func (s *Store) SaveDelta(kind string, fromTick, toTick int64, payload []byte) error {
	if strings.TrimSpace(kind) == "" {
		return fmt.Errorf("delta kind is required")
	}
	if fromTick < 0 || toTick < 0 || toTick < fromTick {
		return fmt.Errorf("invalid delta tick range %d-%d", fromTick, toTick)
	}
	if len(payload) == 0 {
		return fmt.Errorf("delta payload is empty")
	}

	path := s.deltaPath(kind, fromTick, toTick)
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return fmt.Errorf("write delta: %w", err)
	}

	rec := deltaRecord{
		Kind:      kind,
		FromTick:  fromTick,
		ToTick:    toTick,
		Path:      path,
		SizeBytes: int64(len(payload)),
		SavedAt:   time.Now().UTC(),
	}
	if s.policy.MaxDeltaBytes > 0 && rec.SizeBytes > s.policy.MaxDeltaBytes {
		log.Printf("[Persistence] delta %s %d-%d size %d exceeds limit %d", kind, fromTick, toTick, rec.SizeBytes, s.policy.MaxDeltaBytes)
	}

	var dropped []deltaRecord
	s.mu.Lock()
	s.deltas = append(s.deltas, rec)
	minTick := s.oldestSnapshotTickLocked()
	dropped = append(dropped, s.pruneDeltasLocked(minTick)...)
	s.mu.Unlock()

	s.deleteDeltaFiles(dropped)
	return nil
}

// FlushAuditLog writes the in-memory audit log to disk
func (s *Store) FlushAuditLog() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.dataDir, "audit.jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open audit log: %w", err)
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	for _, entry := range s.auditLog {
		if err := enc.Encode(entry); err != nil {
			return fmt.Errorf("write audit entry: %w", err)
		}
	}
	s.auditLog = nil
	return nil
}

// AuditEntries returns a copy of all in-memory audit entries
func (s *Store) AuditEntries() []*model.AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]*model.AuditEntry, len(s.auditLog))
	copy(cp, s.auditLog)
	return cp
}

// QueryAudit returns audit entries matching the filter.
func (s *Store) QueryAudit(q model.AuditQuery) []*model.AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.auditLog) == 0 {
		return nil
	}

	limit := q.Limit
	if limit < 0 {
		limit = 0
	}

	matches := func(entry *model.AuditEntry) bool {
		if entry == nil {
			return false
		}
		if q.PlayerID != "" && entry.PlayerID != q.PlayerID {
			return false
		}
		if q.IssuerType != "" && entry.IssuerType != q.IssuerType {
			return false
		}
		if q.IssuerID != "" && entry.IssuerID != q.IssuerID {
			return false
		}
		if q.Action != "" && entry.Action != q.Action {
			return false
		}
		if q.RequestID != "" && entry.RequestID != q.RequestID {
			return false
		}
		if q.Permission != "" && entry.Permission != q.Permission {
			return false
		}
		if q.PermissionGranted != nil {
			if entry.PermissionGranted == nil || *entry.PermissionGranted != *q.PermissionGranted {
				return false
			}
		}
		if q.FromTick != nil && entry.Tick < *q.FromTick {
			return false
		}
		if q.ToTick != nil && entry.Tick > *q.ToTick {
			return false
		}
		if q.FromTime != nil && entry.Timestamp.Before(*q.FromTime) {
			return false
		}
		if q.ToTime != nil && entry.Timestamp.After(*q.ToTime) {
			return false
		}
		return true
	}

	desc := q.Order == "desc"
	out := make([]*model.AuditEntry, 0, len(s.auditLog))
	if desc {
		for i := len(s.auditLog) - 1; i >= 0; i-- {
			entry := s.auditLog[i]
			if !matches(entry) {
				continue
			}
			out = append(out, entry)
			if limit > 0 && len(out) >= limit {
				break
			}
		}
		return out
	}

	for _, entry := range s.auditLog {
		if !matches(entry) {
			continue
		}
		out = append(out, entry)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// TrimAuditBeforeTick drops audit entries strictly before the given tick.
func (s *Store) TrimAuditBeforeTick(tick int64) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.auditLog) == 0 {
		return 0
	}
	kept := s.auditLog[:0]
	removed := 0
	for _, entry := range s.auditLog {
		if entry == nil || entry.Tick >= tick {
			kept = append(kept, entry)
		} else {
			removed++
		}
	}
	s.auditLog = kept
	return removed
}

// TrimAuditAfterTick drops audit entries strictly after the given tick.
func (s *Store) TrimAuditAfterTick(tick int64) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.auditLog) == 0 {
		return 0
	}
	kept := s.auditLog[:0]
	removed := 0
	for _, entry := range s.auditLog {
		if entry == nil || entry.Tick <= tick {
			kept = append(kept, entry)
		} else {
			removed++
		}
	}
	s.auditLog = kept
	return removed
}

// Snapshots returns all in-memory snapshots
func (s *Store) Snapshots() []*snapshot.Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]*snapshot.Snapshot, len(s.snapshots))
	for i, rec := range s.snapshots {
		cp[i] = rec.Snapshot
	}
	return cp
}

// SnapshotAt returns the snapshot stored at the exact tick.
func (s *Store) SnapshotAt(tick int64) *snapshot.Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.snapshots) == 0 {
		return nil
	}
	idx := sort.Search(len(s.snapshots), func(i int) bool {
		return s.snapshots[i].Tick >= tick
	})
	if idx < len(s.snapshots) && s.snapshots[idx].Tick == tick {
		return s.snapshots[idx].Snapshot
	}
	return nil
}

// SnapshotAtOrBefore returns the latest snapshot at or before the tick.
// If tick <= 0, the earliest snapshot is returned.
func (s *Store) SnapshotAtOrBefore(tick int64) *snapshot.Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.snapshots) == 0 {
		return nil
	}
	if tick <= 0 {
		return s.snapshots[0].Snapshot
	}
	idx := sort.Search(len(s.snapshots), func(i int) bool {
		return s.snapshots[i].Tick > tick
	})
	if idx == 0 {
		return nil
	}
	return s.snapshots[idx-1].Snapshot
}

// OldestSnapshotTick returns the earliest retained snapshot tick.
// This value is the safe lower bound for trimming command logs.
func (s *Store) OldestSnapshotTick() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.oldestSnapshotTickLocked()
}

// SnapshotStats provides a lightweight summary of retained snapshot data.
type SnapshotStats struct {
	SnapshotCount      int
	DeltaCount         int
	SnapshotBytes      int64
	DeltaBytes         int64
	OldestSnapshotTick int64
	LatestSnapshotTick int64
}

// SnapshotStats returns aggregate snapshot storage statistics.
func (s *Store) SnapshotStats() SnapshotStats {
	s.mu.Lock()
	defer s.mu.Unlock()

	stats := SnapshotStats{
		SnapshotCount: len(s.snapshots),
		DeltaCount:    len(s.deltas),
	}
	if len(s.snapshots) > 0 {
		stats.OldestSnapshotTick = s.snapshots[0].Tick
		stats.LatestSnapshotTick = s.snapshots[len(s.snapshots)-1].Tick
	}
	for _, rec := range s.snapshots {
		stats.SnapshotBytes += rec.SizeBytes
	}
	for _, rec := range s.deltas {
		stats.DeltaBytes += rec.SizeBytes
	}
	return stats
}

// TrimAfter drops snapshots and deltas strictly after the given tick.
func (s *Store) TrimAfter(tick int64) (int, int) {
	var droppedSnapshots []snapshotRecord
	var droppedDeltas []deltaRecord

	s.mu.Lock()
	if len(s.snapshots) > 0 {
		cut := sort.Search(len(s.snapshots), func(i int) bool {
			return s.snapshots[i].Tick > tick
		})
		if cut < len(s.snapshots) {
			droppedSnapshots = append(droppedSnapshots, s.snapshots[cut:]...)
			s.snapshots = s.snapshots[:cut]
		}
	}
	if len(s.deltas) > 0 {
		kept := s.deltas[:0]
		for _, rec := range s.deltas {
			if rec.FromTick > tick || rec.ToTick > tick {
				droppedDeltas = append(droppedDeltas, rec)
				continue
			}
			kept = append(kept, rec)
		}
		s.deltas = kept
	}
	s.mu.Unlock()

	s.deleteSnapshotFiles(droppedSnapshots)
	s.deleteDeltaFiles(droppedDeltas)

	return len(droppedSnapshots), len(droppedDeltas)
}

type snapshotRecord struct {
	Snapshot  *snapshot.Snapshot
	Tick      int64
	Path      string
	SizeBytes int64
	SavedAt   time.Time
}

type deltaRecord struct {
	Kind      string
	FromTick  int64
	ToTick    int64
	Path      string
	SizeBytes int64
	SavedAt   time.Time
}

func (s *Store) snapshotPath(tick int64) string {
	return filepath.Join(s.snapshotDir, fmt.Sprintf("snapshot-%d.json", tick))
}

func (s *Store) deltaPath(kind string, fromTick, toTick int64) string {
	return filepath.Join(s.deltaDir, fmt.Sprintf("delta-%d-%d-%s.jsonl", fromTick, toTick, sanitizeKind(kind)))
}

func sanitizeKind(kind string) string {
	if kind == "" {
		return "unknown"
	}
	kind = strings.TrimSpace(kind)
	buf := make([]byte, 0, len(kind))
	for i := 0; i < len(kind); i++ {
		ch := kind[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			buf = append(buf, ch)
		}
	}
	if len(buf) == 0 {
		return "unknown"
	}
	return strings.ToLower(string(buf))
}

func (s *Store) pruneSnapshotsLocked(latestTick int64) []snapshotRecord {
	if len(s.snapshots) == 0 {
		return nil
	}

	var dropped []snapshotRecord
	if s.policy.RetentionTicks > 0 {
		cutoffTick := latestTick - s.policy.RetentionTicks
		dropIndex := 0
		for dropIndex < len(s.snapshots) && s.snapshots[dropIndex].Tick < cutoffTick {
			dropped = append(dropped, s.snapshots[dropIndex])
			dropIndex++
		}
		s.snapshots = s.snapshots[dropIndex:]
	}

	if s.policy.RetentionCount > 0 && len(s.snapshots) > s.policy.RetentionCount {
		extra := len(s.snapshots) - s.policy.RetentionCount
		dropped = append(dropped, s.snapshots[:extra]...)
		s.snapshots = s.snapshots[extra:]
	}
	return dropped
}

func (s *Store) pruneDeltasLocked(minTick int64) []deltaRecord {
	if len(s.deltas) == 0 || minTick <= 0 {
		return nil
	}
	var dropped []deltaRecord
	kept := s.deltas[:0]
	for _, rec := range s.deltas {
		if rec.ToTick < minTick {
			dropped = append(dropped, rec)
			continue
		}
		kept = append(kept, rec)
	}
	s.deltas = kept
	return dropped
}

func (s *Store) oldestSnapshotTickLocked() int64 {
	if len(s.snapshots) == 0 {
		return 0
	}
	return s.snapshots[0].Tick
}

func (s *Store) deleteSnapshotFiles(records []snapshotRecord) {
	for _, rec := range records {
		if err := os.Remove(rec.Path); err != nil && !os.IsNotExist(err) {
			log.Printf("[Persistence] remove snapshot %s: %v", rec.Path, err)
		}
	}
}

func (s *Store) deleteDeltaFiles(records []deltaRecord) {
	for _, rec := range records {
		if err := os.Remove(rec.Path); err != nil && !os.IsNotExist(err) {
			log.Printf("[Persistence] remove delta %s: %v", rec.Path, err)
		}
	}
}
