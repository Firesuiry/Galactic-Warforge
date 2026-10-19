package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// 分拣器端点诊断：把 sorterFindEndpoint 的判定结果连同「为什么没连上」一起
// 暴露出来。分拣器两端都有效才搬运，而摆错时它静默不动、也不报警；试玩里
// 代理因此浪费大量时间。这里不复制判定逻辑，扫描/端口/传送带规则仍然只有
// sorterProbeEndpoint 一份，sorterFindEndpoint 是它的薄包装。
//
// sorterEndpointProbe 是一次沿轴扫描的完整结果：连上时 Link/OK 有效，
// 没连上时 Reason 说明原因，Building* 是轴上的第一个建筑。
type sorterEndpointProbe struct {
	Link         sorterLink
	OK           bool
	BuildingID   string
	BuildingType model.BuildingType
	BuildingName string
	Position     model.Position
	// Direction 是扫描起点的方向（取货端 = 背面、放货端 = 正面）。
	Direction string
	Steps     int
	MaxRange  int
	Pending   bool
	ForInput  bool
	Reason    string
}

// DiagnoseSorterEndpoints 返回分拣器两端的诊断；非分拣器返回 nil。
// 调用方负责持有 ws 的读锁。
func DiagnoseSorterEndpoints(ws *model.WorldState, sorter *model.Building) *model.SorterEndpointsView {
	if ws == nil || sorter == nil || sorter.Sorter == nil {
		return nil
	}
	back, front := model.SorterFacingAxis(sorter.Rotation)
	rangeLimit := sorter.Sorter.Range
	if rangeLimit <= 0 {
		rangeLimit = 1
	}
	pick := sorterProbeEndpoint(ws, sorter, back, rangeLimit, true, nil)
	drop := sorterProbeEndpoint(ws, sorter, front, rangeLimit, false, nil)
	return &model.SorterEndpointsView{
		Pick: pick.view(),
		Drop: drop.view(),
	}
}

func (p sorterEndpointProbe) view() model.SorterEndpointView {
	view := model.SorterEndpointView{Direction: p.Direction}
	if p.OK {
		pos := p.Position
		view.BuildingID = p.BuildingID
		view.BuildingType = p.BuildingType
		view.BuildingName = p.BuildingName
		view.Position = &pos
		view.Steps = p.Steps
		view.Pending = p.Pending
		return view
	}
	view.Reason = p.Reason
	if p.BuildingID != "" {
		pos := p.Position
		view.BlockerID = p.BuildingID
		view.BlockerType = p.BuildingType
		view.BlockerName = p.BuildingName
		view.BlockerPosition = &pos
		view.Steps = p.Steps
		view.Pending = p.Pending
	}
	return view
}

// sorterProbeEndpoint 是分拣器端点判定的唯一实现：沿 dir 扫 maxRange 格，
// 跳过空格，停在第一个建筑上。overlay 是「尚未落成的施工任务」占地
// （tileKey → 临时建筑），建造回执的预判用它把排队中的建筑也算进去；
// inspect 传 nil。
func sorterProbeEndpoint(
	ws *model.WorldState,
	sorter *model.Building,
	dir model.ConveyorDirection,
	maxRange int,
	forInput bool,
	overlay map[string]*model.Building,
) sorterEndpointProbe {
	probe := sorterEndpointProbe{
		Direction: string(dir),
		MaxRange:  maxRange,
		ForInput:  forInput,
	}
	if ws == nil || sorter == nil || maxRange <= 0 {
		probe.Reason = model.SorterEndpointReasonNoBuilding
		return probe
	}

	pos := sorter.Position
	scanDir := dir
	for step := 1; step <= maxRange; step++ {
		pos, scanDir = ws.SurfaceStep(pos, scanDir)
		key := model.TileKey(pos.X, pos.Y)
		target, pending, occupied := lookupSorterScanTarget(ws, key, overlay)
		if !occupied {
			continue
		}
		if target == nil {
			// 占格索引指向了不存在的建筑：旧实现同样在这里停止扫描。
			probe.Reason = model.SorterEndpointReasonNoStorage
			return probe
		}
		probe.BuildingID = target.ID
		probe.BuildingType = target.Type
		probe.BuildingName = buildingTypeDisplayName(target.Type)
		probe.Position = pos
		probe.Steps = step
		probe.Pending = pending

		if target.OwnerID != sorter.OwnerID {
			probe.Reason = model.SorterEndpointReasonNotOwned
			return probe
		}
		if model.IsSorterBuilding(target.Type) {
			probe.Reason = model.SorterEndpointReasonBlockedBySorter
			return probe
		}
		if target.Conveyor != nil {
			if target.Splitter != nil {
				probe.Reason = model.SorterEndpointReasonSplitter
				return probe
			}
			if !conveyorActive(target) {
				probe.Reason = model.SorterEndpointReasonConveyorInactive
				return probe
			}
			// 取货端可以从任意路过的带格上取（不要求带尾正对分拣器）；
			// 放货端仍要求该格能接受这一侧插入。
			if forInput && !sorterCanTakeFromConveyor(target) {
				probe.Reason = model.SorterEndpointReasonConveyorInactive
				return probe
			}
			if !forInput && !sorterCanInsertToConveyor(target, scanDir) {
				probe.Reason = model.SorterEndpointReasonConveyorSide
				return probe
			}
			probe.Link = sorterLink{id: target.ID, dir: scanDir, steps: step}
			probe.OK = true
			return probe
		}
		if target.Storage != nil && ws.BuildingOccupies(target, pos) {
			for _, port := range sortedIOPorts(target.Runtime.Params.IOPorts) {
				if (forInput && (port.Direction == model.PortOutput || port.Direction == model.PortBoth)) ||
					(!forInput && (port.Direction == model.PortInput || port.Direction == model.PortBoth)) {
					probe.Link = sorterLink{id: target.ID, dir: scanDir, port: port.ID, steps: step}
					probe.OK = true
					return probe
				}
			}
			probe.Reason = model.SorterEndpointReasonNoPort
			return probe
		}
		probe.Reason = model.SorterEndpointReasonNoStorage
		return probe
	}
	probe.Reason = model.SorterEndpointReasonNoBuilding
	return probe
}

