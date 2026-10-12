package gamedir

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"siliconworld/internal/model"
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
	// 细分网格后地形不再逐格写盘（快照只存非 buildable 格的行内游程），
	// 「大 payload 压缩」改用一个仍然逐格写盘、规模可比的状态字段验证：
	// 512×512 的资源差异表（每个节点一条 remaining/current_yield）。
	const size = 512
	deltas := make(map[string]model.ResourceNodeDelta, size*size)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			id := fmt.Sprintf("planet-1-1-res-%d", y*size+x)
			deltas[id] = model.ResourceNodeDelta{Remaining: 1000 + x, CurrentYield: 3 + y%7}
		}
	}

	save := minimalSave(9)
	save.Snapshot.World.MapWidth = size
	save.Snapshot.World.MapHeight = size
	save.Snapshot.World.ResourceDeltas = deltas

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
		t.Fatalf("load resource-heavy save: %v", err)
	}
	if len(loaded.Snapshot.World.ResourceDeltas) != size*size {
		t.Fatalf("expected %d resource deltas restored, got %d", size*size, len(loaded.Snapshot.World.ResourceDeltas))
	}
	first := loaded.Snapshot.World.ResourceDeltas["planet-1-1-res-0"]
	if first.Remaining != 1000 || first.CurrentYield != 3 {
		t.Fatalf("expected resource delta content preserved, got %+v", first)
	}
}
