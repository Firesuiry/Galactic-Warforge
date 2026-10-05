package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func newSquadDeployTestCore(t *testing.T, ready int) (*GameCore, *model.WorldState, *model.Building) {
	t.Helper()
	core := newE2ETestCore(t)
	ws := core.World()
	grantTechs(ws, "p1", "prototype")
	hub := newBuilding("hub-deploy", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	hub.Runtime.State = model.BuildingWorkRunning
	hub.Runtime.Params.EnergyConsume = 0
	if hub.Runtime.Functions.Energy != nil {
		hub.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, hub)
	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[hub.ID] = &model.WarDeploymentHubState{
		BuildingID:    hub.ID,
		Capacity:      16,
		ReadyPayloads: map[string]int{model.ItemPrototype: ready},
	}
	return core, ws, hub
}

// 蓝图形态的 deploy_squad 产出真实世界单位并编队；小队能按 squad_order 移动并造成伤害。
func TestDeploySquadBlueprintSpawnsUnitsThatFight(t *testing.T) {
	core, ws, hub := newSquadDeployTestCore(t, 2)
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 14, Y: 6})

	res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdDeploySquad,
		Payload: map[string]any{"building_id": hub.ID, "blueprint_id": model.ItemPrototype, "count": 2},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("deploy_squad blueprint form failed: %s (%s)", res.Code, res.Message)
	}
	if left := ws.Players["p1"].WarIndustry.DeploymentHubs[hub.ID].ReadyPayloads[model.ItemPrototype]; left != 0 {
		t.Fatalf("payloads not consumed, %d left", left)
	}
	squad := ws.CombatRuntime.Squads[res.Message]
	if squad == nil {
		t.Fatalf("squad %q not created", res.Message)
	}
	members := squad.Members(ws)
	if len(members) != 2 {
		t.Fatalf("expected 2 world-unit members, got %+v", squad.MemberIDs)
	}
	start := map[string]model.Position{}
	for _, u := range members {
		if u.SquadID != squad.ID || u.MaxHP != 80 || u.Attack != 20 || u.ArmorClass != model.ArmorHeavy || u.WeaponClass != model.WeaponTypeLaser {
			t.Fatalf("member does not carry the prototype profile: %+v", u)
		}
		found := false
		for _, id := range ws.TileUnits[model.TileKey(u.Position.X, u.Position.Y)] {
			found = found || id == u.ID
		}
		if !found || ws.Grid[u.Position.Y][u.Position.X].BuildingID != "" {
			t.Fatalf("member %s not registered on a free tile: %+v", u.ID, u.Position)
		}
		start[u.ID] = u.Position
	}

	target := enemy.Position
	if r := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdSquadOrder,
		Target:  model.CommandTarget{Position: &target},
		Payload: map[string]any{"squad_id": squad.ID, "order": "attack"},
	}); r.Code != model.CodeOK {
		t.Fatalf("squad_order attack failed: %s (%s)", r.Code, r.Message)
	}
	advanceRTT(ws, 200)
	moved := false
	for _, u := range squad.Members(ws) {
		moved = moved || u.Position != start[u.ID]
	}
	if !moved {
		t.Fatal("deployed squad members never moved")
	}
	if alive := ws.Units[enemy.ID]; alive != nil && alive.HP >= alive.MaxHP {
		t.Fatal("deployed squad dealt no damage")
	}
}

// 校验失败（载荷不足、数量越界、非法名称）时不消耗载荷、不生成单位。
func TestDeploySquadBlueprintValidatesBeforeConsuming(t *testing.T) {
	core, ws, hub := newSquadDeployTestCore(t, 1)
	units := len(ws.Units)
	bad := []map[string]any{
		{"count": 2}, {"count": 0}, {"count": 301},
		{"name": "   "}, {"name": "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一"},
	}
	for _, extra := range bad {
		payload := map[string]any{"building_id": hub.ID, "blueprint_id": model.ItemPrototype}
		for k, v := range extra {
			payload[k] = v
		}
		if res := issueInternalCommand(core, "p1", model.Command{Type: model.CmdDeploySquad, Payload: payload}); res.Code == model.CodeOK {
			t.Fatalf("payload %v must be rejected", extra)
		}
	}
	if len(ws.Units) != units || ws.Players["p1"].WarIndustry.DeploymentHubs[hub.ID].ReadyPayloads[model.ItemPrototype] != 1 {
		t.Fatal("failed deploys must not spawn units or consume payloads")
	}
	// count 缺省为 1。
	res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdDeploySquad,
		Payload: map[string]any{"building_id": hub.ID, "blueprint_id": model.ItemPrototype},
	})
	if res.Code != model.CodeOK || len(ws.CombatRuntime.Squads[res.Message].MemberIDs) != 1 {
		t.Fatalf("default count deploy failed: %+v", res)
	}
}
