package checkpoint

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func TestValidateNameAndKind(t *testing.T) {
	valid := []string{"a", "base-ok", "pt1011-0e2bz1", "bug-lost-miner", "0"}
	for _, name := range valid {
		if err := ValidateName(name); err != nil {
			t.Fatalf("%q 应合法：%v", name, err)
		}
	}
	invalid := []string{"", "-lead", "UPPER", "has_underscore", "空格", string(make([]byte, 65))}
	for _, name := range invalid {
		if err := ValidateName(name); err == nil {
			t.Fatalf("%q 应被拒绝", name)
		}
	}
	if KindOf("bug-x") != KindBug || KindOf("base-ok") != KindRegression {
		t.Fatal("kind 推断错误")
	}
}

func TestStoreWriteReadListAndDuplicate(t *testing.T) {
	root := t.TempDir()
	store := Open(root)
	if !store.Enabled() {
		t.Fatal("store 应处于启用状态")
	}
	meta := gamedir.NewMetaFile(&config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "seed-a", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1", Role: "admin"}},
	}, &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 8},
	})
	world := model.NewWorldState("planet-1-1", 16)
	world.Tick = 42
	save := &gamedir.SaveFile{
		FormatVersion: 1,
		Tick:          42,
		Snapshot:      snapshot.Capture(world, nil),
		RuntimeState:  gamedir.RuntimeState{ActivePlanetID: "planet-1-1"},
	}
	manifest := &Manifest{FormatVersion: FormatVersion, Name: "base-ok", Kind: KindRegression, Tick: 42}

	if err := store.Write("base-ok", meta, save, manifest, false); err != nil {
		t.Fatalf("write: %v", err)
	}
	// 同名拒绝；replace 覆盖。
	if err := store.Write("base-ok", meta, save, manifest, false); err == nil {
		t.Fatal("同名应返回 ErrExists")
	}
	if err := store.Write("base-ok", meta, save, manifest, true); err != nil {
		t.Fatalf("replace: %v", err)
	}

	got, gotMeta, gotSave, err := store.Read("base-ok")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got.Name != "base-ok" || got.Tick != 42 || gotMeta.GameplayConfig.Battlefield.MapSeed != "seed-a" || gotSave.Tick != 42 {
		t.Fatalf("roundtrip wrong: %+v %+v %+v", got, gotMeta, gotSave)
	}
	// 读取不得改动只读目录：manifest 的 commit 不会被自愈写回覆盖。
	before, err := os.ReadFile(filepath.Join(root, "base-ok", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.Read("base-ok"); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(root, "base-ok", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("读档改动了只读存档点目录")
	}

	items, err := store.List()
	if err != nil || len(items) != 1 || items[0].Name != "base-ok" {
		t.Fatalf("list: %v %+v", err, items)
	}

	if _, _, _, err := store.Read("missing"); err == nil {
		t.Fatal("缺失存档点应返回错误")
	}
	if err := store.Write("Bad Name", meta, save, manifest, false); err == nil {
		t.Fatal("非法名字应被拒绝")
	}
}

func TestStoreDisabled(t *testing.T) {
	store := Open("  ")
	if store.Enabled() {
		t.Fatal("空目录应为禁用状态")
	}
	if err := store.Write("x", nil, nil, nil, false); err != ErrDisabled {
		t.Fatalf("禁用时应返回 ErrDisabled，实际 %v", err)
	}
	if _, err := store.List(); err != ErrDisabled {
		t.Fatalf("禁用时应返回 ErrDisabled，实际 %v", err)
	}
}

func TestManifestJSONShape(t *testing.T) {
	manifest := Manifest{
		FormatVersion: FormatVersion,
		Name:          "base-ok",
		Kind:          KindRegression,
		Parent:        "step-1",
		Tick:          1234,
		MapSeed:       "seed-a",
		Players:       []Player{{PlayerID: "p1", Role: "admin", Key: "key1"}},
		Commit:        "abcdef0",
		Dirty:         true,
		Note:          "note",
		Contract:      Contract{Checks: []ContractCheck{{Kind: "tick_gte", Tick: 1000}}},
		ContractReport: ContractReport{Passed: true, Results: []ContractResult{
			{Check: ContractCheck{Kind: "tick_gte", Tick: 1000}, Passed: true, Actual: "1234"},
		}},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"name", "kind", "parent", "tick", "map_seed", "players", "commit", "dirty", "created_at", "contract", "contract_report"} {
		if _, ok := back[key]; !ok {
			t.Fatalf("manifest 缺字段 %s: %s", key, raw)
		}
	}
}
