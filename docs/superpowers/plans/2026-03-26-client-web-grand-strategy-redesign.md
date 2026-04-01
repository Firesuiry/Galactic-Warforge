# Client-Web Grand Strategy Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不保留整张 `fog/terrain` 全量返回的前提下，实现 `server` 默认 `2000x2000` 行星、`planet summary/scene/inspect` 新读模型，以及统一 `client-web` 为已确认的大战略骨架（`A2 + W2`）。

**Architecture:** 先在服务端并行提供新行星读模型，再把共享 API、fixtures 和前端页面切到镜头驱动的数据流，最后删除旧全量接口并把默认地图尺寸切到 `2000x2000`。前端使用共享战略壳层、复用的情报面板和行星场景查询钩子，保证每个任务结束后系统仍保持可运行。

**Tech Stack:** Go 1.25, net/http, React 18, TypeScript, TanStack Query, Zustand, Vite, Vitest, Playwright

---

本计划保持为单一实现计划，因为 `server` 读模型、`shared-client` 协议、fixtures、`client-web` 布局和文档更新共享同一个接口契约，拆成独立计划会在执行阶段产生跨计划阻塞。

### Task 1: 在 Query 层引入新的 Planet Summary / Scene / Inspector 读模型

**Files:**
- Create: `server/internal/query/planet_scene_test.go`
- Create: `server/internal/query/planet_inspector_test.go`
- Create: `server/internal/query/planet_scene.go`
- Create: `server/internal/query/planet_inspector.go`
- Modify: `server/internal/query/query.go`
- Test: `server/internal/query/query_test.go`
- Test: `server/internal/query/planet_scene_test.go`
- Test: `server/internal/query/planet_inspector_test.go`

- [ ] **Step 1: 先写失败的 Query 层测试，锁住新读模型行为**

```go
package query

func buildSceneHarness(t *testing.T) (*Layer, *model.WorldState, string) {
	t.Helper()
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 32, Height: 32, ResourceDensity: 8},
	}
	maps := mapgen.Generate(cfg, "planet-scene")
	discovery := mapstate.NewDiscovery([]config.PlayerConfig{{PlayerID: "p1"}}, maps)
	planetID := maps.PrimaryPlanetID
	ws := model.NewWorldState(planetID, 32, 32)
	ws.Buildings["miner-1"] = &model.Building{
		ID: "miner-1",
		Type: "mining_machine",
		OwnerID: "p1",
		Position: model.Position{X: 30, Y: 30},
		VisionRange: 6,
	}
	return New(visibility.New(), maps, discovery), ws, planetID
}

func TestPlanetSummaryOmitsFullMapPayload(t *testing.T) {
	cfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{Width: 32, Height: 32, ResourceDensity: 8},
	}
	maps := mapgen.Generate(cfg, "planet-summary")
	discovery := mapstate.NewDiscovery([]config.PlayerConfig{{PlayerID: "p1"}}, maps)
	ql := New(visibility.New(), maps, discovery)
	ws := model.NewWorldState(maps.PrimaryPlanetID, 32, 32)

	view, ok := ql.PlanetSummary(ws, "p1", maps.PrimaryPlanetID)
	if !ok {
		t.Fatal("expected summary view")
	}
	if view.MapWidth != 32 || view.MapHeight != 32 {
		t.Fatalf("expected 32x32, got %dx%d", view.MapWidth, view.MapHeight)
	}
	if view.BuildingCount != 0 || view.ResourceCount == 0 {
		t.Fatalf("unexpected summary counts: %+v", view)
	}
}

func TestPlanetSceneTileWindowClampsAndReturnsEntities(t *testing.T) {
	ql, ws, planetID := buildSceneHarness(t)
	scene, ok := ql.PlanetScene(ws, "p1", planetID, PlanetSceneRequest{
		X: 28, Y: 28, Width: 16, Height: 16, DetailLevel: PlanetSceneDetailTile,
		Layers: []PlanetSceneLayer{PlanetSceneLayerTerrain, PlanetSceneLayerFog, PlanetSceneLayerBuildings},
	})
	if !ok {
		t.Fatal("expected scene view")
	}
	if scene.Bounds.Width != 4 || scene.Bounds.Height != 4 {
		t.Fatalf("expected clamped 4x4 bounds, got %+v", scene.Bounds)
	}
	if len(scene.Buildings) == 0 {
		t.Fatal("expected buildings inside tile scene")
	}
}

func TestPlanetSceneSectorReturnsAggregates(t *testing.T) {
	ql, ws, planetID := buildSceneHarness(t)
	scene, ok := ql.PlanetScene(ws, "p1", planetID, PlanetSceneRequest{
		X: 0, Y: 0, Width: 400, Height: 400, DetailLevel: PlanetSceneDetailSector,
		Layers: []PlanetSceneLayer{PlanetSceneLayerTerrain, PlanetSceneLayerThreat},
	})
	if !ok {
		t.Fatal("expected sector scene")
	}
	if len(scene.Sectors) == 0 {
		t.Fatal("expected aggregated sectors")
	}
}
```

- [ ] **Step 2: 运行 Query 层测试，确认当前代码还不支持新接口**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/query -run 'TestPlanetSummaryOmitsFullMapPayload|TestPlanetSceneTileWindowClampsAndReturnsEntities|TestPlanetSceneSectorReturnsAggregates'
```

Expected: FAIL，报错类似 `ql.PlanetSummary undefined`、`undefined: PlanetSceneRequest`。

- [ ] **Step 3: 在 `query` 包中加入 Summary / Scene 的结构和入口方法**

```go
type PlanetSummaryView struct {
	PlanetID        string                      `json:"planet_id"`
	Name            string                      `json:"name,omitempty"`
	Discovered      bool                        `json:"discovered"`
	Kind            mapmodel.PlanetKind         `json:"kind,omitempty"`
	Orbit           *mapmodel.Orbit             `json:"orbit,omitempty"`
	Moons           []mapmodel.Moon             `json:"moons,omitempty"`
	MapWidth        int                         `json:"map_width"`
	MapHeight       int                         `json:"map_height"`
	Tick            int64                       `json:"tick"`
	Environment     *mapmodel.PlanetEnvironment `json:"environment,omitempty"`
	BuildingCount   int                         `json:"building_count"`
	UnitCount       int                         `json:"unit_count"`
	ResourceCount   int                         `json:"resource_count"`
	ConstructionCount int                       `json:"construction_count"`
	ThreatLevel     int                         `json:"threat_level"`
	AvailableLayers []string                    `json:"available_layers,omitempty"`
}

