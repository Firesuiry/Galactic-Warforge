package gateway_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gateway"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/startup"
)

// GET /catalog 必须下发缩放后的科技成本与 research_pace（试玩报告阻断级 #3：
// UI 写 10、结算要 60）。这里断言 HTTP 层确实按本局倍率缩放，且与结算同源。
func TestCatalogEndpointScalesTechCostByPace(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed: "catalog-pace", MaxTickRate: 10, PaceResearch: 3,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1", Role: "admin"},
		},
		Server: config.ServerConfig{Port: 9090, RateLimit: 100},
	}
	if err := config.ApplyDefaults(cfg); err != nil {
		t.Fatalf("apply defaults: %v", err)
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	q := queue.New()
	bus := gamecore.NewEventBus()
	core := gamecore.New(cfg, maps, q, bus, nil)
	srv := gateway.New(startup.NewStaticRuntime(startup.NewSession(cfg, maps, core, bus, q, startup.OriginNew)))

	rec := doGameRequest(t, srv, "GET", "/catalog", "key1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		ResearchPace float64 `json:"research_pace"`
		Techs        []struct {
			ID   string             `json:"id"`
			Cost []model.ItemAmount `json:"cost"`
		} `json:"techs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if body.ResearchPace != 3 {
		t.Fatalf("research_pace = %v, want 3", body.ResearchPace)
	}
	found := false
	for _, tech := range body.Techs {
		if tech.ID != "electromagnetism" {
			continue
		}
		found = true
		if len(tech.Cost) != 1 || tech.Cost[0].Quantity != 30 {
			t.Fatalf("electromagnetism cost = %+v, want 30 (base 10 × pace 3)", tech.Cost)
		}
	}
	if !found {
		t.Fatal("electromagnetism missing from catalog")
	}

	// 与结算同源：该玩家开研究时的 required_cost 必须是同一个数字。
	player := core.World().Players["p1"]
	if player.Tech.ResearchPace != 3 {
		t.Fatalf("player research pace mirror = %v, want 3", player.Tech.ResearchPace)
	}
	cost, ok := model.TechCostForPlayer(player, "electromagnetism")
	if !ok || len(cost) != 1 || cost[0].Quantity != 30 {
		t.Fatalf("TechCostForPlayer = %+v ok=%v, want 30", cost, ok)
	}
}
