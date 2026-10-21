package gamecore

import (
	"encoding/json"
	"strings"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 第 22 轮契约（机甲 SCV 化）的边界用例：
// §1 开局只有出生星球有机甲；§2 dispatch_mecha 的失败码/落点/状态迁移；
// §3 一个发令者绑多台；§4 target.mecha_id 点名与路由；§6 实体 ID 跨行星唯一。

// scvDispatch 发一条 dispatch_mecha（target.planet_id = 目标星球）。
func scvDispatch(planetID, mechaID string) model.Command {
	return model.Command{
		Type:   model.CmdDispatchMecha,
		Target: model.CommandTarget{Layer: "planet", PlanetID: planetID, MechaID: mechaID},
	}
}

// scvTileUnitsContains 报告某世界的 TileUnits 里是否还挂着该单位。
func scvTileUnitsContains(ws *model.WorldState, unitID string) bool {
	for _, ids := range ws.TileUnits {
		for _, id := range ids {
			if id == unitID {
				return true
			}
		}
	}
	return false
}

// §1：出生星球有 1 台已绑机甲；另一颗已加载行星没有基站、没有机甲、没有据点，
// 且 switch_active_planet 被拒（必须先 dispatch_mecha 把机甲投送过去）。
func TestMechaSCV_NonStarterPlanetEmptyAtBoot(t *testing.T) {
	core, planetA, planetB := newF4RawDualPlanetCore(t, "off")
	if starter := core.ActivePlanetID(); starter != "planet-1-2" {
		t.Fatalf("active planet = %s, want planet-1-2", starter)
	}
	for _, pc := range core.cfg.Players {
		player := planetB.Players[pc.PlayerID]
		bound := player.MechasByOperator(pc.PlayerID)
		if len(bound) != 1 {
			t.Fatalf("%s: starter planet must have exactly 1 bound mecha, got %d", pc.PlayerID, len(bound))
		}
		if bound[0].PlanetID != "planet-1-2" {
			t.Fatalf("%s: bound starter mecha must be on planet-1-2, got %s", pc.PlayerID, bound[0].PlanetID)
		}
		if !playerHasFootholdOnWorld(planetB, pc.PlayerID) {
			t.Fatalf("%s: starter planet must have a foothold", pc.PlayerID)
		}
		// 非出生行星：没有据点、没有机甲、没有本方单位/建筑。
		if playerHasFootholdOnWorld(planetA, pc.PlayerID) {
			t.Fatalf("%s: non-starter planet must not have a foothold", pc.PlayerID)
		}
		for _, record := range player.SortedMechas() {
			if record.PlanetID == "planet-1-1" {
				t.Fatalf("%s: non-starter planet must not get a mecha, got %s", pc.PlayerID, record.UnitID)
			}
		}
		for _, unit := range planetA.Units {
			if unit != nil && unit.OwnerID == pc.PlayerID {
				t.Fatalf("%s: non-starter planet must not get a unit, got %s", pc.PlayerID, unit.ID)
			}
		}
		for _, building := range planetA.Buildings {
			if building != nil && building.OwnerID == pc.PlayerID {
				t.Fatalf("%s: non-starter planet must not get a building, got %s", pc.PlayerID, building.ID)
			}
		}
	}
	res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdSwitchActivePlanet,
		Payload: map[string]any{"planet_id": "planet-1-1"},
	})
	if res.Code != model.CodeValidationFailed || !strings.Contains(res.Message, "据点") {
		t.Fatalf("switch to a planet without foothold must be rejected, got %s (%s)", res.Code, res.Message)
	}

	// 投送过去之后：机甲本身就是据点，焦点可以切过去。
	mechaID := planetB.Players["p1"].MechasByOperator("p1")[0].UnitID
	if res := issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-1", mechaID)); res.Code != model.CodeOK {
		t.Fatalf("dispatch to empty planet failed: %s (%s)", res.Code, res.Message)
	}
	if !playerHasFootholdOnWorld(planetA, "p1") {
		t.Fatal("a dispatched mecha must count as a foothold")
	}
	if res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdSwitchActivePlanet,
		Payload: map[string]any{"planet_id": "planet-1-1"},
	}); res.Code != model.CodeOK {
		t.Fatalf("switch after dispatch failed: %s (%s)", res.Code, res.Message)
	}
}

