package startup

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestT092ConfigDevBootstrapProvidesFreshResearchMatrices(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	sourceConfigPath := filepath.Join(repoRoot, "server", "config-dev.yaml")
	mapCfgPath := filepath.Join(repoRoot, "server", "map.yaml")

	rawConfig, err := os.ReadFile(sourceConfigPath)
	if err != nil {
		t.Fatalf("read config-dev.yaml: %v", err)
	}

	tempRoot := t.TempDir()
	tempDataDir := filepath.Join(tempRoot, "data")
	tempConfigPath := filepath.Join(tempRoot, "config-dev.yaml")
	tempConfig := strings.Replace(string(rawConfig), `data_dir: "data"`, fmt.Sprintf("data_dir: %q", tempDataDir), 1)
	if err := os.WriteFile(tempConfigPath, []byte(tempConfig), 0o644); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	app, err := LoadRuntime(tempConfigPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime from config-dev: %v", err)
	}
	defer app.Stop()

	for _, playerID := range []string{"p1", "p2"} {
		player := app.Core.World().Players[playerID]
		if player == nil {
			t.Fatalf("expected player %s", playerID)
		}
		if player.Resources.Minerals != 200 || player.Resources.Energy != 100 {
			t.Fatalf("unexpected bootstrap resources for %s: %+v", playerID, player.Resources)
		}
		if player.Inventory[model.ItemElectromagneticMatrix] != 50 {
			t.Fatalf("expected %s to start with 50 electromagnetic_matrix, got %+v", playerID, player.Inventory)
		}
	}
}
