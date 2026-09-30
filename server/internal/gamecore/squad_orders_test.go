package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func formTestSquad(t *testing.T, ws *model.WorldState, units ...*model.Unit) *model.CombatSquad {
	t.Helper()
	ids := make([]string, len(units))
	for i, u := range units {
		ids[i] = u.ID
	}
	res, events := (&GameCore{}).execFormSquad(ws, "p1", model.Command{Type: model.CmdFormSquad, Payload: map[string]any{"entity_ids": toAnySlice(ids)}})
	if res.Code != model.CodeOK {
		t.Fatalf("form_squad: %+v", res)
	}
	if len(events) == 0 || events[0].EventType != model.EvtSquadDeployed {
		t.Fatalf("expected squad_deployed event: %+v", events)
	}
	return ws.CombatRuntime.Squads[res.Message]
}

func toAnySlice(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

func squadOrder(ws *model.WorldState, squadID, order string, pos *model.Position) model.CommandResult {
	res, _ := (&GameCore{}).execSquadOrder(ws, "p1", model.Command{Type: model.CmdSquadOrder, Target: model.CommandTarget{Position: pos}, Payload: map[string]any{"squad_id": squadID, "order": order}})
	return res
}

func stepSquad(ws *model.WorldState, ticks int) {
	for i := 0; i < ticks; i++ {
		ws.Tick++
		settleCombatRuntime(ws, ws.Tick)
		settleAmmunitionSupply(ws)
		settleUnitMovement(ws)
		settleUnitCombat(ws)
	}
}

func TestFormSquadFromSelectedUnits(t *testing.T) {
	ws := newRTTWorld(true)
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 4, Y: 3})
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p1", model.Position{X: 2, Y: 3})
	squad := formTestSquad(t, ws, a, b, truck)
	if squad.OwnerID != "p1" || len(squad.MemberIDs) != 3 || squad.Order != model.SquadOrderIdle {
		t.Fatalf("bad squad: %+v", squad)
	}
	for _, u := range []*model.Unit{a, b, truck} {
		if u.SquadID != squad.ID {
			t.Fatalf("%s not tagged with squad", u.ID)
		}
	}
	// 编成不凭空造血造弹。
	if a.Ammo != a.AmmoCapacity || a.HP != a.MaxHP {
		t.Fatal("forming must not alter unit state")
	}
	if name := squad.Name; name != "军团" {
		t.Fatalf("default name = %q", name)
	}
}

func TestFormSquadValidation(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	mine := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	theirs := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 4, Y: 3})
	worker := spawnWorldTestUnit(ws, model.UnitTypeWorker, "p1", model.Position{X: 5, Y: 3})
	dead := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 6, Y: 3})
	dead.HP = 0
	form := func(payload map[string]any) model.ResultCode {
		res, _ := gc.execFormSquad(ws, "p1", model.Command{Type: model.CmdFormSquad, Payload: payload})
		return res.Code
	}
	cases := []struct {
		name    string
		payload map[string]any
		want    model.ResultCode
	}{
		{"missing ids", map[string]any{}, model.CodeValidationFailed},
		{"empty ids", map[string]any{"entity_ids": []any{}}, model.CodeValidationFailed},
		{"duplicate", map[string]any{"entity_ids": []any{mine.ID, mine.ID}}, model.CodeValidationFailed},
		{"unknown", map[string]any{"entity_ids": []any{"ghost"}}, model.CodeEntityNotFound},
		{"dead", map[string]any{"entity_ids": []any{dead.ID}}, model.CodeEntityNotFound},
		{"foreign", map[string]any{"entity_ids": []any{mine.ID, theirs.ID}}, model.CodeNotOwner},
		{"worker", map[string]any{"entity_ids": []any{worker.ID}}, model.CodeInvalidTarget},
		{"bad name", map[string]any{"entity_ids": []any{mine.ID}, "name": "  "}, model.CodeValidationFailed},
	}
	for _, tc := range cases {
		if got := form(tc.payload); got != tc.want {
			t.Errorf("%s: got %s want %s", tc.name, got, tc.want)
		}
	}
	if mine.SquadID != "" || ws.CombatRuntime != nil && len(ws.CombatRuntime.Squads) != 0 {
		t.Fatal("rejected forms must not leave a squad behind")
	}
	// 已在军团里的单位不能重复编入，需先解散。
	squad := formTestSquad(t, ws, mine)
	if got := form(map[string]any{"entity_ids": []any{mine.ID}}); got != model.CodeInvalidTarget {
		t.Fatalf("regroup must be rejected, got %s", got)
	}
	res, _ := gc.execDissolveSquad(ws, "p1", model.Command{Type: model.CmdDissolveSquad, Payload: map[string]any{"squad_id": squad.ID}})
	if res.Code != model.CodeOK || mine.SquadID != "" || len(ws.CombatRuntime.Squads) != 0 {
		t.Fatalf("dissolve: %+v", res)
	}
	if got := form(map[string]any{"entity_ids": []any{mine.ID}, "name": "先锋"}); got != model.CodeOK {
		t.Fatalf("regroup after dissolve: %s", got)
	}
}

