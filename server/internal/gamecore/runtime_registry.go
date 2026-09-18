package gamecore

import (
	"sort"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

type PlanetRuntimeRegistry struct {
	ActivePlanetID string
	Worlds         map[string]*model.WorldState
	SpaceRuntime   *model.SpaceRuntimeState
}

func buildSharedPlayers(cfg *config.Config) map[string]*model.PlayerState {
	players := make(map[string]*model.PlayerState, len(cfg.Players))
	for _, p := range cfg.Players {
		ps := &model.PlayerState{
			PlayerID:  p.PlayerID,
			TeamID:    p.TeamID,
			Role:      p.Role,
			Resources: model.Resources{Minerals: 200, Energy: 100},
			IsAlive:   true,
			Tech:      model.NewPlayerTechState(p.PlayerID),
			Stats:     model.NewPlayerStats(p.PlayerID),
		}
		ps.SetPermissions(p.Permissions)
		applyPlayerBootstrap(ps, p.Bootstrap)
		players[p.PlayerID] = ps
	}
	return players
}

func newPlanetWorld(maps *mapmodel.Universe, planetID string, players map[string]*model.PlayerState) *model.WorldState {
	planet, ok := maps.Planet(planetID)
	if !ok || planet == nil {
		return nil
	}
	ws := model.NewWorldState(planet.ID, planet.FaceSize)
	ws.Players = players
	applyPlanetTerrain(ws, planet)
	applyPlanetResources(ws, planet)
	return ws
}

func seedPlayerOutposts(ws *model.WorldState, planet *mapmodel.Planet, players []config.PlayerConfig) {
	if ws == nil || len(players) == 0 {
		return
	}
	basePositions := spawnPositionsFor(ws, planet, players)
	for i := range basePositions {
		flattenSpawnArea(ws, planet, basePositions[i], spawnAreaRadius)
		basePositions[i] = findNearestBuildable(ws, basePositions[i])
	}
	// Guarantee iron/copper within mining reach of every final base so the
	// matrix production chain is not blocked by distant mapgen veins.
	ensureStarterResourceNodes(ws, planet, basePositions, spawnMineDistance(players))
	for i, p := range players {
		ps := ws.Players[p.PlayerID]
		if ps == nil {
			continue
		}

		pos := basePositions[i%len(basePositions)]
		profile := model.BuildingProfileFor(model.BuildingTypeBattlefieldAnalysisBase, 1)
		id := ws.NextEntityID("b")
		base := &model.Building{
			ID:          id,
			Type:        model.BuildingTypeBattlefieldAnalysisBase,
			OwnerID:     p.PlayerID,
			Position:    pos,
			HP:          profile.MaxHP,
			MaxHP:       profile.MaxHP,
			Level:       1,
			VisionRange: profile.VisionRange,
			Runtime:     profile.Runtime,
		}
		model.InitBuildingStorage(base)
		model.InitBuildingProduction(base)
		model.InitBuildingConveyor(base)
		model.InitBuildingSorter(base)
		model.InitBuildingLogisticsStation(base)
		model.RegisterLogisticsStation(ws, base)
		model.RegisterPowerGridBuilding(ws, base)
		ws.Buildings[id] = base
		tileKey := model.TileKey(pos.X, pos.Y)
		ws.TileBuilding[tileKey] = id
		ws.Grid[pos.Y][pos.X].BuildingID = id

		execPos := findNearestOpenTile(ws, pos)
		execStats := model.UnitStats(model.UnitTypeExecutor)
		execID := ws.NextEntityID("u")
		executor := &model.Unit{
			ID:          execID,
			Type:        model.UnitTypeExecutor,
			OwnerID:     p.PlayerID,
			Position:    execPos,
			HP:          execStats.HP,
			MaxHP:       execStats.MaxHP,
			Attack:      execStats.Attack,
			Defense:     execStats.Defense,
			AttackRange: execStats.AttackRange,
			MoveRange:   execStats.MoveRange,
			VisionRange: execStats.VisionRange,
			Mecha:       execStats.Mecha,
		}
		ws.Units[execID] = executor
		execKey := model.TileKey(execPos.X, execPos.Y)
		ws.TileUnits[execKey] = append(ws.TileUnits[execKey], execID)
		ps.SetPlanetExecutor(ws.PlanetID, model.NewExecutorState(execID, p.Executor.BuildEfficiency, p.Executor.OperateRange, p.Executor.ConcurrentTasks, p.Executor.ResearchBoost))
	}
}

// spawnAreaRadius is the radius around each spawn point flattened to
// buildable terrain so a fresh base always has room to expand.
const spawnAreaRadius = 8

// spawnResourceSearchRadius caps how far an auto spawn may wander when
// looking for a tile with minable resources nearby.
const spawnResourceSearchRadius = 32

// starterResourceKinds are injected near every spawn when missing so the
// opening matrix chain (iron → magnet/coil, copper → circuit) and the mecha
// coal fuel loop stay reachable inside the executor operate range without
// relying on mapgen luck. Coal is guaranteed here (not left to the natural
// palette) so mapgen palette changes cannot shift the deterministic cluster
// sequence and strand the nearest coal vein beyond the mecha move range.
var starterResourceKinds = []mapmodel.ResourceKind{
	mapmodel.ResourceIronOre,
	mapmodel.ResourceCopperOre,
	mapmodel.ResourceCoal,
}

// starterVeinTotal is intentionally above map.yaml natural vein_amount_max
// (200): yield 8 would burn a 200-unit patch in ~25 ticks (~2.5s at 10 tps),
// which is too short for the pre-belt opening loop (build grid → mine → fund
// smelters). Yield stays snappy at 8; total covers a full opening session
// (实测：矿机全程连续开采约 4 小时才会采空 20000，覆盖试玩/录像整场)
const (
	starterVeinTotal = 20000
	starterVeinYield = 8
)

// spawnPositionsFor returns explicit planet spawn points when the map config
// pins them, otherwise spread-out auto positions kept away from map edges and
// nudged next to minable resource nodes so the first mining loop works.
func spawnPositionsFor(ws *model.WorldState, planet *mapmodel.Planet, players []config.PlayerConfig) []model.Position {
	if planet != nil && len(planet.SpawnPoints) > 0 {
		positions := make([]model.Position, 0, len(planet.SpawnPoints))
		for _, p := range planet.SpawnPoints {
			if ws.InBounds(p.X, p.Y) {
				positions = append(positions, model.Position{X: p.X, Y: p.Y})
			}
		}
		if len(positions) > 0 {
			return positions
		}
	}
	positions := computeStartPositions(&config.Config{Players: players}, ws.Surface())
	mineDist := spawnMineDistance(players)
	for i := range positions {
		positions[i] = relocateSpawnNearResources(ws, positions[i], mineDist)
	}
	return positions
}

// spawnMineDistance is the max surface graph distance allowed between a spawn and
// the nearest resource node, leaving room for the executor's adjacent tile.
func spawnMineDistance(players []config.PlayerConfig) int {
	operateRange := 0
	for _, p := range players {
		if p.Executor.OperateRange <= 0 {
			continue
		}
		if operateRange == 0 || p.Executor.OperateRange < operateRange {
			operateRange = p.Executor.OperateRange
		}
	}
	if operateRange <= 0 {
		operateRange = 6
	}
	dist := operateRange - 2
	if dist < 1 {
		dist = 1
	}
	return dist
}

// relocateSpawnNearResources nudges an auto spawn to the closest tile that
// has a resource node within dist. The spawn area
// is flattened afterwards, so the node's own terrain does not matter here.
func relocateSpawnNearResources(ws *model.WorldState, start model.Position, dist int) model.Position {
	if ws == nil {
		return start
	}
	for _, tile := range (surface.Grid{Size: ws.MapWidth / 3}).Disc(surface.Tile{X: start.X, Y: start.Y}, spawnResourceSearchRadius) {
		pos := model.Position{X: tile.X, Y: tile.Y}
		if hasResourceNodeWithin(ws, pos, dist) && spawnHasOpenNeighbors(ws, pos) {
			return pos
		}
	}
	return start
}

// Keep early wind/lab placement possible without moving or deleting natural ore.
func spawnHasOpenNeighbors(ws *model.WorldState, pos model.Position) bool {
	free := 0
	for _, neighbor := range ws.SurfaceNeighbors(pos) {
		if ws.Grid[neighbor.Y][neighbor.X].ResourceNodeID == "" {
			free++
		}
	}
	return free >= 2
}

// hasResourceNodeWithin reports whether a resource node sits within surface graph
// dist of center.
func hasResourceNodeWithin(ws *model.WorldState, center model.Position, dist int) bool {
	for _, tile := range (surface.Grid{Size: ws.MapWidth / 3}).Disc(surface.Tile{X: center.X, Y: center.Y}, dist) {
		if ws.Grid[tile.Y][tile.X].ResourceNodeID != "" {
			return true
		}
	}
	return false
}

// ensureStarterResourceNodes places missing starter ore kinds within dist of
// each spawn center so iron/copper for the matrix chain and coal for mecha
// refueling are always operable.
func ensureStarterResourceNodes(ws *model.WorldState, planet *mapmodel.Planet, centers []model.Position, dist int) {
	if ws == nil || len(centers) == 0 || dist < 1 {
		return
	}
	if ws.Resources == nil {
		ws.Resources = make(map[string]*model.ResourceNodeState)
	}
	seen := make(map[model.Position]struct{}, len(centers))
	for _, center := range centers {
		if _, ok := seen[center]; ok {
			continue
		}
		seen[center] = struct{}{}
		for _, kind := range starterResourceKinds {
			if hasResourceKindWithin(ws, center, dist, string(kind)) {
				continue
			}
			pos, ok := findOpenTileForResource(ws, center, dist)
			if !ok {
				continue
			}
			injectResourceNode(ws, planet, pos, kind)
		}
	}
}

// hasResourceKindWithin reports whether a node of the given kind sits within
// surface graph dist of center.
func hasResourceKindWithin(ws *model.WorldState, center model.Position, dist int, kind string) bool {
	if ws == nil || kind == "" {
		return false
	}
	for _, tile := range (surface.Grid{Size: ws.MapWidth / 3}).Disc(surface.Tile{X: center.X, Y: center.Y}, dist) {
		node := ws.Resources[ws.Grid[tile.Y][tile.X].ResourceNodeID]
		if node != nil && node.Kind == kind {
			return true
		}
	}
	return false
}

// findOpenTileForResource picks an empty, non-resource tile inside dist of
// center, preferring ring distance 2..dist so the base tile itself stays free.
func findOpenTileForResource(ws *model.WorldState, center model.Position, dist int) (model.Position, bool) {
	if ws == nil {
		return model.Position{}, false
	}
	grid := surface.Grid{Size: ws.MapWidth / 3}
	origin := surface.Tile{X: center.X, Y: center.Y}
	tiles := grid.Disc(origin, dist)
	for _, minimum := range []int{2, 1} {
		for _, tile := range tiles {
			if grid.Distance(origin, tile) < minimum || ws.Grid[tile.Y][tile.X].ResourceNodeID != "" {
				continue
			}
			if _, occupied := ws.TileBuilding[model.TileKey(tile.X, tile.Y)]; occupied {
				continue
			}
			return model.Position{X: tile.X, Y: tile.Y}, true
		}
	}
	return model.Position{}, false
}

func manhattanAbs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// injectResourceNode writes a finite ore node into the runtime world and, when
// present, the map-model planet so scene/query layers stay consistent.
func injectResourceNode(ws *model.WorldState, planet *mapmodel.Planet, pos model.Position, kind mapmodel.ResourceKind) {
	if ws == nil || !ws.InBounds(pos.X, pos.Y) {
		return
	}
	if ws.Grid[pos.Y][pos.X].ResourceNodeID != "" {
		return
	}
	id := ws.NextEntityID("res")
	state := &model.ResourceNodeState{
		ID:           id,
		PlanetID:     ws.PlanetID,
		Kind:         string(kind),
		Behavior:     string(mapmodel.ResourceFinite),
		Position:     pos,
		MaxAmount:    starterVeinTotal,
		Remaining:    starterVeinTotal,
		BaseYield:    starterVeinYield,
		CurrentYield: starterVeinYield,
	}
	state.SyncDepleted()
	ws.Resources[id] = state
	ws.Grid[pos.Y][pos.X].ResourceNodeID = id
	ws.Grid[pos.Y][pos.X].Terrain = terrain.TileBuildable
	if planet != nil {
		if pos.Y < len(planet.Terrain) && pos.X < len(planet.Terrain[pos.Y]) {
			planet.Terrain[pos.Y][pos.X] = terrain.TileBuildable
		}
		planet.Resources = append(planet.Resources, mapmodel.ResourceNode{
			ID:        id,
			PlanetID:  planet.ID,
			Kind:      kind,
			Behavior:  mapmodel.ResourceFinite,
			Position:  mapmodel.GridPos{X: pos.X, Y: pos.Y},
			Total:     starterVeinTotal,
			BaseYield: starterVeinYield,
		})
	}
}

// flattenSpawnArea converts non-buildable terrain within radius of center to
// buildable ground. Resource nodes are untouched: they live on a separate
// layer and remain harvestable inside the flattened area. The flattened
// terrain is written to both the runtime world grid and the map model planet,
// keeping the two terrain copies consistent for scene rendering.
func flattenSpawnArea(ws *model.WorldState, planet *mapmodel.Planet, center model.Position, radius int) {
	if ws == nil || radius <= 0 {
		return
	}
	for _, tile := range (surface.Grid{Size: ws.MapWidth / 3}).Disc(surface.Tile{X: center.X, Y: center.Y}, radius) {
		x, y := tile.X, tile.Y
		ws.Grid[y][x].Terrain = terrain.TileBuildable
		if planet != nil && y < len(planet.Terrain) && x < len(planet.Terrain[y]) {
			planet.Terrain[y][x] = terrain.TileBuildable
		}
	}
}

func bootstrapInitialRuntimeRegistry(cfg *config.Config, maps *mapmodel.Universe) (PlanetRuntimeRegistry, error) {
	activePlanet := maps.PrimaryPlanet()
	if cfg.Battlefield.InitialActivePlanetID != "" {
		if candidate, ok := maps.Planet(cfg.Battlefield.InitialActivePlanetID); ok && candidate != nil {
			activePlanet = candidate
		}
	}
	players := buildSharedPlayers(cfg)
	spaceRuntime := model.NewSpaceRuntimeState()

	worlds := make(map[string]*model.WorldState)
	planetIDs := []string{}
	if primary := maps.PrimaryPlanet(); primary != nil {
		planetIDs = append(planetIDs, primary.ID)
	}
	if activePlanet != nil && (len(planetIDs) == 0 || planetIDs[0] != activePlanet.ID) {
		planetIDs = append(planetIDs, activePlanet.ID)
	}
	for _, preset := range cfg.ScenarioBootstrap.Planets {
		if preset.PlanetID == "" {
			continue
		}
		planetIDs = append(planetIDs, preset.PlanetID)
	}
	for _, planetID := range planetIDs {
		if _, exists := worlds[planetID]; exists {
			continue
		}
		ws := newPlanetWorld(maps, planetID, players)
		if ws == nil {
			continue
		}
		planet, _ := maps.Planet(planetID)
		seedPlayerOutposts(ws, planet, cfg.Players)
		worlds[planetID] = ws
	}
	if err := applyScenarioBootstrap(cfg, maps, worlds, spaceRuntime); err != nil {
		return PlanetRuntimeRegistry{}, err
	}
	seedWarIndustryAnchors(worlds)

	activePlanetID := ""
	if activePlanet != nil {
		activePlanetID = activePlanet.ID
	}
	for _, ps := range players {
		ps.SyncLegacyExecutor(activePlanetID)
	}

	return PlanetRuntimeRegistry{
		ActivePlanetID: activePlanetID,
		Worlds:         worlds,
		SpaceRuntime:   spaceRuntime,
	}, nil
}

func seedWarIndustryAnchors(worlds map[string]*model.WorldState) {
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, building := range ws.Buildings {
			if building == nil || building.OwnerID == "" || building.Runtime.Functions.Deployment == nil {
				continue
			}
			player := ws.Players[building.OwnerID]
			if player == nil {
				continue
			}
			industry := player.EnsureWarIndustry()
			ensureWarDeploymentHubState(industry, building.ID, deploymentHubCapacity(building.Runtime.Functions.Deployment))
		}
	}
}