type PlanetSceneDetailLevel string

type PlanetSceneLayer string

const (
	PlanetSceneDetailTile   PlanetSceneDetailLevel = "tile"
	PlanetSceneDetailSector PlanetSceneDetailLevel = "sector"
	PlanetSceneLayerTerrain PlanetSceneLayer = "terrain"
	PlanetSceneLayerFog     PlanetSceneLayer = "fog"
	PlanetSceneLayerBuildings PlanetSceneLayer = "buildings"
	PlanetSceneLayerThreat  PlanetSceneLayer = "threat"
)

type PlanetSceneRequest struct {
	X           int
	Y           int
	Width       int
	Height      int
	DetailLevel PlanetSceneDetailLevel
	Layers      []PlanetSceneLayer
}

type SceneBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type PlanetSectorView struct {
	SectorID        string  `json:"sector_id"`
	X               int     `json:"x"`
	Y               int     `json:"y"`
	Width           int     `json:"width"`
	Height          int     `json:"height"`
	ExploredRatio   float64 `json:"explored_ratio"`
	BuildingDensity float64 `json:"building_density"`
	ResourceDensity float64 `json:"resource_density"`
	ThreatHeat      float64 `json:"threat_heat"`
}

func (ql *Layer) PlanetSummary(ws *model.WorldState, playerID, planetID string) (*PlanetSummaryView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetSummaryView{PlanetID: planet.ID, Discovered: discovered}
	if !discovered {
		return view, true
	}
	view.Name = planet.Name
	view.Kind = planet.Kind
	view.MapWidth = planet.Width
	view.MapHeight = planet.Height
	view.AvailableLayers = []string{"terrain", "fog", "resources", "buildings", "units", "construction", "power", "pipeline", "threat"}
	if ws != nil {
		view.Tick = ws.Tick
		view.BuildingCount = len(ql.vis.FilterBuildings(ws, playerID))
		view.UnitCount = len(ql.vis.FilterUnits(ws, playerID))
		view.ResourceCount = len(sortedResources(ws))
	}
	return view, true
}
```

- [ ] **Step 4: 实现 tile / sector 场景投影，并把二维整图限制在视窗内**

```go
type PlanetSceneView struct {
	PlanetID     string                 `json:"planet_id"`
	Discovered   bool                   `json:"discovered"`
	Tick         int64                  `json:"tick"`
	DetailLevel  PlanetSceneDetailLevel `json:"detail_level"`
	Bounds       SceneBounds            `json:"bounds"`
	Terrain      [][]terrain.TileType   `json:"terrain,omitempty"`
	VisibleFog   [][]bool               `json:"visible,omitempty"`
	ExploredFog  [][]bool               `json:"explored,omitempty"`
	Buildings    map[string]*model.Building `json:"buildings,omitempty"`
	Units        map[string]*model.Unit     `json:"units,omitempty"`
	Resources    []*model.ResourceNodeState `json:"resources,omitempty"`
	Sectors      []PlanetSectorView         `json:"sectors,omitempty"`
}

func clampSceneBounds(x, y, width, height, maxWidth, maxHeight int, detail PlanetSceneDetailLevel) SceneBounds {
	if detail == PlanetSceneDetailTile && width > 256 {
		width = 256
	}
	if detail == PlanetSceneDetailTile && height > 256 {
		height = 256
	}
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	if x+width > maxWidth {
		width = maxWidth - x
	}
	if y+height > maxHeight {
		height = maxHeight - y
	}
	return SceneBounds{X: x, Y: y, Width: width, Height: height}
}

func buildSectorViews(ws *model.WorldState, planet *mapmodel.Planet, bounds SceneBounds) []PlanetSectorView {
	return []PlanetSectorView{{
		SectorID: "0:0",
		X: bounds.X,
		Y: bounds.Y,
		Width: bounds.Width,
		Height: bounds.Height,
		ExploredRatio: 1,
		BuildingDensity: float64(len(ws.Buildings)) / float64(bounds.Width*bounds.Height),
		ResourceDensity: float64(len(ws.Resources)) / float64(bounds.Width*bounds.Height),
		ThreatHeat: 0,
	}}
}

func sliceTerrain(terrainGrid [][]terrain.TileType, bounds SceneBounds) [][]terrain.TileType {
	out := make([][]terrain.TileType, bounds.Height)
	for y := 0; y < bounds.Height; y++ {
		out[y] = append([]terrain.TileType(nil), terrainGrid[bounds.Y+y][bounds.X:bounds.X+bounds.Width]...)
	}
	return out
}

func sliceFog(vis *visibility.Engine, ws *model.WorldState, playerID, planetID string, bounds SceneBounds) ([][]bool, [][]bool) {
	fog := vis.FogState(ws, playerID)
	visible := make([][]bool, bounds.Height)
	explored := make([][]bool, bounds.Height)
	for y := 0; y < bounds.Height; y++ {
		visible[y] = append([]bool(nil), fog.Visible[bounds.Y+y][bounds.X:bounds.X+bounds.Width]...)
		explored[y] = append([]bool(nil), fog.Explored[bounds.Y+y][bounds.X:bounds.X+bounds.Width]...)
	}
	return visible, explored
}

func filterBuildingsInBounds(buildings map[string]*model.Building, bounds SceneBounds) map[string]*model.Building {
	out := make(map[string]*model.Building)
	for id, building := range buildings {
		if building.Position.X >= bounds.X && building.Position.X < bounds.X+bounds.Width && building.Position.Y >= bounds.Y && building.Position.Y < bounds.Y+bounds.Height {
			out[id] = building
		}
	}
	return out
}

func filterUnitsInBounds(units map[string]*model.Unit, bounds SceneBounds) map[string]*model.Unit {
	out := make(map[string]*model.Unit)
	for id, unit := range units {
		if unit.Position.X >= bounds.X && unit.Position.X < bounds.X+bounds.Width && unit.Position.Y >= bounds.Y && unit.Position.Y < bounds.Y+bounds.Height {
			out[id] = unit
		}
	}
	return out
}

