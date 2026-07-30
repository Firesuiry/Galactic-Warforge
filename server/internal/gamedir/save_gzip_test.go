package gamedir

import (
	"encoding/json"
	"os"
	"testing"

	"siliconworld/internal/terrain"
)

func TestWriteSaveStoresGzipPayload(t *testing.T) {
	dir := Open(t.TempDir())
	if err := dir.WriteInitial(minimalMeta(), minimalSave(5)); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	raw, err := os.ReadFile(dir.SavePath())
	if err != nil {
		t.Fatalf("read save.json: %v", err)
	}
	if len(raw) < 2 || raw[0] != 0x1f || raw[1] != 0x8b {
		t.Fatalf("expected gzip magic bytes in save.json, got %x", raw[:min(8, len(raw))])
	}
	payload, err := maybeGunzip(raw)
	if err != nil {
		t.Fatalf("gunzip save.json: %v", err)
	}
	var decoded SaveFile
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("parse decompressed save: %v", err)
	}
	if decoded.Tick != 5 {
		t.Fatalf("expected tick 5 in decompressed save, got %d", decoded.Tick)
	}

	if _, save, err := dir.Load(); err != nil {
		t.Fatalf("load gzip save: %v", err)
	} else if save.Tick != 5 {
		t.Fatalf("expected tick 5 from load, got %d", save.Tick)
	}
}

func TestLoadReadsLegacyPlainJSONSave(t *testing.T) {
	dir := Open(t.TempDir())
	if err := dir.WriteInitial(minimalMeta(), minimalSave(6)); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	// Simulate a legacy uncompressed save written by an older server version.
	legacy := minimalSave(7)
	legacy.SavedAt = legacy.SavedAt.UTC()
	payload, err := json.Marshal(legacy)
	if err != nil {
		t.Fatalf("marshal legacy save: %v", err)
	}
	if err := os.WriteFile(dir.SavePath(), payload, 0o644); err != nil {
		t.Fatalf("write legacy save: %v", err)
	}

	meta, save, err := dir.Load()
	if err != nil {
		t.Fatalf("load legacy plain save: %v", err)
	}
	if save.Tick != 7 {
		t.Fatalf("expected tick 7 from legacy save, got %d", save.Tick)
	}
	if meta.SaveFingerprint != fingerprintBytes(payload) {
		t.Fatalf("expected meta fingerprint healed to legacy payload")
	}
}

func TestGzipSaveShrinksTerrainHeavyPayload(t *testing.T) {
	const size = 512
	grid := make([][]terrain.TileType, size)
	for y := 0; y < size; y++ {
		row := make([]terrain.TileType, size)
		for x := 0; x < size; x++ {
			switch (x + y) % 10 {
			case 0:
				row[x] = terrain.TileWater
			case 5:
				row[x] = terrain.TileBlocked
			default:
				row[x] = terrain.TileBuildable
			}
		}
		grid[y] = row
	}

	save := minimalSave(9)
	save.Snapshot.World.MapWidth = size
	save.Snapshot.World.MapHeight = size
	save.Snapshot.World.Terrain = grid

	dir := Open(t.TempDir())
	if err := dir.WriteInitial(minimalMeta(), save); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	compressed, err := os.ReadFile(dir.SavePath())
	if err != nil {
		t.Fatalf("read save.json: %v", err)
	}
	plain, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal plain save: %v", err)
	}
	if int64(len(compressed)) >= int64(len(plain))/4 {
		t.Fatalf("expected gzip save at least 4x smaller: compressed=%d plain=%d", len(compressed), len(plain))
	}

	_, loaded, err := dir.Load()
	if err != nil {
		t.Fatalf("load terrain-heavy save: %v", err)
	}
	if len(loaded.Snapshot.World.Terrain) != size || len(loaded.Snapshot.World.Terrain[0]) != size {
		t.Fatalf("expected terrain restored to %dx%d", size, size)
	}
	if loaded.Snapshot.World.Terrain[0][0] != terrain.TileWater {
		t.Fatalf("expected terrain content preserved, got %s", loaded.Snapshot.World.Terrain[0][0])
	}
}
