package gateway_test

import "siliconworld/internal/model"

// firstBoundMecha 返回绑定给 operator 的第一台机甲（按 unit ID 升序）。
// 第 22 轮起一个发令者可以绑多台机甲，测试里通常只关心「那台开局机甲」。
func firstBoundMecha(player *model.PlayerState, operator string) *model.MechaRecord {
	if player == nil {
		return nil
	}
	records := player.MechasByOperator(operator)
	if len(records) == 0 {
		return nil
	}
	return records[0]
}
