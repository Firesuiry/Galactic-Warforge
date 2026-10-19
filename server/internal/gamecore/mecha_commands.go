package gamecore

import (
	"fmt"
	"regexp"

	"siliconworld/internal/model"
)

// operatorPattern 是 issuer_id / operator 的合法形态（契约 §1）：1–64 位
// 字母、数字与 _ . : -。
var operatorPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)

// ValidOperatorID 报告一个发令者/操作者 ID 是否合规则。
func ValidOperatorID(id string) bool {
	return operatorPattern.MatchString(id)
}

type assignMechaPayload struct {
	Operator string `json:"operator" payload:"required,allowempty"`
}

// execAssignMecha 绑定/解绑一台本方机甲。同玩家的任何发令者都能改任何本方机甲
// 的绑定（协作关系，不设防）；operator 非空且已绑别的机甲时那台自动解绑。
func (gc *GameCore) execAssignMecha(ws *model.WorldState, playerID string, cmd model.Command, p assignMechaPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到玩家"
		return res, nil
	}
	mechaID := cmd.Target.EntityID
	if mechaID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "assign_mecha 缺少 target.entity_id"
		return res, nil
	}
	record := player.MechaByUnitID(mechaID)
	if record == nil {
		if unit := ws.Units[mechaID]; unit != nil {
			if unit.OwnerID != playerID {
				res.Code = model.CodeNotOwner
				res.Message = "不能改绑其他玩家的机甲"
				return res, nil
			}
			res.Code = model.CodeEntityNotFound
			res.Message = fmt.Sprintf("机甲 %s 没有档案", mechaID)
			return res, nil
		}
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到机甲 %s", mechaID)
		return res, nil
	}
	operator := p.Operator
	if operator != "" && !ValidOperatorID(operator) {
		res.Code = model.CodeValidationFailed
		res.Message = "operator 只允许 1–64 位字母、数字与 _ . : -"
		return res, nil
	}
	// 契约 §2.2：一次 assign_mecha 只产出一条 entity_updated；抢占时旧机甲
	// 的释放写在 released_mecha_id 里，不另发第二条事件。
	payload := map[string]any{"mecha_id": record.UnitID, "operator": operator}
	if operator != "" {
		if previous := player.MechaByOperator(operator); previous != nil && previous.UnitID != record.UnitID {
			previous.Operator = ""
			payload["released_mecha_id"] = previous.UnitID
		}
	}
	record.Operator = operator
	events := []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload:         payload,
	}}
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	if operator == "" {
		res.Message = fmt.Sprintf("机甲 %s 已解绑（空闲）", record.UnitID)
	} else {
		res.Message = fmt.Sprintf("机甲 %s 已绑定给 %s", record.UnitID, operator)
	}
	return res, events
}
