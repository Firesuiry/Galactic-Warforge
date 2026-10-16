package gamecore

import "siliconworld/internal/model"

// configureSorterPayload 只配过滤：分拣器的取/放端由建造朝向决定
// （背面取货、正面放货），配置命令不能改方向。方向字段保留在结构体里是为了
// 给出明确的中文拒绝原因，而不是静默忽略。
type configureSorterPayload struct {
	InputDirections  []string `json:"input_directions"`
	OutputDirections []string `json:"output_directions"`
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
	if p.InputDirections != nil || p.OutputDirections != nil {
		return mechaJobFailed(model.CodeValidationFailed, "分拣器方向由建造朝向决定（背面取货、正面放货），configure_sorter 只配置过滤；请拆除后按新朝向重建，或改用 R 旋转建造")
	}

	staged := b.Sorter.Clone()
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
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "分拣器过滤已配置"}, []*model.GameEvent{{EventType: model.EvtBuildingStateChanged, VisibilityScope: playerID, Payload: map[string]any{"entity_id": b.ID, "sorter": staged.Clone()}}}
}
