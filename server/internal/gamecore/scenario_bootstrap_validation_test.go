package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"siliconworld/internal/surface"
)

// 极区地图夹具（N=48，图集 144×96）上的场景预置越界坐标：战争场景的 p2 建筑
// 钉在 (126,132)，以前会一路传进 surface.Grid.Step 触发
// `panic: invalid cube-sphere step`，服务端直接崩溃。现在加载期报错。
func TestValidateScenarioBootstrapRejectsOutOfBoundsCoordinates(t *testing.T) {
	maps := scenarioValidationMaps(t)
	cfg := &config.Config{
		ScenarioBootstrap: config.ScenarioBootstrapConfig{Planets: []config.ScenarioBootstrapPlanetConfig{{
			PlanetID: "planet-1-1",
			Buildings: []config.ScenarioBootstrapBuildingConfig{
				{OwnerID: "p1", BuildingType: "wind_turbine", X: 12, Y: 15},
				{OwnerID: "p2", BuildingType: "tesla_tower", X: 126, Y: 132},
			},
		}}},
	}

	err := ValidateScenarioBootstrap(cfg, maps)
	if err == nil {
		t.Fatal("expected out-of-bounds scenario building to be rejected")
	}
	for _, want := range []string{"scenario_bootstrap.planets[0].buildings[1]", "tesla_tower at 126,132", "planet-1-1", "144x96"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q must name %q", err, want)
		}
	}
}

// 合法坐标（含贴边）不受影响；未生成的行星交给落位阶段的「runtime not loaded」。
func TestValidateScenarioBootstrapAcceptsInBoundsCoordinates(t *testing.T) {
	maps := scenarioValidationMaps(t)
	cfg := &config.Config{
		ScenarioBootstrap: config.ScenarioBootstrapConfig{Planets: []config.ScenarioBootstrapPlanetConfig{
			{
				PlanetID: "planet-1-1",
				Buildings: []config.ScenarioBootstrapBuildingConfig{
					{OwnerID: "p1", BuildingType: "wind_turbine", X: 0, Y: 0},
					{OwnerID: "p1", BuildingType: "wind_turbine", X: 143, Y: 95},
					{OwnerID: "p2", BuildingType: "tesla_tower", X: 72, Y: 48},
				},
			},
			{PlanetID: "planet-9-9", Buildings: []config.ScenarioBootstrapBuildingConfig{
				{OwnerID: "p1", BuildingType: "wind_turbine", X: 9999, Y: 9999},
			}},
		}},
	}

	if err := ValidateScenarioBootstrap(cfg, maps); err != nil {
		t.Fatalf("in-bounds scenario bootstrap must pass, got %v", err)
	}
}

// 端到端：极区地图 + 战争场景预置 → 开新局返回错误而不是 panic。
func TestNewCoreRejectsScenarioBootstrapOutsidePolarGrid(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "poles-seed", MaxTickRate: 10, EnemyDifficulty: "off"},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}, {PlayerID: "p2", Key: "key2"}},
		ScenarioBootstrap: config.ScenarioBootstrapConfig{Planets: []config.ScenarioBootstrapPlanetConfig{{
			PlanetID: "planet-1-1",
			Buildings: []config.ScenarioBootstrapBuildingConfig{
				{OwnerID: "p2", BuildingType: "tesla_tower", X: 126, Y: 132},
			},
		}}},
	}
	if err := config.ApplyDefaults(cfg); err != nil {
		t.Fatalf("apply defaults: %v", err)
	}
	maps := scenarioValidationMaps(t)

	registry, err := bootstrapInitialRuntimeRegistry(cfg, maps)
	if err == nil {
		t.Fatalf("expected registry bootstrap to reject out-of-bounds scenario building, got %+v", registry.ActivePlanetID)
	}
	if !strings.Contains(err.Error(), "buildings[0]") {
		t.Fatalf("error must carry the config field path, got %v", err)
	}
}

// 极区夹具：单行星、face_size 48（图集 144×96）。
func scenarioValidationMaps(t *testing.T) *mapmodel.Universe {
	t.Helper()
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1, GasGiantRatio: 0},
		Planet: mapconfig.PlanetConfig{FaceSize: 48, ResourceDensity: 10},
	}
	mapconfig.ApplyDefaults(mapCfg)
	maps := mapgen.Generate(mapCfg, "poles-seed")
	if maps == nil || maps.PrimaryPlanet() == nil {
		t.Fatal("polar map fixture must generate a planet")
	}
	if maps.PrimaryPlanet().FaceSize != 48 {
		t.Fatalf("polar map fixture face size = %d, want 48", maps.PrimaryPlanet().FaceSize)
	}
	return maps
}

// 编译期护栏：Step 仍然按球面邻接工作，越界格不会静默夹紧。
func TestSurfaceStepStillPanicsOnInvalidTile(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("surface.Grid.Step must keep panicking on an invalid tile (programming error)")
		}
	}()
	grid := model.NewWorldState("planet-1-1", 48).Surface()
	grid.Step(surface.Tile{X: 144, Y: 132}, surface.North)
}