// §2：四种失败（未加载 / 未发现 / 同星球 / 作业中），且都不产生副作用。
func TestMechaSCV_DispatchMechaFailures(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	starter := planetB.Players["p1"].MechasByOperator("p1")
	if len(starter) != 1 {
		t.Fatalf("expected one bound starter mecha, got %d", len(starter))
	}
	mechaID := starter[0].UnitID
	unit := planetB.Units[mechaID]
	if unit == nil {
		t.Fatalf("starter mecha unit %s missing", mechaID)
	}

	// 1) 目标星球未加载 → INVALID_TARGET（路由层拒绝）。
	res := issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-9-9", mechaID))
	if res.Code != model.CodeInvalidTarget || !strings.Contains(res.Message, "未加载") {
		t.Fatalf("unloaded target: %s (%s)", res.Code, res.Message)
	}

	// 2) 目标星球未被发现 → VALIDATION_FAILED。加载的行星开局都被发现，
	//    这里临时换成一个不含 p1 的 discovery 来构造「未发现」。
	savedDiscovery := core.discovery
	core.discovery = mapstate.NewDiscovery(nil, core.maps)
	res = issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-1", mechaID))
	core.discovery = savedDiscovery
	if res.Code != model.CodeValidationFailed || !strings.Contains(res.Message, "未被发现") {
		t.Fatalf("undiscovered target: %s (%s)", res.Code, res.Message)
	}

	// 3) 目标星球 == 机甲当前星球 → VALIDATION_FAILED。
	res = issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-2", mechaID))
	if res.Code != model.CodeValidationFailed || !strings.Contains(res.Message, "已在") {
		t.Fatalf("same-planet dispatch: %s (%s)", res.Code, res.Message)
	}

	// 4) 机甲在作业中 → VALIDATION_FAILED。先给机甲挂一个手搓作业。
	unit.Mecha = model.NewMechaState()
	unit.Mecha.Job = &model.MechaJob{Kind: "craft", RecipeID: "gear", RemainingBatches: 3, State: "running"}
	res = issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-1", mechaID))
	if res.Code != model.CodeValidationFailed || !strings.Contains(res.Message, "正在作业") {
		t.Fatalf("busy mecha dispatch: %s (%s)", res.Code, res.Message)
	}
	unit.Mecha.Job = nil

	// 四类失败都没有副作用：机甲还在源星球、档案没变。
	if planetB.Units[mechaID] == nil {
		t.Fatal("failed dispatch must not remove the mecha from its source world")
	}
	if planetA.Units[mechaID] != nil {
		t.Fatal("failed dispatch must not add the mecha to the target world")
	}
	if record := planetB.Players["p1"].MechaByUnitID(mechaID); record == nil || record.PlanetID != "planet-1-2" {
		t.Fatalf("failed dispatch changed the dossier: %+v", record)
	}
}

// §2：投送成功——源世界摘除、目标世界重建（同 ID）、档案改星球、背包保留、事件正确。
func TestMechaSCV_DispatchMechaMovesUnit(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	record := planetB.Players["p1"].MechasByOperator("p1")[0]
	mechaID := record.UnitID
	record.EnsureInventory()[model.ItemIronIngot] = 42
	record.EnsureInventory()[model.ItemGear] = 7
	unit := planetB.Units[mechaID]
	if unit == nil {
		t.Fatalf("starter mecha unit %s missing", mechaID)
	}
	focusBefore := planetB.Players["p1"].FocusPlanetID

	res := issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-1", ""))
	if res.Code != model.CodeOK {
		t.Fatalf("dispatch failed: %s (%s)", res.Code, res.Message)
	}
	if want := "机甲 " + mechaID + " 已投送到 planet-1-1"; res.Message != want {
		t.Fatalf("receipt = %q, want %q", res.Message, want)
	}

	// 源世界：Units / TileUnits 里都没有它了。
	if planetB.Units[mechaID] != nil {
		t.Fatal("dispatched unit must be removed from the source world")
	}
	if scvTileUnitsContains(planetB, mechaID) {
		t.Fatal("dispatched unit must be removed from the source TileUnits")
	}
	// 目标世界：有它，且挂在自己的格子上。
	moved := planetA.Units[mechaID]
	if moved == nil {
		t.Fatal("dispatched unit must appear in the target world")
	}
	if moved.OwnerID != "p1" || moved.Type != model.UnitTypeExecutor {
		t.Fatalf("dispatched unit identity wrong: %+v", moved)
	}
	if !scvTileUnitsContains(planetA, mechaID) {
		t.Fatal("dispatched unit must be registered in the target TileUnits")
	}
	if moved.Mecha == nil || moved.Mecha.Job != nil {
		t.Fatalf("dispatched unit must start idle with a mecha state, got %+v", moved.Mecha)
	}
	if moved.HP != moved.MaxHP {
		t.Fatalf("dispatched unit must be at full HP, got %d/%d", moved.HP, moved.MaxHP)
	}
	// 档案：星球改了、背包还在、unit ID 不变。
	after := planetA.Players["p1"].MechaByUnitID(mechaID)
	if after == nil || after.PlanetID != "planet-1-1" {
		t.Fatalf("dossier planet not updated: %+v", after)
	}
	if after.Inventory[model.ItemIronIngot] != 42 || after.Inventory[model.ItemGear] != 7 {
		t.Fatalf("dossier inventory must follow the mecha, got %+v", after.Inventory)
	}
	// 焦点不变。
	if got := planetA.Players["p1"].FocusPlanetID; got != focusBefore {
		t.Fatalf("dispatch must not change focus, got %q want %q", got, focusBefore)
	}
}

