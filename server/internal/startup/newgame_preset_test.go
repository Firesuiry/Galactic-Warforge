package startup

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/model"
)

// 网页「开新局」必须完整继承启动配置（遭遇战预设）：battlefield 全字段与
// 同名玩家的 bootstrap/bot/executor 都要带过去，只有请求里显式给出的字段才覆盖。
func TestNewGameInheritsStartupPreset(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	mapCfgPath := filepath.Join(repoRoot, "server", "map.yaml")

	preset := `
battlefield:
  map_seed: "preset-seed"
  max_tick_rate: 10
  victory_rule: "elimination"
  enemy_difficulty: "hard"
  construction_region_concurrent_limit: 4
  pace_research: 2
  pace_build: 3
  pace_output: 4
  time_limit_ticks: 54000
  threat_growth_scale: 1.5
  dark_fog_calm_ticks: 1234
  bot_first_attack_tick: 16000
players:
  - player_id: "p1"
    key: "key_player_1"
    team_id: "team-1"
    role: "admin"
    executor:
      build_efficiency: 1.5
      operate_range: 7
      concurrent_tasks: 3
    bootstrap:
      minerals: 1200
      energy: 400
      inventory:
        - { item_id: iron_ingot, quantity: 100 }
        - { item_id: gear, quantity: 40 }
  - player_id: "p2"
    key: "key_player_2"
    team_id: "team-2"
    role: "commander"
    bot: "hard"
    bootstrap:
      minerals: 1200
      energy: 400
server:
  port: 18082
  data_dir: "data-preset-test"
`
	tempRoot := t.TempDir()
	cfgPath := filepath.Join(tempRoot, "config-preset.yaml")
	cfgText := strings.Replace(preset, `data_dir: "data-preset-test"`, fmt.Sprintf("data_dir: %q", filepath.Join(tempRoot, "data")), 1)
	if err := os.WriteFile(cfgPath, []byte(cfgText), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	rt, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer rt.Stop()

	// 网页表单只会提交 player_id/key（bootstrap/bot/role/team 都不带）。
	sess, err := rt.Reset(NewGameRequest{
		MapSeed: "web-seed",
		Players: []NewGamePlayer{
			{PlayerID: "p1", Key: "k1"},
			{PlayerID: "p2", Key: "k2"},
		},
	})
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
	cfg := sess.Config

	if cfg.Battlefield.PaceResearch != 2 || cfg.Battlefield.PaceBuild != 3 || cfg.Battlefield.PaceOutput != 4 {
		t.Fatalf("pace not inherited: %+v", cfg.Battlefield)
	}
	if cfg.Battlefield.TimeLimitTicks != 54000 || cfg.Battlefield.ThreatGrowthScale != 1.5 {
		t.Fatalf("time limit / threat scale not inherited: %+v", cfg.Battlefield)
	}
	if cfg.Battlefield.DarkFogCalmTicks != 1234 || cfg.Battlefield.BotFirstAttackTick != 16000 {
		t.Fatalf("dark fog / bot attack tick not inherited: %+v", cfg.Battlefield)
	}
	if cfg.Battlefield.EnemyDifficulty != "hard" || cfg.Battlefield.VictoryRule != "elimination" {
		t.Fatalf("difficulty / victory rule not inherited: %+v", cfg.Battlefield)
	}
	if cfg.Battlefield.MapSeed != "web-seed" {
		t.Fatalf("map seed must come from the request, got %q", cfg.Battlefield.MapSeed)
	}
	if cfg.Battlefield.MaxTickRate != 10 || cfg.Battlefield.ConstructionRegionConcurrentLimit != 4 {
		t.Fatalf("process knobs not inherited: %+v", cfg.Battlefield)
	}

	if len(cfg.Players) != 2 {
		t.Fatalf("players = %d, want 2", len(cfg.Players))
	}
	p1, p2 := cfg.Players[0], cfg.Players[1]
	if p1.Bootstrap.Minerals != 1200 || p1.Bootstrap.Energy != 400 || len(p1.Bootstrap.Inventory) != 2 {
		t.Fatalf("p1 bootstrap not inherited: %+v", p1.Bootstrap)
	}
	if p1.Role != "admin" || p1.TeamID != "team-1" {
		t.Fatalf("p1 role/team not inherited: %+v", p1)
	}
	if p1.Executor.OperateRange != 7 || p1.Executor.ConcurrentTasks != 3 {
		t.Fatalf("p1 executor not inherited: %+v", p1.Executor)
	}
	if p2.Bot != "hard" || p2.Bootstrap.Minerals != 1200 {
		t.Fatalf("p2 bot/bootstrap not inherited: %+v", p2)
	}

	// 新局世界里的开局物资确实按继承的 bootstrap 发放。
	player := sess.Core.World().Players["p1"]
	if player == nil {
		t.Fatal("p1 missing from new world")
	}
	if player.Resources.Minerals != 1200 {
		t.Fatalf("p1 minerals = %d, want 1200", player.Resources.Minerals)
	}
	if player.Inventory[model.ItemIronIngot] != 100 || player.Inventory[model.ItemGear] != 40 {
		t.Fatalf("p1 inventory not bootstrapped: %+v", player.Inventory)
	}
	botPlayer := sess.Core.World().Players["p2"]
	if botPlayer == nil || botPlayer.Resources.Minerals != 1200 {
		t.Fatalf("p2 bootstrap missing: %+v", botPlayer)
	}
}

// 请求里显式给出的字段覆盖继承值；空字段继续继承。
func TestNewGameRequestOverridesInheritedPreset(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", "..", ".."))
	mapCfgPath := filepath.Join(repoRoot, "server", "map.yaml")

	preset := `
battlefield:
  map_seed: "preset-seed"
  enemy_difficulty: "hard"
  victory_rule: "hybrid"
  pace_research: 2
  time_limit_ticks: 54000
players:
  - player_id: "p1"
    key: "key_player_1"
    role: "admin"
    bot: "hard"
    bootstrap:
      minerals: 1200
      energy: 400
server:
  data_dir: "data-preset-override"
`
	tempRoot := t.TempDir()
	cfgPath := filepath.Join(tempRoot, "config-preset.yaml")
	cfgText := strings.Replace(preset, `data_dir: "data-preset-override"`, fmt.Sprintf("data_dir: %q", filepath.Join(tempRoot, "data")), 1)
	if err := os.WriteFile(cfgPath, []byte(cfgText), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	rt, err := LoadRuntime(cfgPath, mapCfgPath)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	defer rt.Stop()

	sess, err := rt.Reset(NewGameRequest{
		MapSeed:         "override-seed",
		EnemyDifficulty: "off",
		VictoryMode:     model.VictoryRuleSandbox,
		Players: []NewGamePlayer{
			{
				PlayerID: "p1",
				Key:      "k1",
				Role:     "observer",
				Bot:      "easy",
				Bootstrap: &config.PlayerBootstrapConfig{
					Minerals: 7,
					Energy:   1,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
	cfg := sess.Config
	if cfg.Battlefield.EnemyDifficulty != "off" || cfg.Battlefield.VictoryRule != model.VictoryRuleSandbox {
		t.Fatalf("explicit overrides not applied: %+v", cfg.Battlefield)
	}
	if cfg.Battlefield.PaceResearch != 2 || cfg.Battlefield.TimeLimitTicks != 54000 {
		t.Fatalf("unspecified fields must stay inherited: %+v", cfg.Battlefield)
	}
	if cfg.Players[0].Role != "observer" || cfg.Players[0].Bot != "easy" {
		t.Fatalf("explicit player overrides not applied: %+v", cfg.Players[0])
	}
	if cfg.Players[0].Bootstrap.Minerals != 7 || cfg.Players[0].Bootstrap.Energy != 1 {
		t.Fatalf("explicit bootstrap override not applied: %+v", cfg.Players[0].Bootstrap)
	}
	// 覆盖后的 bootstrap 生效：新局只发 7 矿。
	player := sess.Core.World().Players["p1"]
	if player.Resources.Minerals != 7 {
		t.Fatalf("p1 minerals = %d, want 7 (explicit bootstrap)", player.Resources.Minerals)
	}
}