func filterResourcesInBounds(resources []*model.ResourceNodeState, bounds SceneBounds) []*model.ResourceNodeState {
	out := make([]*model.ResourceNodeState, 0, len(resources))
	for _, resource := range resources {
		if resource.Position.X >= bounds.X && resource.Position.X < bounds.X+bounds.Width && resource.Position.Y >= bounds.Y && resource.Position.Y < bounds.Y+bounds.Height {
			out = append(out, resource)
		}
	}
	return out
}

func (ql *Layer) PlanetScene(ws *model.WorldState, playerID, planetID string, req PlanetSceneRequest) (*PlanetSceneView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetSceneView{PlanetID: planetID, Discovered: discovered, DetailLevel: req.DetailLevel}
	if !discovered {
		return view, true
	}
	bounds := clampSceneBounds(req.X, req.Y, req.Width, req.Height, planet.Width, planet.Height, req.DetailLevel)
	view.Bounds = bounds
	if req.DetailLevel == PlanetSceneDetailSector {
		view.Sectors = buildSectorViews(ws, planet, bounds)
		return view, true
	}
	view.Terrain = sliceTerrain(planet.Terrain, bounds)
	view.VisibleFog, view.ExploredFog = sliceFog(ql.vis, ws, playerID, planetID, bounds)
	view.Buildings = filterBuildingsInBounds(ql.vis.FilterBuildings(ws, playerID), bounds)
	view.Units = filterUnitsInBounds(ql.vis.FilterUnits(ws, playerID), bounds)
	view.Resources = filterResourcesInBounds(sortedResources(ws), bounds)
	return view, true
}
```

- [ ] **Step 5: 实现 Inspector 读模型，用于右侧详情栏**

```go
type PlanetInspectRequest struct {
	EntityKind string
	EntityID   string
	SectorID   string
}

type PlanetInspectView struct {
	PlanetID    string                   `json:"planet_id"`
	EntityKind  string                   `json:"entity_kind"`
	EntityID    string                   `json:"entity_id,omitempty"`
	SectorID    string                   `json:"sector_id,omitempty"`
	Title       string                   `json:"title"`
	Position    *model.Position          `json:"position,omitempty"`
	Building    *model.Building          `json:"building,omitempty"`
	Unit        *model.Unit              `json:"unit,omitempty"`
	Resource    *model.ResourceNodeState `json:"resource,omitempty"`
	Sector      *PlanetSectorView        `json:"sector,omitempty"`
}

func (ql *Layer) PlanetInspect(ws *model.WorldState, playerID, planetID string, req PlanetInspectRequest) (*PlanetInspectView, bool) {
	switch req.EntityKind {
	case "building":
		building := ql.vis.FilterBuildings(ws, playerID)[req.EntityID]
		if building == nil {
			return nil, false
		}
		pos := building.Position
		return &PlanetInspectView{
			PlanetID: planetID,
			EntityKind: "building",
			EntityID: building.ID,
			Title: string(building.Type),
			Position: &pos,
			Building: building,
		}, true
	default:
		return nil, false
	}
}
```

- [ ] **Step 6: 运行 Query 层测试，确认新读模型已落地且旧接口尚未删除**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/query
```

Expected: PASS，输出包含 `ok  	siliconworld/internal/query`。

- [ ] **Step 7: 提交 Query 层读模型**

```bash
cd /home/firesuiry/develop/siliconWorld
git add server/internal/query/query.go \
        server/internal/query/planet_scene.go \
        server/internal/query/planet_scene_test.go \
        server/internal/query/planet_inspector.go \
        server/internal/query/planet_inspector_test.go
git commit -m "refactor: add planet summary scene and inspector queries"
```

### Task 2: 暴露新 HTTP 路由、共享类型和 fixture 契约，但暂时保留旧接口

**Files:**
- Modify: `server/internal/gateway/server.go`
- Modify: `server/internal/gateway/server_test.go`
- Modify: `shared-client/src/types.ts`
- Modify: `shared-client/src/api.ts`
- Modify: `client-web/src/shared-api.test.ts`
- Modify: `client-web/src/fixtures/index.ts`
- Modify: `client-web/src/fixtures/scenarios/baseline.ts`
- Create: `client-web/src/fixtures/index.test.ts`

- [ ] **Step 1: 写失败的路由与 shared-client 测试，先锁住新接口协议**

```go
func TestPlanetSceneEndpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/scene?x=0&y=0&width=16&height=16&detail_level=tile&layers=terrain,fog", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["detail_level"] != "tile" {
		t.Fatalf("expected detail_level=tile, got %v", body["detail_level"])
	}
}

func TestPlanetInspectEndpoint(t *testing.T) {
	srv, core := newTestServer(t)
	core.World().Buildings["miner-1"] = &model.Building{
		ID: "miner-1", Type: "mining_machine", OwnerID: "p1",
		Position: model.Position{X: 1, Y: 1},
	}
	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/inspect?entity_kind=building&entity_id=miner-1", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}
```

```ts
it('fetchPlanetScene serializes viewport params', async () => {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/world/planets/planet-1-1/scene');
    expect(url.searchParams.get('detail_level')).toBe('tile');
    expect(url.searchParams.get('layers')).toBe('terrain,fog,buildings');
    return Promise.resolve(jsonResponse({
      planet_id: 'planet-1-1',
      discovered: true,
      tick: 128,
      detail_level: 'tile',
      bounds: { x: 0, y: 0, width: 64, height: 64 },
      terrain: [],
      visible: [],
      explored: [],
      buildings: {},
      units: {},
      resources: [],
    }));
  });

  const client = createApiClient({ serverUrl: 'http://localhost:5173', fetchFn: fetchMock as typeof fetch });
  await client.fetchPlanetScene('planet-1-1', {
    x: 0, y: 0, width: 64, height: 64, detail_level: 'tile', layers: ['terrain', 'fog', 'buildings'],
  });
});
```

- [ ] **Step 2: 运行网关与共享 API 测试，确认当前还没有新路由与新方法**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gateway -run 'TestPlanetSceneEndpoint|TestPlanetInspectEndpoint'

cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/shared-api.test.ts src/fixtures/index.test.ts
```

Expected: FAIL，分别报 `404`、`fetchPlanetScene is not a function` 或 `unknown fixture endpoint`。

- [ ] **Step 3: 在 `server.go` 中挂出新接口，并保留旧 `/fog` 路由到 Task 6 再删**

```go
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /world/planets/{planet_id}", s.auth(s.handlePlanetSummary))
	mux.HandleFunc("GET /world/planets/{planet_id}/scene", s.auth(s.handlePlanetScene))
	mux.HandleFunc("GET /world/planets/{planet_id}/inspect", s.auth(s.handlePlanetInspect))
	mux.HandleFunc("GET /world/planets/{planet_id}/fog", s.auth(s.handleFogMap)) // temporary, remove in Task 6
	mux.HandleFunc("GET /world/planets/{planet_id}/runtime", s.auth(s.handlePlanetRuntime))
	mux.HandleFunc("GET /world/planets/{planet_id}/networks", s.auth(s.handlePlanetNetworks))
	return mux
}

func (s *Server) handlePlanetSummary(w http.ResponseWriter, r *http.Request, playerID string) {
	view, ok := s.ql.PlanetSummary(s.core.World(), playerID, r.PathValue("planet_id"))
	if !ok {
		writeError(w, http.StatusNotFound, "planet not found")
		return
	}
	writeJSON(w, http.StatusOK, view)
}
```

- [ ] **Step 4: 为 shared-client 增加新类型和新方法，先并存旧 `fetchPlanet` / `fetchFogMap`**

```ts
export interface PlanetSummaryView {
  planet_id: string;
  discovered: boolean;
  name?: string;
  kind?: string;
  map_width: number;
  map_height: number;
  tick: number;
  building_count: number;
  unit_count: number;
  resource_count: number;
  construction_count: number;
  threat_level: number;
  available_layers?: string[];
}

export interface PlanetSceneRequest {
  x: number;
  y: number;
  width: number;
  height: number;
  detail_level: 'tile' | 'sector';
  layers?: string[];
}

export interface PlanetSectorView {
  sector_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  explored_ratio: number;
  building_density: number;
  resource_density: number;
  threat_heat: number;
}

export interface PlanetSceneView {
  planet_id: string;
  discovered: boolean;
  tick: number;
  detail_level: 'tile' | 'sector';
  bounds: { x: number; y: number; width: number; height: number };
  terrain?: string[][];
  visible?: boolean[][];
  explored?: boolean[][];
  sectors?: PlanetSectorView[];
  buildings?: Record<string, Building>;
  units?: Record<string, Unit>;
  resources?: PlanetResource[];
}

export interface PlanetInspectRequest {
  entity_kind: 'building' | 'unit' | 'resource' | 'sector';
  entity_id?: string;
  sector_id?: string;
}

function fetchPlanetSummary(planetId: string): Promise<PlanetSummaryView> {
  return apiFetch<PlanetSummaryView>(`/world/planets/${planetId}`);
}

function fetchPlanetScene(planetId: string, params: PlanetSceneRequest): Promise<PlanetSceneView> {
  const search = new URLSearchParams();
  addParams(search, params);
  return apiFetch<PlanetSceneView>(`/world/planets/${planetId}/scene?${search.toString()}`);
}

function fetchPlanetInspect(planetId: string, params: PlanetInspectRequest): Promise<PlanetInspectView> {
  const search = new URLSearchParams();
  addParams(search, params);
  return apiFetch<PlanetInspectView>(`/world/planets/${planetId}/inspect?${search.toString()}`);
}
```

- [ ] **Step 5: 让 fixture server 同时支持新接口，保证可视化和离线样例先跑起来**

```ts
const summaryByPlanet: Record<string, PlanetSummaryView> = {
  'planet-1-1': {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: 8,
    map_height: 6,
    tick: 128,
    building_count: 3,
    unit_count: 2,
    resource_count: 2,
    construction_count: 1,
    threat_level: 3,
    available_layers: ['terrain', 'fog', 'resources', 'buildings', 'units', 'construction', 'power', 'threat'],
  },
};

if (pathname === `/world/planets/${planetId}/scene`) {
  return createJsonResponse(sceneByPlanet[planetId][detailLevelKey]);
}
if (pathname === `/world/planets/${planetId}/inspect`) {
  return createJsonResponse(inspectorByPlanet[planetId][inspectKey]);
}
```

- [ ] **Step 6: 跑通新路由、新 shared-client 和 fixture 测试**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gateway

cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/shared-api.test.ts src/fixtures/index.test.ts
```

Expected: PASS，输出包含 `ok  	siliconworld/internal/gateway` 与 `✓ src/shared-api.test.ts`。

- [ ] **Step 7: 提交新接口契约层**

```bash
cd /home/firesuiry/develop/siliconWorld
git add server/internal/gateway/server.go \
        server/internal/gateway/server_test.go \
        shared-client/src/types.ts \
        shared-client/src/api.ts \
        client-web/src/shared-api.test.ts \
        client-web/src/fixtures/index.ts \
        client-web/src/fixtures/scenarios/baseline.ts \
        client-web/src/fixtures/index.test.ts
git commit -m "refactor: expose planet scene and inspector api contract"
```

### Task 3: 搭建共用大战略壳层和情报面板基础

**Files:**
- Create: `client-web/src/features/intel/IntelPanel.tsx`
- Create: `client-web/src/features/intel/IntelPanel.test.tsx`
- Create: `client-web/src/styles/strategic-shell.css`
- Modify: `client-web/src/main.tsx`
- Modify: `client-web/src/app/layout/AppShell.tsx`
- Modify: `client-web/src/widgets/TopNav.tsx`

- [ ] **Step 1: 先写失败的情报面板测试，约束默认折叠和事件/告警切换**

```ts
describe('IntelPanel', () => {
  it('默认折叠并允许切换到告警标签', async () => {
    const user = userEvent.setup();
    render(
      <IntelPanel
        title="情报"
        events={[{ event_id: 'e1', event_type: 'command_result', tick: 10, payload: {} }]}
        alerts={[{ alert_id: 'a1', alert_type: 'power_low', tick: 11, message: '电力不足' }]}
      />,
    );

    expect(screen.queryByText('电力不足')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开情报' }));
    await user.click(screen.getByRole('tab', { name: '告警' }));
    expect(screen.getByText('电力不足')).toBeVisible();
  });
});
```

