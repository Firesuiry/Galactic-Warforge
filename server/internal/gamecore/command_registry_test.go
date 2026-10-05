package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// execCommand 在给定世界上直接执行一条命令（跳过权限校验与行星路由），供单测使用。
func execCommand(gc *GameCore, cmdType model.CommandType, ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	cmd.Type = cmdType
	return commandHandlers[cmdType].exec(gc, ws, playerID, cmd)
}

func TestCommandRegistryMatchesCatalog(t *testing.T) {
	catalog := model.AllCommandTypes()
	seen := make(map[model.CommandType]bool, len(catalog))
	for _, cmdType := range catalog {
		seen[cmdType] = true
		if _, ok := commandHandlers[cmdType]; !ok {
			t.Errorf("catalog command %s has no handler", cmdType)
		}
	}
	for cmdType := range commandHandlers {
		if !seen[cmdType] {
			t.Errorf("handler %s is not in the command catalog", cmdType)
		}
	}
}
