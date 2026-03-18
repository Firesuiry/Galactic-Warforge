package persistence

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// AuditEntry records a single auditable action
type AuditEntry struct {
	Timestamp time.Time      `json:"timestamp"`
	RequestID string         `json:"request_id"`
	PlayerID  string         `json:"player_id"`
	Tick      int64          `json:"tick"`
	Action    string         `json:"action"`
	Details   map[string]any `json:"details,omitempty"`
}

// SnapshotEntry is a serialised world state snapshot
type SnapshotEntry struct {
	Tick      int64          `json:"tick"`
	Timestamp time.Time      `json:"timestamp"`
	State     map[string]any `json:"state"`
}

// Store persists audit logs and tick snapshots
type Store struct {
	mu        sync.Mutex
	dataDir   string
	auditLog  []*AuditEntry
	snapshots []*SnapshotEntry
}

func New(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	return &Store{dataDir: dataDir}, nil
}

// AppendAudit records an audit entry in memory and optionally to disk
func (s *Store) AppendAudit(entry *AuditEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditLog = append(s.auditLog, entry)
}

// SaveSnapshot saves a world state snapshot
func (s *Store) SaveSnapshot(snap *SnapshotEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshots = append(s.snapshots, snap)

	// Persist to disk asynchronously
	go func() {
		path := filepath.Join(s.dataDir, fmt.Sprintf("snapshot-%d.json", snap.Tick))
		data, err := json.MarshalIndent(snap, "", "  ")
		if err != nil {
			log.Printf("[Persistence] marshal snapshot: %v", err)
			return
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			log.Printf("[Persistence] write snapshot: %v", err)
		}
	}()
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
func (s *Store) AuditEntries() []*AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]*AuditEntry, len(s.auditLog))
	copy(cp, s.auditLog)
	return cp
}

// Snapshots returns all in-memory snapshots
func (s *Store) Snapshots() []*SnapshotEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]*SnapshotEntry, len(s.snapshots))
	copy(cp, s.snapshots)
	return cp
}
