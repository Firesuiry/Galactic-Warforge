package gamecore

import (
	"fmt"
	"reflect"

	"siliconworld/internal/model"
)

// commandRoute 声明命令在哪一层结算、以及哪些 target 字段是行星路由用的实体引用。
type commandRoute uint8

const (
	// routeSpace 太空层/玩家级命令：target.planet_id 是作战参数而非路由提示。
	routeSpace commandRoute = iota
	// routePlanet 行星层命令；实体引用只来自载荷（building_id / task_id / member_ids）。
	routePlanet
	// routeUnitSelection 行星层命令，target.entity_id + target.entity_ids 是施令单位。
	routeUnitSelection
	// routeTargetUnit 行星层命令，target.entity_id 是单位（机甲）。
	routeTargetUnit
	// routeTargetBuilding 行星层命令，target.entity_id 是建筑。
	routeTargetBuilding
)

// entityRefs 是命令引用的、可用于行星路由的实体。
type entityRefs struct {
	buildings, units, tasks []string
}

func (r entityRefs) empty() bool {
	return len(r.buildings)+len(r.units)+len(r.tasks) == 0
}

// payloadRefs 由引用实体的载荷实现（building_id / task_id / member_ids），供行星路由。
type payloadRefs interface {
	entityRefs() entityRefs
}

// buildingRef 是载荷里的 building_id：既是执行参数，也是行星路由的实体引用。
type buildingRef struct {
	BuildingID string `json:"building_id" payload:"required"`
}

func (r buildingRef) entityRefs() entityRefs {
	return entityRefs{buildings: []string{r.BuildingID}}
}

// commandHandler 是命令注册表的一项：结算层级/路由 + 载荷解码 + 执行器。
// 命令的类型、目录元数据与结构校验登记在 model 的命令目录里，这里只绑定执行。
type commandHandler struct {
	route   commandRoute
	payload reflect.Type
	bind    func(cmd model.Command) (boundCommand, error)
}

// boundCommand 是载荷已解码的命令：带路由引用与执行闭包。
type boundCommand struct {
	refs entityRefs
	exec func(gc *GameCore, ws *model.WorldState, playerID string) (model.CommandResult, []*model.GameEvent)
}

func handle[P any](route commandRoute, exec func(*GameCore, *model.WorldState, string, model.Command, P) (model.CommandResult, []*model.GameEvent)) commandHandler {
	return commandHandler{route: route, payload: reflect.TypeFor[P](), bind: func(cmd model.Command) (boundCommand, error) {
		payload, err := decodePayload[P](cmd.Payload)
		if err != nil {
			return boundCommand{}, err
		}
		var refs entityRefs
		if r, ok := any(payload).(payloadRefs); ok {
			refs = r.entityRefs()
		}
		return boundCommand{
			refs: route.refs(cmd, refs),
			exec: func(gc *GameCore, ws *model.WorldState, playerID string) (model.CommandResult, []*model.GameEvent) {
				return exec(gc, ws, playerID, cmd, payload)
			},
		}, nil
	}}
}

