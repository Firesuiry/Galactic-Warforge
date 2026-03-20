package snapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
)

const CurrentVersion = 1

// Snapshot captures a tick-level world snapshot with versioned payload.
type Snapshot struct {
	Version   int                         `json:"version"`
	Tick      int64                       `json:"tick"`
	Timestamp time.Time                   `json:"timestamp"`
	World     *WorldSnapshot              `json:"world"`
	Discovery *mapstate.DiscoverySnapshot `json:"discovery,omitempty"`
}

// Capture builds a full snapshot from runtime state.
func Capture(world *model.WorldState, discovery *mapstate.Discovery) *Snapshot {
	worldSnap := CaptureWorld(world)
	tick := int64(0)
	if worldSnap != nil {
		tick = worldSnap.Tick
	}
	snap := &Snapshot{
		Version:   CurrentVersion,
		Tick:      tick,
		Timestamp: time.Now().UTC(),
		World:     worldSnap,
	}
	if discovery != nil {
		snap.Discovery = discovery.Snapshot()
	}
	return snap
}

// Encode serializes a snapshot to JSON.
func Encode(snap *Snapshot) ([]byte, error) {
	if snap == nil {
		return nil, errors.New("snapshot is nil")
	}
	if snap.Version == 0 {
		snap.Version = CurrentVersion
	}
	if snap.Version != CurrentVersion {
		return nil, fmt.Errorf("unsupported snapshot version %d", snap.Version)
	}
	if snap.Timestamp.IsZero() {
		snap.Timestamp = time.Now().UTC()
	}
	if snap.World == nil {
		return nil, errors.New("snapshot missing world state")
	}
	return json.MarshalIndent(snap, "", "  ")
}

// Decode parses snapshot JSON and validates the version.
func Decode(data []byte) (*Snapshot, error) {
	if len(data) == 0 {
		return nil, errors.New("snapshot payload is empty")
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, err
	}
	if snap.Version == 0 {
		return nil, errors.New("snapshot version required")
	}
	if snap.Version != CurrentVersion {
		return nil, fmt.Errorf("unsupported snapshot version %d", snap.Version)
	}
	return &snap, nil
}

// RestoreWorld rebuilds a WorldState from the snapshot payload.
func (snap *Snapshot) RestoreWorld() (*model.WorldState, error) {
	if snap == nil {
		return nil, errors.New("snapshot is nil")
	}
	if snap.World == nil {
		return nil, errors.New("snapshot missing world state")
	}
	return snap.World.Restore()
}

// RestoreDiscovery rebuilds discovery state from the snapshot payload.
func (snap *Snapshot) RestoreDiscovery() (*mapstate.Discovery, error) {
	if snap == nil {
		return nil, errors.New("snapshot is nil")
	}
	if snap.Discovery == nil {
		return nil, nil
	}
	return snap.Discovery.Restore(), nil
}
