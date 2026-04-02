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
	if err := d.writeMeta(meta); err != nil {
		return err
	}
	if err := d.writeSave(save); err != nil {
		return err
	}
	return nil
}

// WriteSave updates save.json atomically. If meta is provided it is also updated.
func (d *Dir) WriteSave(meta *MetaFile, save *SaveFile) error {
	if meta != nil {
		if err := d.writeMeta(meta); err != nil {
			return err
		}
	}
	if err := d.writeSave(save); err != nil {
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
	save := &SaveFile{}
	if err := d.readJSON(d.SavePath(), save); err != nil {
		return nil, nil, err
	}
	return meta, save, nil
}

func (d *Dir) writeMeta(meta *MetaFile) error {
	if meta == nil {
		return fmt.Errorf("write meta.json: nil meta")
	}
	if meta.FormatVersion == 0 {
		meta.FormatVersion = currentFormatVersion
	}
	now := time.Now().UTC()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.LastSavedAt = now
	if meta.ConfigFingerprint == "" {
		meta.ConfigFingerprint = fingerprint(meta.GameplayConfig)
	}
	if meta.MapFingerprint == "" {
		meta.MapFingerprint = fingerprint(meta.MapConfig)
	}
	if err := d.writeJSONAtomic(d.MetaPath(), meta); err != nil {
		return fmt.Errorf("write meta.json: %w", err)
	}
	return nil
}

func (d *Dir) writeSave(save *SaveFile) error {
	if save == nil {
		return fmt.Errorf("write save.json: nil save")
	}
	if save.FormatVersion == 0 {
		save.FormatVersion = currentFormatVersion
	}
	save.SavedAt = time.Now().UTC()
	if err := d.writeJSONAtomic(d.SavePath(), save); err != nil {
		return fmt.Errorf("write save.json: %w", err)
	}
	return nil
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
	if err := os.MkdirAll(d.root, 0o755); err != nil {
		return fmt.Errorf("create game dir: %w", err)
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal json: %w", err)
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

func fingerprint(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
