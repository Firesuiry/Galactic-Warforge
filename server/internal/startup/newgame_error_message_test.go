package startup

import (
	"strings"
	"testing"

	"siliconworld/internal/config"
)

// 新局请求的校验失败回执必须是中文（试玩报告 #12：字段名 enemy_difficulty /
// building_id 这类裸字段名裸露给玩家）。
func TestNewGameValidationMessagesAreChinese(t *testing.T) {
	rt, err := NewRuntime(config.ServerConfig{Port: 9090, RateLimit: 100, DataDir: t.TempDir()}, nil)
	if err != nil {
		t.Fatalf("new runtime: %v", err)
	}
	rt.current.Store(nil)

	cases := []struct {
		name string
		req  NewGameRequest
	}{
		{"bad difficulty", NewGameRequest{EnemyDifficulty: "lunatic", Players: []NewGamePlayer{{PlayerID: "p1", Key: "k"}}}},
		{"bad victory mode", NewGameRequest{VictoryMode: "lunatic", Players: []NewGamePlayer{{PlayerID: "p1", Key: "k"}}}},
		{"empty players", NewGameRequest{}},
		{"missing player id", NewGameRequest{Players: []NewGamePlayer{{Key: "k"}}}},
		{"duplicate player id", NewGameRequest{Players: []NewGamePlayer{{PlayerID: "p1", Key: "k1"}, {PlayerID: "p1", Key: "k2"}}}},
		{"missing key", NewGameRequest{Players: []NewGamePlayer{{PlayerID: "p1"}}}},
		{"bad role", NewGameRequest{Players: []NewGamePlayer{{PlayerID: "p1", Key: "k", Role: "superuser"}}}},
		{"bad bot", NewGameRequest{Players: []NewGamePlayer{{PlayerID: "p1", Key: "k", Bot: "impossible"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := rt.buildConfig(&tc.req)
			if err == nil {
				t.Fatal("expected validation failure")
			}
			msg := err.Error()
			if !containsChineseRunes(msg) {
				t.Fatalf("validation message must be Chinese, got %q", msg)
			}
			for _, bare := range []string{"enemy_difficulty", "victory_mode", "player_id", "players["} {
				if strings.Contains(msg, bare) {
					t.Fatalf("validation message leaks the raw field name %q: %q", bare, msg)
				}
			}
		})
	}
}

func containsChineseRunes(s string) bool {
	for _, r := range s {
		if r >= 0x4e00 && r <= 0x9fff {
			return true
		}
	}
	return false
}
