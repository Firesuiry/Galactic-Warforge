package startup

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/data"
	"siliconworld/internal/model"
)

func copyEmbeddedGameData(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	entries, err := fs.ReadDir(data.FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		raw, err := fs.ReadFile(data.FS, e.Name())
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, e.Name()), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestInstallGameDataDir(t *testing.T) {
	embedded, err := model.LoadGameData(data.FS)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { model.InstallGameData(embedded) })

	if err := installGameDataDir(""); err != nil {
		t.Fatalf("empty game_data_dir should keep embedded data: %v", err)
	}

	dir := copyEmbeddedGameData(t)
	unitsPath := filepath.Join(dir, model.GameDataUnitsFile)
	raw, _ := os.ReadFile(unitsPath)
	if err := os.WriteFile(unitsPath, []byte(strings.Replace(string(raw), "attack: 15", "attack: 99", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := installGameDataDir(dir); err != nil {
		t.Fatal(err)
	}
	if got := model.UnitStats(model.UnitTypeSoldier).Attack; got != 99 {
		t.Fatalf("soldier attack = %d, want 99 from game_data_dir", got)
	}

	broken := copyEmbeddedGameData(t)
	recipesPath := filepath.Join(broken, model.GameDataRecipesFile)
	raw, _ = os.ReadFile(recipesPath)
	if err := os.WriteFile(recipesPath, []byte(strings.Replace(string(raw), "item_id: iron_ore", "item_id: ghost_ore", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	err = installGameDataDir(broken)
	if err == nil || !strings.Contains(err.Error(), `unknown item "ghost_ore"`) {
		t.Fatalf("broken game_data_dir should fail startup with a clear error, got %v", err)
	}
}
