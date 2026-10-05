package gamecore

import (
	"reflect"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// execCommand 在给定世界上直接执行一条命令（跳过权限校验与行星路由），供单测使用。
func execCommand(gc *GameCore, cmdType model.CommandType, ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	cmd.Type = cmdType
	bound, err := commandHandlers[cmdType].bind(cmd)
	if err != nil {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: err.Error()}, nil
	}
	return bound.exec(gc, ws, playerID)
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

// payloadFieldTags 收集载荷结构体（含内嵌结构体）的 json 字段名 → payload 标签。
func payloadFieldTags(t reflect.Type) map[string]string {
	out := map[string]string{}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.Anonymous {
			for name, tag := range payloadFieldTags(field.Type) {
				out[name] = tag
			}
			continue
		}
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		out[name] = field.Tag.Get("payload")
	}
	return out
}

// 载荷结构体必须覆盖目录声明的全部载荷字段，目录必填字段在结构体里也必填。
func TestCommandPayloadStructsMatchCatalog(t *testing.T) {
	for cmdType, handler := range commandHandlers {
		spec, _ := model.CommandSpec(cmdType)
		fields := payloadFieldTags(handler.payload)
		for _, name := range spec.RequiredPayloadFields {
			tag, ok := fields[name]
			if !ok {
				t.Errorf("%s: payload struct lacks required field %s", cmdType, name)
				continue
			}
			// deploy_squad 的蓝图投放形态不带 member_ids，由执行器按形态校验。
			if !strings.Contains(tag, "required") && !(cmdType == model.CmdDeploySquad && name == "member_ids") {
				t.Errorf("%s: catalog-required field %s is not required in payload struct", cmdType, name)
			}
		}
		for _, name := range spec.OptionalPayloadFields {
			if tag, ok := fields[name]; !ok {
				t.Errorf("%s: payload struct lacks optional field %s", cmdType, name)
			} else if strings.Contains(tag, "required") {
				t.Errorf("%s: catalog-optional field %s is required in payload struct", cmdType, name)
			}
		}
	}
}

func TestDecodePayloadErrors(t *testing.T) {
	cases := []struct {
		cmdType model.CommandType
		payload map[string]any
		want    string
	}{
		{model.CmdTransferItem, map[string]any{"item_id": "iron_ore", "quantity": 1}, "payload.building_id required"},
		{model.CmdTransferItem, map[string]any{"building_id": "", "item_id": "iron_ore", "quantity": 1}, "payload.building_id must be a non-empty string"},
		{model.CmdTransferItem, map[string]any{"building_id": "b1", "item_id": "iron_ore", "quantity": 1.5}, "payload.quantity must be integer"},
		{model.CmdTransferItem, map[string]any{"building_id": 7, "item_id": "iron_ore", "quantity": 1}, "payload.building_id must be a string"},
		{model.CmdBuild, map[string]any{"building_type": "wind_turbine", "auto_approach": "yes"}, "payload.auto_approach must be boolean"},
		{model.CmdTaskForceDeploy, map[string]any{"task_force_id": "tf", "position": map[string]any{"x": 1}}, "payload.position.y required"},
		{model.CmdConfigureMechaLogistics, map[string]any{"requests": map[string]any{"iron_ore": map[string]any{"max": 5}}}, "payload.requests.iron_ore.min required"},
		{model.CmdConfigureLogisticsStation, map[string]any{"interstellar": map[string]any{"enabled": "on"}}, "payload.interstellar.enabled must be boolean"},
	}
	for _, tc := range cases {
		_, err := commandHandlers[tc.cmdType].bind(model.Command{Type: tc.cmdType, Payload: tc.payload})
		if err == nil || err.Error() != tc.want {
			t.Errorf("%s %v: got %v, want %q", tc.cmdType, tc.payload, err, tc.want)
		}
	}
}

func TestDecodePayloadAcceptsGoTypedValues(t *testing.T) {
	p, err := decodePayload[taskForceAssignPayload](map[string]any{
		"task_force_id": "tf-1",
		"member_kind":   model.WarTaskForceMemberKindSquad,
		"member_ids":    []string{"s1", "s2"},
	})
	if err != nil || p.MemberKind != string(model.WarTaskForceMemberKindSquad) || len(p.MemberIDs) != 2 {
		t.Fatalf("decode typed values: %+v, %v", p, err)
	}
	node, err := decodePayload[buildDysonNodePayload](map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude": 10, "longitude": -5.5})
	if err != nil || node.Latitude != 10 || node.Longitude != -5.5 {
		t.Fatalf("decode int into float: %+v, %v", node, err)
	}
	deploy, err := decodePayload[taskForceDeployPayload](map[string]any{"task_force_id": "tf-1", "position": model.Position{X: 3, Y: 4}})
	if err != nil || *deploy.Position.toPosition() != (model.Position{X: 3, Y: 4}) {
		t.Fatalf("decode typed position: %+v, %v", deploy, err)
	}
}

func TestPayloadRefsDriveRouting(t *testing.T) {
	bound, err := commandHandlers[model.CmdDeploySquad].bind(model.Command{
		Type:    model.CmdDeploySquad,
		Payload: map[string]any{"member_ids": []any{"u1"}, "building_id": "b1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(bound.refs, entityRefs{buildings: []string{"b1"}, units: []string{"u1"}}) {
		t.Fatalf("deploy_squad refs = %+v", bound.refs)
	}
	bound, err = commandHandlers[model.CmdMove].bind(model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: "u1", EntityIDs: []string{"u2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(bound.refs.units, []string{"u1", "u2"}) {
		t.Fatalf("move refs = %+v", bound.refs)
	}
}