// lookupSorterScanTarget 返回某格上的建筑：已落成的优先，其次是施工任务
// overlay（临时建筑）。pending 表示命中的是施工任务；occupied 表示该格被占
// （即使建筑数据缺失）。
func lookupSorterScanTarget(ws *model.WorldState, tileKey string, overlay map[string]*model.Building) (target *model.Building, pending, occupied bool) {
	if id := ws.TileBuilding[tileKey]; id != "" {
		return ws.Buildings[id], false, true
	}
	if overlay != nil {
		if building := overlay[tileKey]; building != nil {
			return building, true, true
		}
	}
	return nil, false, false
}

// pendingSorterOverlay 把同玩家尚未落成的施工任务变成临时建筑并铺到占地上。
// 只取地面层（高架带不占地面），跳过地基（不占 TileBuilding）和配送器
// （叠在宿主上、Z=1）。skipTaskID 用来排除正在生成回执的那条任务。
func pendingSorterOverlay(ws *model.WorldState, playerID, skipTaskID string) map[string]*model.Building {
	if ws == nil || ws.Construction == nil {
		return nil
	}
	overlay := make(map[string]*model.Building)
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.PlayerID != playerID || task.ID == skipTaskID {
			continue
		}
		switch task.State {
		case model.ConstructionPending, model.ConstructionInProgress, model.ConstructionPaused:
		default:
			continue
		}
		if task.Elevation > 0 || task.Position.Z > 0 ||
			task.BuildingType == model.BuildingTypeFoundation ||
			task.BuildingType == model.BuildingTypeLogisticsDistributor {
			continue
		}
		tiles, err := ws.ConstructionTiles(task)
		if err != nil {
			continue
		}
		building := sorterPendingBuilding(task)
		for _, tile := range tiles {
			overlay[model.TileKey(tile.X, tile.Y)] = building
		}
	}
	if len(overlay) == 0 {
		return nil
	}
	return overlay
}