func TestSquadOrderValidation(t *testing.T) {
	ws := newRTTWorld(true)
	u := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 3})
	squad := formTestSquad(t, ws, u)
	ok := model.Position{X: 8, Y: 8}
	off := model.Position{X: 99, Y: 99}
	if r := squadOrder(ws, squad.ID, "charge", &ok); r.Code != model.CodeValidationFailed {
		t.Fatalf("unknown order: %+v", r)
	}
	if r := squadOrder(ws, "nope", "attack", &ok); r.Code != model.CodeEntityNotFound {
		t.Fatalf("unknown squad: %+v", r)
	}
	if r := squadOrder(ws, squad.ID, "attack", nil); r.Code != model.CodeInvalidTarget {
		t.Fatalf("missing target: %+v", r)
	}
	if r := squadOrder(ws, squad.ID, "attack", &off); r.Code != model.CodeInvalidTarget {
		t.Fatalf("off-map target: %+v", r)
	}
	res, _ := (&GameCore{}).execSquadOrder(ws, "p2", model.Command{Target: model.CommandTarget{Position: &ok}, Payload: map[string]any{"squad_id": squad.ID, "order": "attack"}})
	if res.Code != model.CodeNotOwner {
		t.Fatalf("foreign squad: %+v", res)
	}
	if squad.Order != model.SquadOrderIdle {
		t.Fatal("failed orders must not change the squad")
	}
}

func TestSquadAttackOrderFormsUpByRange(t *testing.T) {
	ws := newRTTWorld(false)
	front := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 8})
	front2 := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 9})
	gun := spawnWorldTestUnit(ws, model.UnitTypeArtillery, "p1", model.Position{X: 2, Y: 10})
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p1", model.Position{X: 2, Y: 11})
	squad := formTestSquad(t, ws, front, front2, gun, truck)
	target := model.Position{X: 12, Y: 9}
	if r := squadOrder(ws, squad.ID, "attack", &target); r.Code != model.CodeOK {
		t.Fatalf("attack order: %+v", r)
	}
	if squad.Order != model.SquadOrderAttack || squad.Target == nil || *squad.Target != target {
		t.Fatalf("squad order not recorded: %+v", squad)
	}
	dist := func(u *model.Unit) int { return ws.SurfaceDistance(*u.OrderPos, target) }
	for _, u := range []*model.Unit{front, front2, gun, truck} {
		if u.Stance != model.UnitStanceAttackMove || u.OrderPos == nil || !u.HasPath() || !u.SquadOrderActive {
			t.Fatalf("%s not ordered: stance=%s", u.Type, u.Stance)
		}
	}
	// 前排（射程短）站得最靠前，炮和补给车留在后面。
	if !(dist(front) < dist(gun) && dist(front) < dist(truck) && dist(front2) < dist(gun)) {
		t.Fatalf("formation depth wrong: front=%d/%d gun=%d truck=%d", dist(front), dist(front2), dist(gun), dist(truck))
	}
	seen := map[model.Position]bool{}
	for _, u := range []*model.Unit{front, front2, gun, truck} {
		if seen[*u.OrderPos] {
			t.Fatalf("two units share slot %+v", *u.OrderPos)
		}
		seen[*u.OrderPos] = true
	}
}

func TestSquadAttackOrderEngagesEnemyAndSupplyTruckFollowsLeader(t *testing.T) {
	ws := newRTTWorld(true)
	lead := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 5})
	wing := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 6})
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p1", model.Position{X: 1, Y: 5})
	lead.Ammo, wing.Ammo = 0, 0
	truck.Cargo = model.ItemInventory{model.ItemAmmoBullet: 100}
	squad := formTestSquad(t, ws, lead, wing, truck)
	foe := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 14, Y: 5})
	foe.HP, foe.MaxHP, foe.Ammo = 60, 60, 0
	target := model.Position{X: 14, Y: 5}
	if r := squadOrder(ws, squad.ID, "attack", &target); r.Code != model.CodeOK {
		t.Fatalf("order: %+v", r)
	}
	stepSquad(ws, 1)
	if truck.Stance != model.UnitStanceFollow || truck.GuardTargetID == "" {
		t.Fatalf("truck must follow a combat member: stance=%s guard=%q", truck.Stance, truck.GuardTargetID)
	}
	if guard := ws.Units[truck.GuardTargetID]; guard == nil || guard.Type != model.UnitTypeSoldier {
		t.Fatal("truck must follow a front-line soldier")
	}
	stepSquad(ws, 900)
	if ws.Units[foe.ID] != nil {
		t.Fatal("squad with an attached supply truck must run down the enemy despite starting empty")
	}
	if truck.Cargo[model.ItemAmmoBullet] >= 100 {
		t.Fatal("truck stock must have been used to resupply the squad")
	}
	if lead.Ammo == 0 && wing.Ammo == 0 && truck.Cargo[model.ItemAmmoBullet] == 100 {
		t.Fatal("no resupply happened")
	}
}

