package gamedir

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

const currentFormatVersion = 1

// Dir represents a single game save directory.
type Dir struct {
	root string
}

// GameplayConfig stores gameplay-related config persisted in meta.json.
type GameplayConfig struct {
	Battlefield config.BattlefieldConfig `json:"battlefield"`
	Players     []config.PlayerConfig    `json:"players"`
}

// MetaFile is the static metadata stored in meta.json.
type MetaFile struct {
	FormatVersion     int              `json:"format_version"`
	CreatedAt         time.Time        `json:"created_at"`
	LastSavedAt       time.Time        `json:"last_saved_at"`
	ConfigFingerprint string           `json:"config_fingerprint"`
	MapFingerprint    string           `json:"map_fingerprint"`
	SaveFingerprint   string           `json:"save_fingerprint"`
	GameplayConfig    GameplayConfig   `json:"gameplay_config"`
	MapConfig         mapconfig.Config `json:"map_config"`
}

// RuntimeState stores runtime-only state that should survive restart.
type RuntimeState struct {
	ActivePlanetID string `json:"active_planet_id,omitempty"`
	Winner         string `json:"winner,omitempty"`
}

// CommandLogEntry stores a compact command history entry for debugging/replay.
type CommandLogEntry struct {
	Tick        int64                 `json:"tick"`
	PlayerID    string                `json:"player_id"`
	RequestID   string                `json:"request_id,omitempty"`
	IssuerType  string                `json:"issuer_type,omitempty"`
	IssuerID    string                `json:"issuer_id,omitempty"`
	EnqueueTick int64                 `json:"enqueue_tick,omitempty"`
	Commands    []model.Command       `json:"commands,omitempty"`
	Results     []model.CommandResult `json:"results,omitempty"`
}

// DebugState stores optional debug/replay related persisted state.
type DebugState struct {
	BaseSnapshot *snapshot.Snapshot                     `json:"base_snapshot,omitempty"`
	CommandLog   []CommandLogEntry                      `json:"command_log,omitempty"`
	EventHistory map[model.EventType][]*model.GameEvent `json:"event_history,omitempty"`
	AlertHistory []*model.ProductionAlert               `json:"alert_history,omitempty"`
	AuditLog     []*model.AuditEntry                    `json:"audit_log,omitempty"`
}

// SaveFile is the mutable runtime save stored in save.json.
type SaveFile struct {
	FormatVersion int                `json:"format_version"`
	SavedAt       time.Time          `json:"saved_at"`
	Tick          int64              `json:"tick"`
	Snapshot      *snapshot.Snapshot `json:"snapshot"`
	RuntimeState  RuntimeState       `json:"runtime_state"`
	DebugState    DebugState         `json:"debug_state,omitempty"`
}

// Open opens a single-game directory model rooted at path.
func Open(root string) *Dir {
	return &Dir{root: root}
}

// NewMetaFile builds meta file payload from runtime configs.
func NewMetaFile(cfg *config.Config, mapCfg *mapconfig.Config) *MetaFile {
	now := time.Now().UTC()
	meta := &MetaFile{
		FormatVersion: currentFormatVersion,
		CreatedAt:     now,
		LastSavedAt:   now,
	}
	if cfg != nil {
		meta.GameplayConfig.Battlefield = cfg.Battlefield
		meta.GameplayConfig.Players = append([]config.PlayerConfig(nil), cfg.Players...)
	}
	if mapCfg != nil {
		meta.MapConfig = *mapCfg
	}
	meta.ConfigFingerprint = fingerprint(meta.GameplayConfig)
	meta.MapFingerprint = fingerprint(meta.MapConfig)
	return meta
}

func (d *Dir) MetaPath() string {
	return filepath.Join(d.root, "meta.json")
}

func (d *Dir) SavePath() string {
	return filepath.Join(d.root, "save.json")
}

// WriteInitial writes the first full save state.
func (d *Dir) WriteInitial(meta *MetaFile, save *SaveFile) error {
	if meta == nil {
		return fmt.Errorf("write initial: nil meta")
	}
	if err := normalizeMetaForWrite(meta); err != nil {
		return fmt.Errorf("write initial: %w", err)
	}
	if err := normalizeSaveForWrite(save); err != nil {
		return fmt.Errorf("write initial: %w", err)
	}
	now := time.Now().UTC()
	saveFingerprint, err := d.writeSave(save, now)
	if err != nil {
		return err
	}
	if err := d.writeMeta(meta, now, saveFingerprint); err != nil {
		return err
	}
	return nil
}

// WriteSave updates save.json atomically and then meta.json.
func (d *Dir) WriteSave(meta *MetaFile, save *SaveFile) error {
	if meta == nil {
		return fmt.Errorf("write save: nil meta")
	}
	if err := normalizeMetaForWrite(meta); err != nil {
		return fmt.Errorf("write save: %w", err)
	}
	if err := normalizeSaveForWrite(save); err != nil {
		return fmt.Errorf("write save: %w", err)
	}
	now := time.Now().UTC()
	saveFingerprint, err := d.writeSave(save, now)
	if err != nil {
		return err
	}
	if err := d.writeMeta(meta, now, saveFingerprint); err != nil {
		return err
	}
	return nil
}