// sorterPendingBuilding 按施工任务构造一台「落成后长这样」的临时建筑：
// 类型/朝向/传送带方向与 completeConstructionTask 同口径。ID 用任务 ID，
// 因为此时还没有建筑 ID。Runtime.State 假定为运行中（预判不模拟供电）。
func sorterPendingBuilding(task *model.ConstructionTask) *model.Building {
	profile := model.BuildingProfileFor(task.BuildingType, 1)
	building := &model.Building{
		ID:          task.ID,
		Type:        task.BuildingType,
		OwnerID:     task.PlayerID,
		Position:    task.Position,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.ApplyBuildingRotation(building, task.Rotation)
	model.InitBuildingStorage(building)
	model.InitBuildingConveyor(building)
	model.InitBuildingSorter(building)
	if building.Conveyor != nil && building.Splitter == nil &&
		task.ConveyorDirection.Valid() && task.ConveyorDirection != model.ConveyorAuto {
		building.Conveyor.Output = task.ConveyorDirection
		building.Conveyor.Input = task.ConveyorDirection.Opposite()
	}
	building.Runtime.State = model.BuildingWorkRunning
	return building
}

// sorterBuildEndpointHint 是 build 分拣器成功回执追加的端点预判。
// 按下单时的世界状态计算，并把同玩家排队中/建造中的施工任务也算进去。
func sorterBuildEndpointHint(ws *model.WorldState, task *model.ConstructionTask) string {
	if ws == nil || task == nil || !model.IsSorterBuilding(task.BuildingType) {
		return ""
	}
	sorter := sorterPendingBuilding(task)
	if sorter.Sorter == nil {
		return ""
	}
	rangeLimit := sorter.Sorter.Range
	if rangeLimit <= 0 {
		rangeLimit = 1
	}
	overlay := pendingSorterOverlay(ws, task.PlayerID, task.ID)
	back, front := model.SorterFacingAxis(task.Rotation)
	pick := sorterProbeEndpoint(ws, sorter, back, rangeLimit, true, overlay)
	drop := sorterProbeEndpoint(ws, sorter, front, rangeLimit, false, overlay)
	return "；取货端：" + sorterEndpointHintText(pick) + "，放货端：" + sorterEndpointHintText(drop)
}

// sorterEndpointHintText 把一次扫描结果写成回执里的人话。
func sorterEndpointHintText(p sorterEndpointProbe) string {
	if p.OK {
		text := sorterEndpointRef(p)
		if p.Steps > 1 {
			text += fmt.Sprintf("（%s %d 格）", sorterDirectionLabel(p.Direction), p.Steps)
		}
		return text
	}
	side := sorterDirectionLabel(p.Direction)
	switch p.Reason {
	case model.SorterEndpointReasonNoBuilding:
		return fmt.Sprintf("未连上——%s侧 %d 格内没有建筑", side, p.MaxRange)
	case model.SorterEndpointReasonNotOwned:
		return fmt.Sprintf("未连上——%s侧 %d 格是%s，不是你的", side, p.Steps, sorterEndpointRef(p))
	case model.SorterEndpointReasonBlockedBySorter:
		return fmt.Sprintf("未连上——%s侧 %d 格是分拣器 %s，挡住了", side, p.Steps, sorterBlockerRef(p))
	case model.SorterEndpointReasonSplitter:
		return fmt.Sprintf("未连上——%s侧 %d 格是分流器 %s，挡住了", side, p.Steps, sorterBlockerRef(p))
	case model.SorterEndpointReasonConveyorInactive:
		return fmt.Sprintf("未连上——%s侧 %d 格的传送带 %s 未运行", side, p.Steps, sorterBlockerRef(p))
	case model.SorterEndpointReasonConveyorSide:
		return fmt.Sprintf("未连上——%s侧 %d 格的传送带 %s 不接受这一侧插入", side, p.Steps, sorterBlockerRef(p))
	case model.SorterEndpointReasonNoPort:
		port := "放货"
		if p.ForInput {
			port = "取货"
		}
		return fmt.Sprintf("未连上——%s侧 %d 格是%s，没有%s端口", side, p.Steps, sorterEndpointRef(p), port)
	case model.SorterEndpointReasonNoStorage:
		action := "放货"
		if p.ForInput {
			action = "取货"
		}
		return fmt.Sprintf("未连上——%s侧 %d 格是%s，没有存储，不能%s", side, p.Steps, sorterEndpointRef(p), action)
	default:
		return "未连上"
	}
}

// sorterEndpointRef 是轴上一个建筑的短名：已落成的写「b-55 电弧熔炉」，
// 施工任务写「电弧熔炉（施工中，任务 c-7）」。
func sorterEndpointRef(p sorterEndpointProbe) string {
	if p.Pending {
		return fmt.Sprintf("%s（施工中，任务 %s）", p.BuildingName, p.BuildingID)
	}
	return fmt.Sprintf("%s %s", p.BuildingID, p.BuildingName)
}

func sorterBlockerRef(p sorterEndpointProbe) string {
	if p.Pending {
		return fmt.Sprintf("%s（施工中，任务 %s）", p.BuildingName, p.BuildingID)
	}
	return p.BuildingID
}

func sorterDirectionLabel(dir string) string {
	switch model.ConveyorDirection(dir) {
	case model.ConveyorNorth:
		return "北"
	case model.ConveyorEast:
		return "东"
	case model.ConveyorSouth:
		return "南"
	case model.ConveyorWest:
		return "西"
	default:
		return dir
	}
}
