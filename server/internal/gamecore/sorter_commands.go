package gamecore

import "siliconworld/internal/model"

type configureSorterPayload struct {
	InputDirections  []string `json:"input_directions" payload:"required"`
	OutputDirections []string `json:"output_directions" payload:"required"`
	FilterMode       *string  `json:"filter_mode"`
	FilterItems      []string `json:"filter_items"`
}

func (gc *GameCore) execConfigureSorter(ws *model.WorldState, playerID string, cmd model.Command, p configureSorterPayload) (model.CommandResult, []*model.GameEvent) {
	b := ws.Buildings[cmd.Target.EntityID]
	if b == nil {
		return mechaJobFailed(model.CodeEntityNotFound, "未找到分拣器")
	}
	if b.OwnerID != playerID {
		return mechaJobFailed(model.CodeNotOwner, "不能配置其他玩家的分拣器")
	}
	if b.Sorter == nil {
		return mechaJobFailed(model.CodeInvalidTarget, "目标不是分拣器")
	}
	staged := b.Sorter.Clone()
	used := map[string]bool{}
	for i, dirs := range [][]string{p.InputDirections, p.OutputDirections} {
		if len(dirs) == 0 {
			return mechaJobFailed(model.CodeValidationFailed, "分拣器的输入和输出方向不能为空")
		}
		values := make([]model.ConveyorDirection, 0, len(dirs))
		for _, value := range dirs {
			dir := model.ConveyorDirection(value)
			if !dir.Valid() || dir == model.ConveyorAuto || used[value] {
				return mechaJobFailed(model.CodeValidationFailed, "方向必须是互不重复的东南西北方向")
			}
			used[value] = true
			values = append(values, dir)
		}
		if i == 0 {
			staged.InputDirections = values
		} else {
			staged.OutputDirections = values
		}
	}
	staged.Filter = model.SorterFilter{Mode: model.SorterFilterAllow}
	if p.FilterMode != nil {
		value := *p.FilterMode
		if value != "allow" && value != "deny" {
			return mechaJobFailed(model.CodeValidationFailed, "filter_mode 必须为 allow 或 deny")
		}
		staged.Filter.Mode = model.SorterFilterMode(value)
	}
	if values := p.FilterItems; values != nil {
		seen := map[string]bool{}
		for _, id := range values {
			if _, ok := model.Item(id); !ok || seen[id] {
				return mechaJobFailed(model.CodeValidationFailed, "filter_items 必须是不重复的物品目录 ID")
			}
			seen[id] = true
		}
		staged.Filter.Items = values
	}
	b.Sorter = staged
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "分拣器已配置"}, []*model.GameEvent{{EventType: model.EvtBuildingStateChanged, VisibilityScope: playerID, Payload: map[string]any{"entity_id": b.ID, "sorter": staged.Clone()}}}
}
