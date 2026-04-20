package gamecore

import (
	"fmt"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func applyScenarioBootstrap(
	cfg *config.Config,
	maps *mapmodel.Universe,
	worlds map[string]*model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
) error {
	if cfg == nil {
		return nil
	}
	if err := applyScenarioPlanetBootstrap(cfg.ScenarioBootstrap.Planets, worlds); err != nil {
		return err
	}
	if err := applyScenarioSystemBootstrap(cfg.ScenarioBootstrap.Systems, maps, spaceRuntime); err != nil {
		return err
	}
	return nil
}

func applyScenarioPlanetBootstrap(
	planets []config.ScenarioBootstrapPlanetConfig,
	worlds map[string]*model.WorldState,
) error {
	if len(planets) == 0 {
		return nil
	}
	bootstrapCore := &GameCore{}
	for _, preset := range planets {
		if preset.PlanetID == "" {
			return fmt.Errorf("scenario planet bootstrap requires planet_id")
		}
		ws := worlds[preset.PlanetID]
		if ws == nil {
			return fmt.Errorf("scenario planet %s runtime not loaded", preset.PlanetID)
		}
		for _, buildingCfg := range preset.Buildings {
			if err := applyScenarioBuildingBootstrap(bootstrapCore, ws, buildingCfg); err != nil {
				return fmt.Errorf("scenario planet %s: %w", preset.PlanetID, err)
			}
		}
	}
	return nil
}

func applyScenarioBuildingBootstrap(
	bootstrapCore *GameCore,
	ws *model.WorldState,
	buildingCfg config.ScenarioBootstrapBuildingConfig,
) error {
	if ws == nil {
		return fmt.Errorf("world runtime missing")
	}
	if buildingCfg.OwnerID == "" {
		return fmt.Errorf("scenario building requires owner_id")
	}
	if ws.Players[buildingCfg.OwnerID] == nil {
		return fmt.Errorf("scenario building owner %s not found", buildingCfg.OwnerID)
	}
	if buildingCfg.BuildingType == "" {
		return fmt.Errorf("scenario building requires building_type")
	}

	buildingType := model.BuildingType(buildingCfg.BuildingType)
	if _, ok := model.BuildingDefinitionByID(buildingType); !ok {
		return fmt.Errorf("unknown scenario building type %s", buildingCfg.BuildingType)
	}

	position := resolveScenarioBuildPosition(ws, model.Position{X: buildingCfg.X, Y: buildingCfg.Y})
	task := &model.ConstructionTask{
		PlayerID:     buildingCfg.OwnerID,
		BuildingType: buildingType,
		Position:     position,
		RecipeID:     buildingCfg.RecipeID,
	}
	events, err := bootstrapCore.completeConstructionTask(ws, task)
	if err != nil {
		return fmt.Errorf("place %s at (%d,%d): %w", buildingCfg.BuildingType, position.X, position.Y, err)
	}

	building := extractScenarioCreatedBuilding(events)
	if building == nil {
		return fmt.Errorf("place %s at (%d,%d): missing created building", buildingCfg.BuildingType, position.X, position.Y)
	}

	if buildingCfg.State != "" {
		if !isScenarioBuildingState(buildingCfg.State) {
			return fmt.Errorf("invalid building state %s", buildingCfg.State)
		}
		building.Runtime.State = model.BuildingWorkState(buildingCfg.State)
		building.Runtime.StateReason = ""
	}
	if building.Runtime.Functions.RayReceiver != nil && buildingCfg.RayReceiverMode != "" {
		mode := model.RayReceiverMode(buildingCfg.RayReceiverMode)
		if !model.IsRayReceiverMode(mode) {
			return fmt.Errorf("invalid ray receiver mode %s", buildingCfg.RayReceiverMode)
		}
		building.Runtime.Functions.RayReceiver.Mode = mode
	}
	for _, item := range buildingCfg.Inventory {
		if item.ItemID == "" || item.Quantity <= 0 {
			continue
		}
		if building.Storage != nil {
			building.Storage.EnsureInventory()[item.ItemID] += item.Quantity
			continue
		}
		if station := ws.LogisticsStations[building.ID]; station != nil {
			if station.Inventory == nil {
				station.Inventory = make(model.ItemInventory)
			}
			station.Inventory[item.ItemID] += item.Quantity
			continue
		}
		return fmt.Errorf("%s does not support inventory bootstrap", buildingCfg.BuildingType)
	}
	return nil
}

func extractScenarioCreatedBuilding(events []*model.GameEvent) *model.Building {
	for _, event := range events {
		if event == nil || event.EventType != model.EvtEntityCreated {
			continue
		}
		payloadBuilding, ok := event.Payload["building"].(*model.Building)
		if ok && payloadBuilding != nil {
			return payloadBuilding
		}
	}
	return nil
}

func isScenarioBuildingState(value string) bool {
	switch model.BuildingWorkState(value) {
	case model.BuildingWorkIdle,
		model.BuildingWorkRunning,
		model.BuildingWorkPaused,
		model.BuildingWorkNoPower,
		model.BuildingWorkError:
		return true
	default:
		return false
	}
}

func resolveScenarioBuildPosition(ws *model.WorldState, desired model.Position) model.Position {
	if ws == nil {
		return desired
	}
	if ws.InBounds(desired.X, desired.Y) {
		tileKey := model.TileKey(desired.X, desired.Y)
		if ws.Grid[desired.Y][desired.X].Terrain.Buildable() {
			if _, occupied := ws.TileBuilding[tileKey]; !occupied {
				return desired
			}
		}
	}
	return findNearestOpenTile(ws, desired)
}

func applyScenarioSystemBootstrap(
	systems []config.ScenarioBootstrapSystemConfig,
	maps *mapmodel.Universe,
	spaceRuntime *model.SpaceRuntimeState,
) error {
	if len(systems) == 0 {
		return nil
	}
	if spaceRuntime == nil {
		return fmt.Errorf("space runtime missing")
	}
	for _, preset := range systems {
		if preset.PlayerID == "" {
			return fmt.Errorf("scenario system bootstrap requires player_id")
		}
		if preset.SystemID == "" {
			return fmt.Errorf("scenario system bootstrap requires system_id")
		}
		if maps != nil {
			if _, ok := maps.System(preset.SystemID); !ok {
				return fmt.Errorf("scenario system %s not found", preset.SystemID)
			}
		}

		spaceRuntime.EnsurePlayerSystem(preset.PlayerID, preset.SystemID)
		for _, layerCfg := range preset.DysonLayers {
			ensureDysonLayer(spaceRuntime, preset.PlayerID, preset.SystemID, layerCfg.LayerIndex, layerCfg.OrbitRadius)
			for _, nodeCfg := range layerCfg.Nodes {
				if _, err := AddDysonNode(spaceRuntime, preset.PlayerID, preset.SystemID, layerCfg.LayerIndex, nodeCfg.Latitude, nodeCfg.Longitude); err != nil {
					return fmt.Errorf("scenario system %s add dyson node: %w", preset.SystemID, err)
				}
			}
			for _, shellCfg := range layerCfg.Shells {
				if _, err := AddDysonShell(spaceRuntime, preset.PlayerID, preset.SystemID, layerCfg.LayerIndex, shellCfg.LatitudeMin, shellCfg.LatitudeMax, shellCfg.Coverage); err != nil {
					return fmt.Errorf("scenario system %s add dyson shell: %w", preset.SystemID, err)
				}
			}
		}
		if preset.SolarSailOrbit != nil {
			for i := 0; i < preset.SolarSailOrbit.Count; i++ {
				LaunchSolarSail(spaceRuntime, preset.PlayerID, preset.SystemID, preset.SolarSailOrbit.OrbitRadius, preset.SolarSailOrbit.Inclination, 0)
			}
		}
		if sphere := GetDysonSphereState(spaceRuntime, preset.PlayerID, preset.SystemID); sphere != nil {
			sphere.CalculateTotalEnergy(dysonStressParams)
		}
	}
	return nil
}
