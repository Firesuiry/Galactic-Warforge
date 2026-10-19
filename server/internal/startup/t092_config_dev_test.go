package startup

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestT092ConfigDevBootstrapRequiresChainProducedMatrices(t *testing.T) {
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
	tempConfig := strings.Replace(string(rawConfig), `data_dir: "data-dev"`, fmt.Sprintf("data_dir: %q", tempDataDir), 1)
	if err := os.WriteFile(tempConfigPath, []byte(tempConfig), 0o644); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	app, err := LoadRuntime(tempConfigPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime from config-dev: %v", err)
	}
	defer app.Stop()

	for _, playerID := range []string{"p1", "p2"} {
		player := app.Current().Core.World().Players[playerID]
		if player == nil {
			t.Fatalf("expected player %s", playerID)
		}
		// 第 16 轮：开局物资是实物；第 21 轮起背包挂在开局机甲档案上。
		mecha := player.MechaByOperator(playerID)
		if mecha == nil {
			t.Fatalf("expected starter mecha for %s", playerID)
		}
		if mecha.Inventory[model.ItemIronIngot] != 96 || mecha.Inventory[model.ItemGear] != 32 {
			t.Fatalf("unexpected bootstrap inventory for %s: %+v", playerID, mecha.Inventory)
		}
		if player.Resources.Energy != 0 {
			t.Fatalf("unexpected bootstrap energy for %s: %+v", playerID, player.Resources)
		}
		if mecha.Inventory[model.ItemElectromagneticMatrix] != 0 {
			t.Fatalf("expected %s to start without bootstrapped matrices (industry chain required), got %+v", playerID, mecha.Inventory)
		}
	}
}