// §2：事件 payload 是 entity_updated + {entity_type, mecha_id, planet_id, from_planet_id}。
func TestMechaSCV_DispatchMechaEvent(t *testing.T) {
	core, _, planetB := newF4DualPlanetCore(t, "off")
	mechaID := planetB.Players["p1"].MechasByOperator("p1")[0].UnitID
	results, events := core.executeRequest(&model.QueuedRequest{
		PlayerID: "p1",
		Request: model.CommandRequest{
			RequestID: "req-dispatch",
			IssuerID:  "p1",
			Commands:  []model.Command{scvDispatch("planet-1-1", mechaID)},
		},
	})
	if len(results) != 1 || results[0].Code != model.CodeOK {
		t.Fatalf("dispatch failed: %+v", results)
	}
	var found *model.GameEvent
	for _, evt := range events {
		if evt.EventType == model.EvtEntityUpdated {
			if payload, ok := evt.Payload["mecha_id"]; ok && payload == mechaID {
				found = evt
			}
		}
	}
	if found == nil {
		t.Fatalf("expected entity_updated event for %s, got %+v", mechaID, events)
	}
	if found.VisibilityScope != "p1" {
		t.Fatalf("event visibility = %q, want p1", found.VisibilityScope)
	}
	if found.Payload["entity_type"] != "mecha" || found.Payload["planet_id"] != "planet-1-1" || found.Payload["from_planet_id"] != "planet-1-2" {
		t.Fatalf("event payload wrong: %+v", found.Payload)
	}
}

// §2：多台机甲时缺省不点名 → VALIDATION_FAILED（要求点名）。
func TestMechaSCV_DispatchMechaRequiresMechaIDWhenAmbiguous(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	starter := planetB.Players["p1"].MechasByOperator("p1")[0]
	other := mechaOnPlanet(planetA, "p1", "planet-1-1") // 夹具补的空闲机甲
	if other == nil {
		t.Fatal("fixture must seed an idle mecha on planet-1-1")
	}
	other.Operator = "p1"
	res := issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-1", ""))
	if res.Code != model.CodeValidationFailed || !strings.Contains(res.Message, "需要 target.mecha_id 点名") {
		t.Fatalf("ambiguous dispatch: %s (%s)", res.Code, res.Message)
	}
	// 点名后成功。
	res = issueInternalCommandAs(core, "p1", "p1", scvDispatch("planet-1-1", starter.UnitID))
	if res.Code != model.CodeOK {
		t.Fatalf("named dispatch failed: %s (%s)", res.Code, res.Message)
	}
}

