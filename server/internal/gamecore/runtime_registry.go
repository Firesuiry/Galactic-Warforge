package gamecore

import (
	"sort"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
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
			PlayerID:   p.PlayerID,
			TeamID:     p.TeamID,
			Role:       p.Role,
			Resources:  model.Resources{Minerals: 200, Energy: 100},
			IsAlive:    true,
			Tech:       model.NewPlayerTechState(p.PlayerID),
			CombatTech: &model.PlayerCombatTechState{PlayerID: p.PlayerID, UnlockedTechs: make(map[string]*model.CombatTech)},
			Stats:      model.NewPlayerStats(p.PlayerID),
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
	ws := model.NewWorldState(planet.ID, planet.Width, planet.Height)
	ws.Players = players
	applyPlanetTerrain(ws, planet)
	applyPlanetResources(ws, planet)
	return ws
}

func seedPlayerOutposts(ws *model.WorldState, players []config.PlayerConfig) {
	if ws == nil || len(players) == 0 {
		return
	}
	basePositions := computeStartPositions(&config.Config{Players: players}, ws.MapWidth, ws.MapHeight)
	for i := range basePositions {
		basePositions[i] = findNearestBuildable(ws, basePositions[i])
	}
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
		}
		ws.Units[execID] = executor
		execKey := model.TileKey(execPos.X, execPos.Y)
		ws.TileUnits[execKey] = append(ws.TileUnits[execKey], execID)
		ps.SetPlanetExecutor(ws.PlanetID, model.NewExecutorState(execID, p.Executor.BuildEfficiency, p.Executor.OperateRange, p.Executor.ConcurrentTasks, p.Executor.ResearchBoost))
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
		seedPlayerOutposts(ws, cfg.Players)
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