func (gc *GameCore) sortedPlanetIDs() []string {
	if gc == nil || len(gc.worlds) == 0 {
		return nil
	}
	gc.runtimeMu.RLock()
	defer gc.runtimeMu.RUnlock()
	ids := make([]string, 0, len(gc.worlds))
	for planetID := range gc.worlds {
		ids = append(ids, planetID)
	}
	sort.Strings(ids)
	return ids
}

func (gc *GameCore) sortedWorlds() []*model.WorldState {
	ids := gc.sortedPlanetIDs()
	worlds := make([]*model.WorldState, 0, len(ids))
	gc.runtimeMu.RLock()
	defer gc.runtimeMu.RUnlock()
	for _, planetID := range ids {
		if ws := gc.worlds[planetID]; ws != nil {
			worlds = append(worlds, ws)
		}
	}
	return worlds
}

func (gc *GameCore) WorldForPlanet(planetID string) *model.WorldState {
	if gc == nil || planetID == "" {
		return nil
	}
	gc.runtimeMu.RLock()
	defer gc.runtimeMu.RUnlock()
	return gc.worlds[planetID]
}

func (gc *GameCore) Worlds() map[string]*model.WorldState {
	if gc == nil {
		return nil
	}
	return gc.worldMapSnapshot()
}

func (gc *GameCore) worldMapSnapshot() map[string]*model.WorldState {
	gc.runtimeMu.RLock()
	defer gc.runtimeMu.RUnlock()
	out := make(map[string]*model.WorldState, len(gc.worlds))
	for planetID, ws := range gc.worlds {
		out[planetID] = ws
	}
	return out
}

func (gc *GameCore) withLockedWorlds(fn func()) {
	worlds := gc.sortedWorlds()
	for _, ws := range worlds {
		ws.Lock()
	}
	defer func() {
		for i := len(worlds) - 1; i >= 0; i-- {
			worlds[i].Unlock()
		}
	}()
	fn()
}

func (gc *GameCore) setActivePlanet(planetID string) bool {
	if gc == nil {
		return false
	}
	ws := gc.worlds[planetID]
	if ws == nil {
		return false
	}
	gc.setCurrentWorld(planetID, ws)
	for _, player := range ws.Players {
		player.SyncLegacyExecutor(planetID)
	}
	return true
}

func playerHasFootholdOnWorld(ws *model.WorldState, playerID string) bool {
	if ws == nil || playerID == "" {
		return false
	}
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != playerID {
			continue
		}
		if building.Type == model.BuildingTypeBattlefieldAnalysisBase {
			return true
		}
	}
	for _, unit := range ws.Units {
		if unit != nil && unit.OwnerID == playerID && unit.Type == model.UnitTypeExecutor {
			return true
		}
	}
	return false
}