// Load loads meta.json and save.json.
func (d *Dir) Load() (*MetaFile, *SaveFile, error) {
	meta := &MetaFile{}
	if err := d.readJSON(d.MetaPath(), meta); err != nil {
		return nil, nil, err
	}
	if err := validateMeta(meta); err != nil {
		return nil, nil, err
	}

	saveData, err := os.ReadFile(d.SavePath())
	if err != nil {
		return nil, nil, fmt.Errorf("read save.json: %w", err)
	}
	save := &SaveFile{}
	if err := json.Unmarshal(saveData, save); err != nil {
		return nil, nil, fmt.Errorf("parse save.json: %w", err)
	}
	if err := validateSave(save); err != nil {
		return nil, nil, err
	}
	actualFingerprint := fingerprintBytes(saveData)
	if meta.SaveFingerprint == "" || meta.SaveFingerprint != actualFingerprint {
		return nil, nil, fmt.Errorf("save fingerprint mismatch")
	}
	if !meta.LastSavedAt.Equal(save.SavedAt) {
		return nil, nil, fmt.Errorf("inconsistent save timestamps: meta.last_saved_at=%s save.saved_at=%s", meta.LastSavedAt.Format(time.RFC3339Nano), save.SavedAt.Format(time.RFC3339Nano))
	}
	return meta, save, nil
}

func (d *Dir) writeMeta(meta *MetaFile, savedAt time.Time, saveFingerprint string) error {
	if meta == nil {
		return fmt.Errorf("write meta.json: nil meta")
	}
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = savedAt
	}
	meta.LastSavedAt = savedAt
	if meta.ConfigFingerprint == "" {
		meta.ConfigFingerprint = fingerprint(meta.GameplayConfig)
	}
	if meta.MapFingerprint == "" {
		meta.MapFingerprint = fingerprint(meta.MapConfig)
	}
	meta.SaveFingerprint = saveFingerprint
	if err := d.writeJSONAtomic(d.MetaPath(), meta); err != nil {
		return fmt.Errorf("write meta.json: %w", err)
	}
	return nil
}

func (d *Dir) writeSave(save *SaveFile, savedAt time.Time) (string, error) {
	if save == nil {
		return "", fmt.Errorf("write save.json: nil save")
	}
	save.SavedAt = savedAt
	saveData, err := json.MarshalIndent(save, "", "  ")
	if err != nil {
		return "", fmt.Errorf("write save.json: marshal json: %w", err)
	}
	if err := d.writeJSONBytesAtomic(d.SavePath(), saveData); err != nil {
		return "", fmt.Errorf("write save.json: %w", err)
	}
	return fingerprintBytes(saveData), nil
}

func (d *Dir) readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}
	return nil
}

func (d *Dir) writeJSONAtomic(path string, payload any) error {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal json: %w", err)
	}
	return d.writeJSONBytesAtomic(path, data)
}

func (d *Dir) writeJSONBytesAtomic(path string, data []byte) error {
	if err := os.MkdirAll(d.root, 0o755); err != nil {
		return fmt.Errorf("create game dir: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}

func normalizeMetaForWrite(meta *MetaFile) error {
	if meta == nil {
		return fmt.Errorf("meta is nil")
	}
	if meta.FormatVersion == 0 {
		meta.FormatVersion = currentFormatVersion
	}
	return validateMeta(meta)
}

func normalizeSaveForWrite(save *SaveFile) error {
	if save == nil {
		return fmt.Errorf("save is nil")
	}
	if save.FormatVersion == 0 {
		save.FormatVersion = currentFormatVersion
	}
	return validateSave(save)
}

func validateMeta(meta *MetaFile) error {
	if meta == nil {
		return fmt.Errorf("meta is nil")
	}
	if meta.FormatVersion != currentFormatVersion {
		return fmt.Errorf("meta format_version %d unsupported", meta.FormatVersion)
	}
	return nil
}

func validateSave(save *SaveFile) error {
	if save == nil {
		return fmt.Errorf("save is nil")
	}
	if save.FormatVersion != currentFormatVersion {
		return fmt.Errorf("save format_version %d unsupported", save.FormatVersion)
	}
	if err := validateSnapshotStrict("snapshot", save.Snapshot); err != nil {
		return err
	}
	if save.Tick != save.Snapshot.Tick {
		return fmt.Errorf("save tick mismatch: save=%d snapshot=%d", save.Tick, save.Snapshot.Tick)
	}
	if save.DebugState.BaseSnapshot != nil {
		if err := validateSnapshotStrict("base_snapshot", save.DebugState.BaseSnapshot); err != nil {
			return err
		}
	}
	return nil
}

func validateSnapshotStrict(field string, snap *snapshot.Snapshot) error {
	if snap == nil {
		return fmt.Errorf("%s is nil", field)
	}
	if snap.Version != snapshot.CurrentVersion {
		return fmt.Errorf("%s has invalid version %d", field, snap.Version)
	}
	if snap.World == nil {
		return fmt.Errorf("%s missing world state", field)
	}
	return nil
}

func fingerprint(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func fingerprintBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