func TestSquadDefendHoldsAndRetreatDisengages(t *testing.T) {
	ws := newRTTWorld(true)
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 5})
	b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 6})
	squad := formTestSquad(t, ws, a, b)
	post := model.Position{X: 8, Y: 5}
	if r := squadOrder(ws, squad.ID, "defend", &post); r.Code != model.CodeOK {
		t.Fatalf("defend: %+v", r)
	}
	stepSquad(ws, 200)
	if a.Stance != model.UnitStanceHold || b.Stance != model.UnitStanceHold {
		t.Fatalf("defenders must hold at their posts: %s %s", a.Stance, b.Stance)
	}
	// 坚守：射程内的敌人被打，射程外的敌人不追。
	far := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 8, Y: 12})
	far.Ammo = 0
	farHP := far.HP
	stepSquad(ws, 100)
	if far.HP != farHP {
		t.Fatal("defenders must not chase out-of-range enemies")
	}
	near := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: a.Position.X + 1, Y: a.Position.Y})
	near.Ammo = 0
	nearHP := near.HP
	stepSquad(ws, 30)
	if near.HP >= nearHP {
		t.Fatal("defenders must fire on enemies in range")
	}

	// 撤退：不索敌不还击，回到指定点。
	home := model.Position{X: 1, Y: 1}
	if r := squadOrder(ws, squad.ID, "retreat", &home); r.Code != model.CodeOK {
		t.Fatalf("retreat: %+v", r)
	}
	if squad.Order != model.SquadOrderRetreat || a.Stance != model.UnitStanceRetreat || b.Stance != model.UnitStanceRetreat {
		t.Fatal("retreat order not applied to members")
	}
	nearHP = near.HP
	stepSquad(ws, 400)
	if near.HP != nearHP {
		t.Fatal("retreating units must not fire")
	}
	if ws.SurfaceDistance(a.Position, home) > 4 || ws.SurfaceDistance(b.Position, home) > 4 {
		t.Fatalf("retreat must reach the fallback point: %+v %+v", a.Position, b.Position)
	}
}

func TestSquadResupplyOrderGoesToNearestSupplyStation(t *testing.T) {
	ws := newRTTWorld(false)
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 12, Y: 12})
	b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 12, Y: 13})
	a.Ammo, b.Ammo = 0, 0
	squad := formTestSquad(t, ws, a, b)
	if r := squadOrder(ws, squad.ID, "resupply", nil); r.Code != model.CodeInvalidTarget {
		t.Fatalf("no station must fail: %+v", r)
	}
	far := addSupplyStation(ws, "far", "p1", model.Position{X: 1, Y: 1}, model.ItemInventory{model.ItemAmmoBullet: 500})
	near := addSupplyStation(ws, "near", "p1", model.Position{X: 6, Y: 12}, model.ItemInventory{model.ItemAmmoBullet: 500})
	_ = far
	if r := squadOrder(ws, squad.ID, "resupply", nil); r.Code != model.CodeOK {
		t.Fatalf("resupply: %+v", r)
	}
	if squad.Target == nil || *squad.Target != near.Position || squad.Order != model.SquadOrderResupply {
		t.Fatalf("must head to the nearest station: %+v", squad.Target)
	}
	if a.Stance != model.UnitStanceRetreat {
		t.Fatalf("resupply run must not detour into fights, stance=%s", a.Stance)
	}
	// 半径 10 的光环：走到站边后补满。
	stepSquad(ws, 300)
	if a.Ammo != a.AmmoCapacity || b.Ammo != b.AmmoCapacity {
		t.Fatalf("units must be refilled: %d/%d %d/%d", a.Ammo, a.AmmoCapacity, b.Ammo, b.AmmoCapacity)
	}
	if a.Stance != model.UnitStanceHold {
		t.Fatalf("units wait at the station, stance=%s", a.Stance)
	}
	// 站被炸后，补给指令失败。
	delete(ws.Buildings, near.ID)
	delete(ws.Buildings, far.ID)
	if r := squadOrder(ws, squad.ID, "resupply", nil); r.Code != model.CodeInvalidTarget {
		t.Fatalf("destroyed stations: %+v", r)
	}
}

func TestSquadShrinksAndDisappearsWhenMembersDie(t *testing.T) {
	ws := newRTTWorld(false)
	a := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 5})
	b := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 6})
	squad := formTestSquad(t, ws, a, b)
	delete(ws.Units, a.ID)
	settleCombatRuntime(ws, 1)
	if len(squad.MemberIDs) != 1 || ws.CombatRuntime.Squads[squad.ID] == nil {
		t.Fatalf("squad must shed dead members: %+v", squad.MemberIDs)
	}
	delete(ws.Units, b.ID)
	settleCombatRuntime(ws, 2)
	if ws.CombatRuntime.Squads[squad.ID] != nil {
		t.Fatal("empty squad must be removed")
	}
}