// commandHandlers 每条公开命令只登记一次；与 model 命令目录一一对应（见 command_registry_test.go）。
var commandHandlers = map[model.CommandType]commandHandler{
	model.CmdSetRallyPoint:             handle(routeTargetBuilding, (*GameCore).execSetRallyPoint),
	model.CmdConfigureSorter:           handle(routeTargetBuilding, (*GameCore).execConfigureSorter),
	model.CmdConfigureTrafficMonitor:   handle(routeTargetBuilding, (*GameCore).execConfigureTrafficMonitor),
	model.CmdConfigureSplitter:         handle(routeTargetBuilding, (*GameCore).execConfigureSplitter),
	model.CmdBuild:                     handle(routePlanet, (*GameCore).execBuild),
	model.CmdMove:                      handle(routeUnitSelection, (*GameCore).execMove),
	model.CmdAttack:                    handle(routeUnitSelection, (*GameCore).execAttack),
	model.CmdUnitOrder:                 handle(routeUnitSelection, (*GameCore).execUnitOrder),
	model.CmdRefuelMecha:               handle(routeTargetUnit, (*GameCore).execRefuelMecha),
	model.CmdMineResource:              handle(routeTargetUnit, (*GameCore).execMineResource),
	model.CmdCraftItem:                 handle(routeTargetUnit, (*GameCore).execCraftItem),
	model.CmdCancelMechaJob:            handle(routeTargetUnit, (*GameCore).execCancelMechaJob),
	model.CmdProduce:                   handle(routeTargetBuilding, (*GameCore).execProduce),
	model.CmdUpgrade:                   handle(routeTargetBuilding, (*GameCore).execUpgrade),
	model.CmdDemolish:                  handle(routeTargetBuilding, (*GameCore).execDemolish),
	model.CmdConfigureDistributor:      handle(routeTargetBuilding, (*GameCore).execConfigureDistributor),
	model.CmdInstallLogisticsBot:       handle(routeTargetBuilding, (*GameCore).execInstallLogisticsBot),
	model.CmdUninstallLogisticsBot:     handle(routeTargetBuilding, (*GameCore).execUninstallLogisticsBot),
	model.CmdConfigureMechaLogistics:   handle(routeTargetUnit, (*GameCore).execConfigureMechaLogistics),
	model.CmdInstallLogisticsVehicle:   handle(routeTargetBuilding, (*GameCore).execInstallLogisticsVehicle),
	model.CmdConfigureLogisticsStation: handle(routeTargetBuilding, (*GameCore).execConfigureLogisticsStation),
	model.CmdConfigureLogisticsSlot:    handle(routeTargetBuilding, (*GameCore).execConfigureLogisticsSlot),
	model.CmdScanGalaxy:                handle(routeSpace, (*GameCore).execScanGalaxy),
	model.CmdScanSystem:                handle(routeSpace, (*GameCore).execScanSystem),
	model.CmdScanPlanet:                handle(routeSpace, (*GameCore).execScanPlanet),
	model.CmdCancelConstruction:        handle(routePlanet, (*GameCore).execCancelConstruction),
	model.CmdRestoreConstruction:       handle(routePlanet, (*GameCore).execRestoreConstruction),
	model.CmdStartResearch:             handle(routeSpace, (*GameCore).execStartResearch),
	model.CmdCancelResearch:            handle(routeSpace, (*GameCore).execCancelResearch),
	model.CmdSetRecipe:                 handle(routeTargetBuilding, (*GameCore).execSetRecipe),
	model.CmdSwitchActivePlanet:        handle(routeSpace, (*GameCore).execSwitchActivePlanet),
	model.CmdTransferItem:              handle(routePlanet, (*GameCore).execTransferItem),
	model.CmdLaunchSolarSail:           handle(routePlanet, (*GameCore).execLaunchSolarSail),
	model.CmdLaunchRocket:              handle(routePlanet, (*GameCore).execLaunchRocket),
	model.CmdSetRayReceiverMode:        handle(routePlanet, (*GameCore).execSetRayReceiverMode),
	model.CmdSetEnergyExchangerMode:    handle(routePlanet, (*GameCore).execSetEnergyExchangerMode),
	model.CmdDeploySquad:               handle(routePlanet, (*GameCore).execDeploySquad),
	model.CmdFormSquad:                 handle(routePlanet, (*GameCore).execFormSquad),
	model.CmdSquadOrder:                handle(routePlanet, (*GameCore).execSquadOrder),
	model.CmdDissolveSquad:             handle(routePlanet, (*GameCore).execDissolveSquad),
	model.CmdCommissionFleet:           handle(routePlanet, (*GameCore).execCommissionFleet),
	model.CmdFleetAssign:               handle(routeSpace, (*GameCore).execFleetAssign),
	model.CmdFleetAttack:               handle(routeSpace, (*GameCore).execFleetAttack),
	model.CmdFleetMove:                 handle(routeSpace, (*GameCore).execFleetMove),
	model.CmdFleetDisband:              handle(routeSpace, (*GameCore).execFleetDisband),
	model.CmdTaskForceCreate:           handle(routeSpace, (*GameCore).execTaskForceCreate),
	model.CmdTaskForceAssign:           handle(routeSpace, (*GameCore).execTaskForceAssign),
	model.CmdTaskForceSetStance:        handle(routeSpace, (*GameCore).execTaskForceSetStance),
	model.CmdTaskForceDeploy:           handle(routeSpace, (*GameCore).execTaskForceDeploy),
	model.CmdTheaterCreate:             handle(routeSpace, (*GameCore).execTheaterCreate),
	model.CmdTheaterDefineZone:         handle(routeSpace, (*GameCore).execTheaterDefineZone),
	model.CmdTheaterSetObjective:       handle(routeSpace, (*GameCore).execTheaterSetObjective),
	model.CmdBlockadePlanet:            handle(routeSpace, (*GameCore).execBlockadePlanet),
	model.CmdBlueprintCreate:           handle(routeSpace, (*GameCore).execBlueprintCreate),
	model.CmdBlueprintSetComponent:     handle(routeSpace, (*GameCore).execBlueprintSetComponent),
	model.CmdBlueprintValidate:         handle(routeSpace, (*GameCore).execBlueprintValidate),
	model.CmdBlueprintFinalize:         handle(routeSpace, (*GameCore).execBlueprintFinalize),
	model.CmdBlueprintVariant:          handle(routeSpace, (*GameCore).execBlueprintVariant),
	model.CmdQueueMilitaryProduction:   handle(routePlanet, (*GameCore).execQueueMilitaryProduction),
	model.CmdRefitUnit:                 handle(routePlanet, (*GameCore).execRefitUnit),
	model.CmdBuildDysonNode:            handle(routeSpace, (*GameCore).execBuildDysonNode),
	model.CmdBuildDysonFrame:           handle(routeSpace, (*GameCore).execBuildDysonFrame),
	model.CmdBuildDysonShell:           handle(routeSpace, (*GameCore).execBuildDysonShell),
	model.CmdDemolishDyson:             handle(routeSpace, (*GameCore).execDemolishDyson),
}