// §3/§4：一个 issuer 绑两台（各在一颗行星），各自 build 落在自己星球；
// target.mecha_id 点名另一颗行星的机甲时不写 planet_id 也路由到那颗行星。
func TestMechaSCV_TwoMechasPerIssuerAndMechaIDRouting(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	const issuer = "p1-agent"
	// 出生星球的机甲绑给 issuer，planet-1-1 夹具机甲也绑给同一个 issuer。
	starter := planetB.Players["p1"].MechasByOperator("p1")[0]
	starter.Operator = issuer
	idle := mechaOnPlanet(planetA, "p1", "planet-1-1")
	idle.Operator = issuer
	grantAllItemsToMecha(starter, 100)
	grantAllItemsToMecha(idle, 100)
	if bound := planetA.Players["p1"].MechasByOperator(issuer); len(bound) != 2 {
		t.Fatalf("one issuer must bind two mechas, got %d", len(bound))
	}

	// 点名 planet-1-1 的机甲、不写 planet_id → build 落在 planet-1-1。
	siteA := f4OpenTileNear(t, planetA, f4BasePos(t, planetA, "p1"))
	res := issueInternalCommandAs(core, "p1", issuer, model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &siteA, MechaID: idle.UnitID},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("build by named mecha on planet-1-1: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetA, "p1"); got != 1 {
		t.Fatalf("task should land on planet-1-1, got %d", got)
	}
	if got := f4ConstructionTaskCount(planetB, "p1"); got != 0 {
		t.Fatalf("task leaked to planet-1-2: %d", got)
	}

	// 点名出生星球的机甲 → build 落在 planet-1-2。
	siteB := f4OpenTileNear(t, planetB, f4BasePos(t, planetB, "p1"))
	res = issueInternalCommandAs(core, "p1", issuer, model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &siteB, MechaID: starter.UnitID},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("build by named mecha on planet-1-2: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetB, "p1"); got != 1 {
		t.Fatalf("task should land on planet-1-2, got %d", got)
	}
	// 两台机甲各自的施工额度独立：任务 MechaID 分别是各自那台。
	seen := map[string]bool{}
	for _, task := range planetA.Construction.Tasks {
		if task != nil && task.PlayerID == "p1" {
			seen[task.MechaID] = true
		}
	}
	for _, task := range planetB.Construction.Tasks {
		if task != nil && task.PlayerID == "p1" {
			seen[task.MechaID] = true
		}
	}
	if !seen[idle.UnitID] || !seen[starter.UnitID] || len(seen) != 2 {
		t.Fatalf("each build must be owned by its named mecha, got %+v", seen)
	}
}

