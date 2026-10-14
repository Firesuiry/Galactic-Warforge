package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// SubmitCommand 以玩家身份把一条命令放进命令队列，与 HTTP 层 POST /commands 同一条路径：
// 命令在**下一个 tick** 的结算阶段执行，因此调用方要再推进一步（AdvanceTick）才看得到结果。
//
// 供重建/回放这类「脚本化下发」场景使用（存档点构建段、回归测试），
// 与 bot 的 botIssue 同一语义，只是 issuer_type 是 player。
func (gc *GameCore) SubmitCommand(playerID string, cmd model.Command) error {
	if gc == nil {
		return fmt.Errorf("game core is nil")
	}
	if gc.world == nil {
		return fmt.Errorf("world is nil")
	}
	if playerID == "" {
		return fmt.Errorf("player id is required")
	}
	req := &model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  fmt.Sprintf("submit-%s-%d-%s", playerID, gc.CurrentTick(), cmd.Type),
			IssuerType: "player",
			IssuerID:   playerID,
			Commands:   []model.Command{cmd},
		},
		PlayerID:    playerID,
		EnqueueTick: gc.CurrentTick(),
	}
	if gc.queue == nil {
		return fmt.Errorf("command queue is not configured")
	}
	if !gc.queue.Enqueue(req) {
		return fmt.Errorf("命令 %s 与上一 tick 的同名请求重复（request_id 冲突）", cmd.Type)
	}
	return nil
}

// AdvanceTick 推进一个 tick（结算队列里的命令、跑完结算管线、发事件）。
// 正常情况下由 Run 的 tick 循环驱动；这里显式暴露给「不走墙钟时钟」的场景：
// 存档点构建段重建、回放校验、需要确定性节奏的回归测试。
func (gc *GameCore) AdvanceTick() {
	if gc == nil {
		return
	}
	gc.processTick()
}
