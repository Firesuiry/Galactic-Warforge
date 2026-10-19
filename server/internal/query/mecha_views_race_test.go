package query

import (
	"sync"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/queue"
	"siliconworld/internal/visibility"

	"siliconworld/internal/gamecore"
)

// 审查 S4：summary / agent-briefing 会读其它行星的 Units / Construction.Tasks，
// 必须与 tick 结算（持有全部世界写锁）安全并发。多行星下一边轮询一边推进 tick，
// 在 -race 下不得报数据竞争。
func TestMechaViewsConcurrentWithTickSettlement(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:               "mecha-views-race",
			MaxTickRate:           10,
			InitialActivePlanetID: "planet-1-2",
			EnemyDifficulty:       "off",
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 2, GasGiantRatio: 0},
		Planet: mapconfig.PlanetConfig{FaceSize: 24, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core := gamecore.New(cfg, maps, queue.New(), gamecore.NewEventBus(), nil)
	worlds := core.Worlds()
	if len(worlds) < 2 {
		t.Fatalf("expected at least two loaded planets, got %d", len(worlds))
	}
	ql := New(visibility.New(), maps, mapstate.NewDiscovery(cfg.Players, maps))

	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				core.AdvanceTick()
			}
		}
	}()
	var pollers sync.WaitGroup
	for i := 0; i < 4; i++ {
		pollers.Add(1)
		go func() {
			defer pollers.Done()
			for j := 0; j < 60; j++ {
				ws := core.World()
				sum := ql.Summary(ws, "p1", core.Victory(), core.Worlds())
				if sum == nil {
					t.Error("nil summary")
					return
				}
				briefing := ql.AgentBriefing(ws, "p1", core.Victory(), core.Worlds(), core.SpaceRuntime(), nil, 5)
				if briefing == nil {
					t.Error("nil briefing")
					return
				}
			}
		}()
	}
	pollers.Wait()
	close(stop)
	wg.Wait()
}