// §4：点名别人绑定的机甲 → NOT_OPERATOR；点名不存在的 → ENTITY_NOT_FOUND；
// issuer 有绑定但都在别的星球 → 新的 EXECUTOR_UNAVAILABLE 文案。
func TestMechaSCV_MechaIDResolutionErrors(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	starter := planetB.Players["p1"].MechasByOperator("p1")[0]
	idle := mechaOnPlanet(planetA, "p1", "planet-1-1")
	idle.Operator = "p2-other"
	grantAllItemsToMecha(starter, 100)
	grantAllItemsToMecha(idle, 100)

	buildAt := func(mechaID string, pos model.Position) model.CommandResult {
		return issueInternalCommandAs(core, "p1", "p1", model.Command{
			Type:    model.CmdBuild,
			Target:  model.CommandTarget{Position: &pos, MechaID: mechaID},
			Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
		})
	}

	// 点名别人绑定的机甲（在 planet-1-1）→ 路由到那颗星球后 NOT_OPERATOR。
	siteA := f4OpenTileNear(t, planetA, f4BasePos(t, planetA, "p1"))
	if res := buildAt(idle.UnitID, siteA); res.Code != model.CodeNotOperator {
		t.Fatalf("foreign-operated mecha: %s (%s)", res.Code, res.Message)
	}
	// 不存在的机甲 → ENTITY_NOT_FOUND。
	if res := buildAt("u-missing", siteA); res.Code != model.CodeEntityNotFound {
		t.Fatalf("missing mecha: %s (%s)", res.Code, res.Message)
	}
	// 有绑定但都在别的星球：p1 只绑了 planet-1-2 的机甲，显式在 planet-1-1 build。
	siteB := f4OpenTileNear(t, planetB, f4BasePos(t, planetB, "p1"))
	res := issueInternalCommandAs(core, "p1", "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &siteB, PlanetID: "planet-1-1"},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeExecutorUnavailable || !strings.Contains(res.Message, "你的机甲都在别的星球") {
		t.Fatalf("all mechas elsewhere: %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, starter.UnitID) {
		t.Fatalf("message must list the bound mecha IDs, got %q", res.Message)
	}
	// 同一台机甲重复绑同一 operator = 幂等成功（§3）。
	if res := issueInternalCommandAs(core, "p1", "p1", model.Command{
		Type:    model.CmdAssignMecha,
		Target:  model.CommandTarget{EntityID: starter.UnitID},
		Payload: map[string]any{"operator": "p1"},
	}); res.Code != model.CodeOK {
		t.Fatalf("idempotent assign: %s (%s)", res.Code, res.Message)
	}
}

// §6：多行星局跑一段时间后所有行星的 Units+Buildings ID 全局唯一；存档往返后
// 继续造实体也不撞号。
func TestMechaSCV_EntityIDsUniqueAcrossPlanets(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	// 跑一段时间让结算造出实体（单位/建筑/施工任务）。
	for i := 0; i < 20; i++ {
		core.processTick()
	}
	assertGloballyUniqueEntityIDs(t, core)

	// 存档 → 读档 → 继续造实体。
	save, err := core.ExportSaveFile("test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	raw, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal save: %v", err)
	}
	var decoded gamedir.SaveFile
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal save: %v", err)
	}
	loaded, err := NewFromSave(core.cfg, core.maps, queue.New(), NewEventBus(), nil, &decoded)
	if err != nil {
		t.Fatalf("restore save: %v", err)
	}
	loadedA := loaded.WorldForPlanet("planet-1-1")
	loadedB := loaded.WorldForPlanet("planet-1-2")
	if loadedA == nil || loadedB == nil {
		t.Fatal("restored core must keep both planet runtimes")
	}
	// 读档后分配器必须不低于任何一颗行星已用到的编号。
	restoredCounter := loadedA.EntityCounter()
	if got := loadedB.EntityCounter(); got != restoredCounter {
		t.Fatalf("restored worlds must share one counter, got %d vs %d", restoredCounter, got)
	}
	for _, ws := range []*model.WorldState{loadedA, loadedB} {
		for id := range ws.Units {
			if n := entityIDNumber(id); n > restoredCounter {
				t.Fatalf("restored counter %d is below existing id %s", restoredCounter, id)
			}
		}
		for id := range ws.Buildings {
			if n := entityIDNumber(id); n > restoredCounter {
				t.Fatalf("restored counter %d is below existing id %s", restoredCounter, id)
			}
		}
	}
	// 读档后在两颗行星上各造一台单位：ID 必须互不相同，且不撞任何已有 ID。
	newA := spawnWorldTestUnit(loadedA, model.UnitTypeWorker, "p1", f4OpenTileNear(t, loadedA, f4BasePos(t, loadedA, "p1")))
	newB := spawnWorldTestUnit(loadedB, model.UnitTypeWorker, "p1", f4OpenTileNear(t, loadedB, f4BasePos(t, loadedB, "p1")))
	if newA.ID == newB.ID {
		t.Fatalf("units created after restore collided: %s", newA.ID)
	}
	assertGloballyUniqueEntityIDs(t, loaded)
	_ = planetA
	_ = planetB
}

// entityIDNumber 取 `prefix-N` 形态 ID 的 N（不是该形态时返回 0）。
func entityIDNumber(id string) int64 {
	idx := strings.LastIndex(id, "-")
	if idx < 0 {
		return 0
	}
	var n int64
	for _, c := range id[idx+1:] {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int64(c-'0')
	}
	return n
}

// assertGloballyUniqueEntityIDs 断言所有已加载行星的 Units+Buildings ID 全局唯一，
// 且仍是 prefix-N 形态。
func assertGloballyUniqueEntityIDs(t *testing.T, core *GameCore) {
	t.Helper()
	seen := make(map[string]string)
	for _, ws := range core.sortedWorlds() {
		check := func(id, kind string) {
			if id == "" {
				return
			}
			if !strings.Contains(id, "-") {
				t.Fatalf("%s id %q must keep the prefix-N format", kind, id)
			}
			if other, dup := seen[id]; dup {
				t.Fatalf("entity id %q used on both %s and %s", id, other, ws.PlanetID)
			}
			seen[id] = ws.PlanetID
		}
		for id := range ws.Units {
			check(id, "unit")
		}
		for id := range ws.Buildings {
			check(id, "building")
		}
	}
}