- [ ] **Step 2: 运行组件测试，确认项目里还没有这套壳层组件**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/intel/IntelPanel.test.tsx
```

Expected: FAIL，报错类似 `Failed to resolve import "@/features/intel/IntelPanel"`。

- [ ] **Step 3: 实现共用 `IntelPanel`，并把展开/折叠行为定成全站统一模式**

```tsx
export function IntelPanel({ title, events, alerts, defaultTab = 'events' }: IntelPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'events' | 'alerts'>(defaultTab);

  return (
    <section className={open ? 'intel-panel intel-panel--open' : 'intel-panel'}>
      <header className="intel-panel__header">
        <strong>{title}</strong>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起情报' : '展开情报'}
        </button>
      </header>
      {open ? (
        <div className="intel-panel__body">
          <div className="intel-panel__tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')} type="button">时间线</button>
            <button role="tab" aria-selected={tab === 'alerts'} onClick={() => setTab('alerts')} type="button">告警</button>
          </div>
          {tab === 'events' ? (
            <ul className="timeline-list timeline-list--dense">
              {events.map((event) => <li key={event.event_id}>{event.event_type}</li>)}
            </ul>
          ) : (
            <ul className="timeline-list timeline-list--dense">
              {alerts.map((alert) => <li key={alert.alert_id}>{alert.message}</li>)}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: 调整 `AppShell` 和 `TopNav`，让整个站点先拥有一致的战略外壳**

```tsx
export function AppShell() {
  return (
    <div className="strategic-shell">
      <TopNav />
      <main className="strategic-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
```

```tsx
export function TopNav() {
  return (
    <header className="strategy-topbar">
      <div className="strategy-topbar__brand">
        <div className="strategy-topbar__title">SiliconWorld Command</div>
        <div className="strategy-topbar__meta">玩家、服务、tick、活跃行星信息</div>
      </div>
      <nav className="strategy-topbar__links">
        <NavLink to="/overview">总览</NavLink>
        <NavLink to="/galaxy">星图</NavLink>
        <NavLink to="/replay">回放</NavLink>
      </nav>
      <div className="strategy-topbar__status">资源 / 电力 / 研究</div>
    </header>
  );
}
```

- [ ] **Step 5: 在新样式文件中定义大战略主题变量与壳层布局**

```css
:root {
  --sw-bg: #0a0f12;
  --sw-panel: rgba(15, 20, 24, 0.92);
  --sw-panel-strong: rgba(22, 28, 32, 0.96);
  --sw-border: rgba(181, 167, 117, 0.18);
  --sw-gold: #b9a86a;
  --sw-olive: #71876a;
  --sw-ink: #d7ddd2;
}

.strategic-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(113, 135, 106, 0.12), transparent 26%),
    linear-gradient(180deg, #091014 0%, #070b0e 100%);
}

.strategy-topbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--sw-border);
  background: rgba(7, 10, 12, 0.94);
}
```

- [ ] **Step 6: 跑通新壳层测试**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/intel/IntelPanel.test.tsx
```

Expected: PASS，输出包含 `✓ src/features/intel/IntelPanel.test.tsx`。

- [ ] **Step 7: 提交共用壳层**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-web/src/features/intel/IntelPanel.tsx \
        client-web/src/features/intel/IntelPanel.test.tsx \
        client-web/src/styles/strategic-shell.css \
        client-web/src/main.tsx \
        client-web/src/app/layout/AppShell.tsx \
        client-web/src/widgets/TopNav.tsx
git commit -m "feat: add strategic shell and shared intel panel"
```

### Task 4: 将 Planet 页切到 Summary / Scene / Inspect 数据流，并实现 `A2 + W2`

**Files:**
- Create: `client-web/src/features/planet-map/use-planet-scene.ts`
- Modify: `client-web/src/features/planet-map/store.ts`
- Modify: `client-web/src/features/planet-map/model.ts`
- Modify: `client-web/src/features/planet-map/model.test.ts`
- Modify: `client-web/src/features/planet-map/PlanetMapCanvas.tsx`
- Modify: `client-web/src/features/planet-map/PlanetPanels.tsx`
- Modify: `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- Modify: `client-web/src/pages/PlanetPage.tsx`
- Modify: `client-web/src/pages/PlanetPage.test.tsx`

- [ ] **Step 1: 先写 Planet 页失败测试，覆盖新查询顺序和折叠情报面板**

```ts
function createPlanetSummaryPayload() {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: 8,
    map_height: 6,
    tick: 128,
    building_count: 3,
    unit_count: 2,
    resource_count: 2,
    construction_count: 1,
    threat_level: 3,
    available_layers: ['terrain', 'fog', 'resources', 'buildings', 'units', 'construction', 'power', 'threat'],
  };
}

function createPlanetScenePayload() {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    tick: 128,
    detail_level: 'sector',
    bounds: { x: 0, y: 0, width: 8, height: 6 },
    sectors: [{ sector_id: '0:0', x: 0, y: 0, width: 8, height: 6, explored_ratio: 0.75, building_density: 0.18, resource_density: 0.08, threat_heat: 0.22 }],
    buildings: {},
    units: {},
    resources: [],
  };
}

function createPlanetInspectPayload() {
  return {
    planet_id: 'planet-1-1',
    entity_kind: 'sector',
    sector_id: '0:0',
    title: '西北工业区',
    sector: { sector_id: '0:0', x: 0, y: 0, width: 8, height: 6, explored_ratio: 0.75, building_density: 0.18, resource_density: 0.08, threat_heat: 0.22 },
  };
}

function createEventsPayload() {
  return {
    event_types: ['command_result'],
    available_from_tick: 0,
    has_more: false,
    events: [{ event_id: 'e1', event_type: 'command_result', tick: 128, payload: {} }],
  };
}

function createAlertsPayload() {
  return {
    available_from_tick: 0,
    has_more: false,
    alerts: [{ alert_id: 'a1', alert_type: 'power_low', tick: 128, message: '电力不足' }],
  };
}

it('使用 summary + scene + inspect 渲染 A2 行星指挥页', async () => {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/state/summary')) return Promise.resolve(jsonResponse(createSummaryPayload()));
    if (url.endsWith('/state/stats')) return Promise.resolve(jsonResponse(createStatsPayload()));
    if (url.endsWith('/world/planets/planet-1-1')) return Promise.resolve(jsonResponse(createPlanetSummaryPayload()));
    if (url.includes('/world/planets/planet-1-1/scene')) return Promise.resolve(jsonResponse(createPlanetScenePayload()));
    if (url.includes('/world/planets/planet-1-1/inspect')) return Promise.resolve(jsonResponse(createPlanetInspectPayload()));
    if (url.endsWith('/events/snapshot')) return Promise.resolve(jsonResponse(createEventsPayload()));
    if (url.endsWith('/alerts/production/snapshot')) return Promise.resolve(jsonResponse(createAlertsPayload()));
    return Promise.reject(new Error(`unhandled ${url}`));
  });

  renderApp(['/planet/planet-1-1'], { fetchMock });
  expect(await screen.findByRole('heading', { name: 'Gaia' })).toBeVisible();
  expect(await screen.findByText('展开情报')).toBeVisible();
  expect(screen.getByText('地图 8 x 6')).toBeVisible();
});
```

- [ ] **Step 2: 运行 Planet 页测试，确认旧的 `fetchPlanet + fetchFogMap` 逻辑会失败**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/pages/PlanetPage.test.tsx src/features/planet-map/model.test.ts
```

Expected: FAIL，报错类似 `unhandled /world/planets/planet-1-1/fog`、`fetchPlanetScene is not a function`。

- [ ] **Step 3: 扩展地图 store / model，使相机驱动 scene 请求窗口和 detail level**

```ts
interface PlanetSceneWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlanetViewState {
  detailLevel: 'tile' | 'sector';
  sceneWindow: PlanetSceneWindow;
  setDetailLevel: (value: 'tile' | 'sector') => void;
  setSceneWindow: (nextWindow: PlanetSceneWindow) => void;
}

export const usePlanetViewStore = create<PlanetViewState>((set) => ({
  detailLevel: 'sector',
  sceneWindow: { x: 0, y: 0, width: 128, height: 128 },
  setDetailLevel: (detailLevel) => set({ detailLevel }),
  setSceneWindow: (sceneWindow) => set({ sceneWindow }),
}));
```

- [ ] **Step 4: 增加 `use-planet-scene.ts`，让 `PlanetPage` 变成镜头驱动的查询页面**

```ts
interface UsePlanetSceneArgs {
  planetId: string;
  window: { x: number; y: number; width: number; height: number };
  detailLevel: 'tile' | 'sector';
  layers: string[];
}

export function usePlanetScene(args: UsePlanetSceneArgs) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['planet-scene', args.planetId, args.window, args.detailLevel, args.layers],
    queryFn: () => client.fetchPlanetScene(args.planetId, {
      x: args.window.x,
      y: args.window.y,
      width: args.window.width,
      height: args.window.height,
      detail_level: args.detailLevel,
      layers: args.layers,
    }),
    enabled: Boolean(args.planetId),
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 5: 重写 `PlanetPage` 的布局和查询链路，落成 `A2 + W2`**

```tsx
export function PlanetPage() {
  const { detailLevel, sceneWindow, layers, recentAlerts, recentEvents, selected } = usePlanetViewStore((state) => ({
    detailLevel: state.detailLevel,
    sceneWindow: state.sceneWindow,
    layers: state.layers,
    recentAlerts: state.recentAlerts,
    recentEvents: state.recentEvents,
    selected: state.selected,
  }));
  const layerList = useMemo(
    () => Object.entries(layers).filter(([, enabled]) => enabled).map(([key]) => key),
    [layers],
  );
  const summaryQuery = useQuery({
    queryKey: ['planet-summary', session.serverUrl, session.playerId, planetId],
    queryFn: () => client.fetchPlanetSummary(planetId),
    enabled: Boolean(planetId),
  });
  const sceneQuery = usePlanetScene({
    planetId,
    window: sceneWindow,
    detailLevel,
    layers: layerList,
  });
  const inspectQuery = useQuery({
    queryKey: ['planet-inspect', session.serverUrl, session.playerId, planetId, selected?.id],
    queryFn: () => client.fetchPlanetInspect(planetId, { entity_kind: selected!.kind, entity_id: selected!.id }),
    enabled: Boolean(selected),
  });

  return (
    <div className="planet-command-view">
      <aside className="planet-command-view__tools">
        <button className="secondary-button" type="button">模式</button>
        <button className="secondary-button" type="button">图层</button>
        <button className="secondary-button" type="button">命令</button>
        <button className="secondary-button" type="button">情报</button>
      </aside>
      <section className="planet-command-view__map">
        <PlanetMapCanvas scene={sceneQuery.data} summary={summaryQuery.data} />
        <IntelPanel title="情报" events={recentEvents} alerts={recentAlerts} />
      </section>
      <aside className="planet-command-view__dock">
        <PlanetEntityPanel inspect={inspectQuery.data} />
        <PlanetCommandPanel summary={summaryQuery.data} inspect={inspectQuery.data} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 6: 运行 Planet 页和地图模型测试**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/planet-map/model.test.ts src/pages/PlanetPage.test.tsx
```

Expected: PASS，输出包含 `✓ src/pages/PlanetPage.test.tsx`。

- [ ] **Step 7: 提交 Planet 主战区重构**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-web/src/features/planet-map/use-planet-scene.ts \
        client-web/src/features/planet-map/store.ts \
        client-web/src/features/planet-map/model.ts \
        client-web/src/features/planet-map/model.test.ts \
        client-web/src/features/planet-map/PlanetMapCanvas.tsx \
        client-web/src/features/planet-map/PlanetPanels.tsx \
        client-web/src/features/planet-map/PlanetCommandPanel.tsx \
        client-web/src/pages/PlanetPage.tsx \
        client-web/src/pages/PlanetPage.test.tsx
git commit -m "feat: rebuild planet page around scene-driven command view"
```

### Task 5: 重做 Overview / Galaxy / System，使四个主页面共用大战略语言

**Files:**
- Create: `client-web/src/features/strategic-map/GalaxyStrategicMap.tsx`
- Create: `client-web/src/features/strategic-map/SystemOrbitView.tsx`
- Modify: `client-web/src/pages/OverviewPage.tsx`
- Modify: `client-web/src/pages/OverviewPage.test.tsx`
- Modify: `client-web/src/pages/GalaxyPage.tsx`
- Modify: `client-web/src/pages/SystemPage.tsx`
- Modify: `client-web/src/pages/GalaxyNavigation.test.tsx`
- Modify: `client-web/src/styles/index.css`

- [ ] **Step 1: 写失败的页面测试，先锁住新的主视图区结构**

```ts
it('总览页显示战役总控主板与情报入口', async () => {
  renderApp(['/overview']);
  expect(await screen.findByRole('heading', { name: '全局总览' })).toBeVisible();
  expect(screen.getByText('当前最值得处理的局势')).toBeVisible();
  expect(screen.getByRole('button', { name: '展开情报' })).toBeVisible();
});

it('银河页使用战略地图而不是卡片墙', async () => {
  renderApp(['/galaxy']);
  expect(await screen.findByTestId('galaxy-strategic-map')).toBeVisible();
  expect(screen.getByText('Aster')).toBeVisible();
});
```

- [ ] **Step 2: 运行页面测试，确认旧的卡片页结构不能满足新断言**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/pages/OverviewPage.test.tsx src/pages/GalaxyNavigation.test.tsx
```

Expected: FAIL，提示找不到 `当前最值得处理的局势` 或 `galaxy-strategic-map`。

- [ ] **Step 3: 创建银河与星系主视图组件，把中间区域变成真正的主画布**

```tsx
export function GalaxyStrategicMap({ galaxy, selectedSystemId, onSelect }: GalaxyStrategicMapProps) {
  return (
    <div className="strategic-map strategic-map--galaxy" data-testid="galaxy-strategic-map">
      {(galaxy.systems ?? []).map((system) => (
        <button
          key={system.system_id}
          className={system.system_id === selectedSystemId ? 'strategic-node strategic-node--active' : 'strategic-node'}
          style={{ left: `${(system.position?.x ?? 0) / galaxy.width * 100}%`, top: `${(system.position?.y ?? 0) / galaxy.height * 100}%` }}
          onClick={() => onSelect(system.system_id)}
          type="button"
        >
          {system.name || system.system_id}
        </button>
      ))}
    </div>
  );
}
```

```tsx
export function SystemOrbitView({ system, selectedPlanetId, onSelect }: SystemOrbitViewProps) {
  return (
    <div className="strategic-map strategic-map--system">
      <div className="strategic-map__star">{system.name}</div>
      {(system.planets ?? []).map((planet, index) => (
        <button key={planet.planet_id} className="orbit-node" style={{ insetInlineStart: `${20 + index * 14}%` }} onClick={() => onSelect(planet.planet_id)} type="button">
          {planet.name || planet.planet_id}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 重写 `OverviewPage` / `GalaxyPage` / `SystemPage`，让页面围绕主视图组织**

```tsx
export function OverviewPage() {
  return (
    <div className="strategy-page strategy-page--overview">
      <section className="strategy-page__main">
        <header className="strategy-page__hero">
          <h1>全局总览</h1>
          <p>当前最值得处理的局势</p>
        </header>
        <div className="campaign-board">
          <article className="campaign-board__primary">优先处理当前活跃行星的电力与施工瓶颈</article>
          <article className="campaign-board__secondary">研究推进、电网负载、物流吞吐和威胁态势摘要</article>
        </div>
      </section>
      <aside className="strategy-page__dock">
        <IntelPanel title="情报" events={events} alerts={alerts} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: 跑通主页面测试**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/pages/OverviewPage.test.tsx src/pages/GalaxyNavigation.test.tsx
```

Expected: PASS，输出包含 `✓ src/pages/OverviewPage.test.tsx` 与 `✓ src/pages/GalaxyNavigation.test.tsx`。

- [ ] **Step 6: 提交全站主页面重构**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-web/src/features/strategic-map/GalaxyStrategicMap.tsx \
        client-web/src/features/strategic-map/SystemOrbitView.tsx \
        client-web/src/pages/OverviewPage.tsx \
        client-web/src/pages/OverviewPage.test.tsx \
        client-web/src/pages/GalaxyPage.tsx \
        client-web/src/pages/SystemPage.tsx \
        client-web/src/pages/GalaxyNavigation.test.tsx \
        client-web/src/styles/index.css
git commit -m "feat: redesign overview galaxy and system pages"
```

### Task 6: 删除旧整图接口，切换默认地图尺寸到 `2000x2000`，并同步文档

**Files:**
- Create: `server/internal/mapconfig/config_test.go`
- Modify: `server/internal/mapconfig/config.go`
- Modify: `server/map.yaml`
- Modify: `server/internal/query/query.go`
- Modify: `server/internal/gateway/server.go`
- Modify: `server/internal/gateway/server_test.go`
- Modify: `shared-client/src/types.ts`
- Modify: `shared-client/src/api.ts`
- Modify: `client-web/src/fixtures/index.ts`
- Modify: `client-web/src/fixtures/scenarios/baseline.ts`
- Modify: `docs/服务端API.md`
- Modify: `docs/client-web使用说明.md`

- [ ] **Step 1: 写失败测试，锁住两个最终约束：默认 `2000x2000`，旧 `/fog` 接口不再保留**

```go
func TestApplyDefaultsUses2000x2000Planet(t *testing.T) {
	cfg := &Config{}
	ApplyDefaults(cfg)
	if cfg.Planet.Width != 2000 || cfg.Planet.Height != 2000 {
		t.Fatalf("expected 2000x2000 defaults, got %dx%d", cfg.Planet.Width, cfg.Planet.Height)
	}
}

func TestFogEndpointRemoved(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest("GET", "/world/planets/planet-1-1/fog", nil)
	req.Header.Set("Authorization", "Bearer key1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after fog endpoint removal, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: 运行最终约束测试，确认在清理前仍然失败**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/mapconfig ./internal/gateway -run 'TestApplyDefaultsUses2000x2000Planet|TestFogEndpointRemoved'
```

Expected: FAIL，提示 `got 32x32` 或 `/fog` 仍返回 `200`。

- [ ] **Step 3: 删除旧整图接口与旧 shared-client API，同时切换默认地图尺寸**

```go
// server/internal/mapconfig/config.go
if cfg.Planet.Width == 0 {
	cfg.Planet.Width = 2000
}
if cfg.Planet.Height == 0 {
	cfg.Planet.Height = 2000
}
```

```yaml
# server/map.yaml
planet:
  width: 2000
  height: 2000
```

```go
// server/internal/gateway/server.go
mux.HandleFunc("GET /world/planets/{planet_id}", s.auth(s.handlePlanetSummary))
mux.HandleFunc("GET /world/planets/{planet_id}/scene", s.auth(s.handlePlanetScene))
mux.HandleFunc("GET /world/planets/{planet_id}/inspect", s.auth(s.handlePlanetInspect))
// remove GET /world/planets/{planet_id}/fog
```

```ts
// shared-client/src/api.ts
return {
  fetchPlanetSummary,
  fetchPlanetScene,
  fetchPlanetInspect,
  // remove fetchPlanet and fetchFogMap from the public api
};
```

- [ ] **Step 4: 同步 API 文档和 Web 使用文档，明确新的行星数据流**

```md
### GET /world/planets/{planet_id}
- 返回行星摘要，不再返回整张 terrain / fog / buildings / units / resources。

### GET /world/planets/{planet_id}/scene
- 按视窗返回 tile 或 sector 级场景数据。
- 请求参数：`x`、`y`、`width`、`height`、`detail_level`、`layers`

### GET /world/planets/{planet_id}/inspect
- 返回右侧详情栏所需的结构化 inspector 数据。
```

```md
1. 行星页首次进入先拉 summary。
2. 地图平移和缩放只会重拉当前视窗 scene。
3. 实体详情通过 inspect 单独获取。
4. 旧版 `/fog` 接口已删除，不再提供整张迷雾快照。
```

- [ ] **Step 5: 运行服务端与前端回归，确认删除旧接口后系统仍可编译和通过测试**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/mapconfig ./internal/query ./internal/gateway

cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/shared-api.test.ts src/features/intel/IntelPanel.test.tsx src/pages/PlanetPage.test.tsx src/pages/OverviewPage.test.tsx src/pages/GalaxyNavigation.test.tsx
```

Expected: PASS，所有相关测试通过，且前端不再引用 `fetchFogMap`。

- [ ] **Step 6: 提交最终契约切换**

```bash
cd /home/firesuiry/develop/siliconWorld
git add server/internal/mapconfig/config_test.go \
        server/internal/mapconfig/config.go \
        server/map.yaml \
        server/internal/query/query.go \
        server/internal/gateway/server.go \
        server/internal/gateway/server_test.go \
        shared-client/src/types.ts \
        shared-client/src/api.ts \
        client-web/src/fixtures/index.ts \
        client-web/src/fixtures/scenarios/baseline.ts \
        docs/服务端API.md \
        docs/client-web使用说明.md
git commit -m "refactor: finalize scene-driven planet api and large map defaults"
```

### Task 7: 刷新视觉基线并完成浏览器验收

**Files:**
- Modify: `client-web/tests/visual.spec.ts`
- Modify: `client-web/tests/visual.spec.ts-snapshots/overview-dashboard-linux.png`
- Modify: `client-web/tests/visual.spec.ts-snapshots/planet-map-shell-linux.png`
- Create: `client-web/tests/visual.spec.ts-snapshots/galaxy-strategic-map-linux.png`

- [ ] **Step 1: 更新视觉测试用例，让它们覆盖新的大战略骨架**

```ts
test('银河战略图截图基线', async ({ page }) => {
  await openFixtureMode(page);
  await page.goto('/galaxy');
  await expect(page.locator('[data-testid="galaxy-strategic-map"]')).toHaveScreenshot('galaxy-strategic-map.png', {
    animations: 'disabled',
  });
});

test('行星主战区截图基线', async ({ page }) => {
  await openFixtureMode(page);
  await page.goto('/planet/planet-1-1');
  await expect(page.locator('.planet-command-view')).toHaveScreenshot('planet-map-shell.png', {
    animations: 'disabled',
  });
});
```

- [ ] **Step 2: 刷新 Playwright 快照**

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run test:visual:update
```

Expected: PASS，并更新 `tests/visual.spec.ts-snapshots/*.png`。

- [ ] **Step 3: 跑完整自动化回归**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./cmd/server ./internal/config ./internal/gamecore ./internal/gateway ./internal/mapconfig ./internal/mapgen ./internal/mapmodel ./internal/mapstate ./internal/model ./internal/persistence ./internal/query ./internal/queue ./internal/terrain ./internal/visibility

cd /home/firesuiry/develop/siliconWorld/client-web
npm test
npm run test:visual
```

Expected: 所有 `go test`、`vitest`、`playwright` 全部通过。

- [ ] **Step 4: 用真实浏览器做桌面端验收**

```bash
cd /home/firesuiry/develop/siliconWorld/server
PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go run ./cmd/server --config config.yaml --map-config map.yaml

cd /home/firesuiry/develop/siliconWorld/client-web
VITE_SW_PROXY_TARGET=http://localhost:18080 npm run dev
```

Expected:
- 服务端启动日志包含 `planet 2000x2000`
- 浏览器中的 `overview / galaxy / system / planet` 四页都以主视图区为核心
- 行星页默认只在需要时展开情报
- 地图平移和缩放会触发 `/scene` 请求，而不是整图 `/fog`

- [ ] **Step 5: 提交视觉基线和验收收尾**

```bash
cd /home/firesuiry/develop/siliconWorld
git add client-web/tests/visual.spec.ts \
        client-web/tests/visual.spec.ts-snapshots/overview-dashboard-linux.png \
        client-web/tests/visual.spec.ts-snapshots/planet-map-shell-linux.png \
        client-web/tests/visual.spec.ts-snapshots/galaxy-strategic-map-linux.png
git commit -m "test: refresh strategic client visual baselines"
```