// dispatchCommand 查注册表、解码载荷、按行星路由并执行一条命令。
// executed=false 表示命令在路由阶段被拒、未进入执行。
func (gc *GameCore) dispatchCommand(playerID string, player *model.PlayerState, cmd model.Command) (res model.CommandResult, evts []*model.GameEvent, executed bool) {
	handler, ok := commandHandlers[cmd.Type]
	if !ok {
		return model.CommandResult{
			Status:  model.StatusRejected,
			Code:    model.CodeValidationFailed,
			Message: fmt.Sprintf("未知命令类型：%s", cmd.Type),
		}, nil, true
	}
	bound, err := handler.bind(cmd)
	if err != nil {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: err.Error()}, nil, true
	}
	// F4：命令按目标行星路由——显式 planet_id → 目标实体所在行星 →
	// 玩家焦点行星 → 全局活动行星兜底。
	ws, routeFailure := gc.resolveCommandWorld(player, cmd, handler.route, bound.refs)
	if routeFailure != nil {
		return *routeFailure, nil, false
	}
	res, evts = bound.exec(gc, ws, playerID)
	return res, evts, true
}

// routeRefs 按注册的路由方式抽取 target 里的实体引用，再并上载荷里的引用。
// 注意：attack/unit_order 的 payload.target_entity_id 是被攻击/跟随对象，
// 与施令单位必然同行星，不参与路由（避免跨行星同 ID 时误导路由）。
func (route commandRoute) refs(cmd model.Command, payload entityRefs) entityRefs {
	refs := payload
	target := cmd.Target
	switch route {
	case routeUnitSelection:
		if target.EntityID != "" {
			refs.units = append(refs.units, target.EntityID)
		}
		refs.units = append(refs.units, target.EntityIDs...)
	case routeTargetUnit:
		if target.EntityID != "" {
			refs.units = append(refs.units, target.EntityID)
		}
	case routeTargetBuilding:
		if target.EntityID != "" {
			refs.buildings = append(refs.buildings, target.EntityID)
		}
	}
	return refs
}
