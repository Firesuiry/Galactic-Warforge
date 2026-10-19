package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/queue"
	"siliconworld/internal/terrain"
	"siliconworld/internal/visibility"
)

// 第 21 轮多机甲协作契约 §8 的边界用例（1–15、20）。
// 16–19 在 gateway/mecha_issuer_test.go；14 的战利品路由在 dark_fog_loot_test.go
// / w3_residuals_test.go 已有覆盖，这里只补「所有机甲背包之和」的契约统计。

// newMechaCoopCore 构建一张全 buildable 的单行星对局（黑雾关闭，避免波次干扰）。
func newMechaCoopCore(t *testing.T) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:                           "mecha-coop-test",
			MaxTickRate:                       10,
			EnemyDifficulty:                   "off",
			ConstructionRegionConcurrentLimit: 8,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 32, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core := New(cfg, maps, queue.New(), NewEventBus(), nil)
	ws := core.World()
	for y := range ws.Grid {
		for x := range ws.Grid[y] {
			ws.Grid[y][x].Terrain = terrain.TileBuildable
		}
	}
	return core
}

// coopSpawnMecha 在指定位置登记一台机甲单位与档案，并把它绑给 operator。
func coopSpawnMecha(ws *model.WorldState, playerID, unitID string, pos model.Position, operator string) (*model.Unit, *model.MechaRecord) {
	stats := model.UnitStats(model.UnitTypeExecutor)
	unit := &stats
	unit.ID, unit.OwnerID, unit.Position = unitID, playerID, pos
	ws.Units[unitID] = unit
	ws.TileUnits[model.TileKey(pos.X, pos.Y)] = append(ws.TileUnits[model.TileKey(pos.X, pos.Y)], unitID)
	record := registerMecha(ws, playerID, unit)
	record.Operator = operator
	return unit, record
}

// coopDisableBuildRadius 让开建造中心（HP=0 会被 requireBuildRange 跳过），
// 使 auto_approach 退回机甲 operate_range 判定。
func coopDisableBuildRadius(ws *model.WorldState) {
	for _, b := range ws.Buildings {
		if b == nil {
			continue
		}
		if def, ok := model.BuildingDefinitionByID(b.Type); ok && def.BuildRadius > 0 {
			b.HP = 0
		}
	}
}

// coopBuildSite 找一处整块可落位、距 from 至少 minDist 格的建造点。
func coopBuildSite(t *testing.T, ws *model.WorldState, from model.Position, minDist int, btype model.BuildingType) model.Position {
	t.Helper()
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		t.Fatalf("unknown building type %s", btype)
	}
	for _, p := range ws.SurfaceDisc(from, minDist+16) {
		if ws.SurfaceDistance(from, p) < minDist {
			continue
		}
		if !ws.InBounds(p.X, p.Y) || ws.Grid[p.Y][p.X].ResourceNodeID != "" {
			continue
		}
		if !ws.FootprintFits(p, def.Footprint, btype, "") {
			continue
		}
		if occupiedByGroundUnit(ws, p.X, p.Y) || constructionTileTaken(ws, p, def.Footprint) {
			continue
		}
		return p
	}
	t.Fatalf("no build site near %+v at least %d away", from, minDist)
	return model.Position{}
}

// coopBuildCommand 生成一条 build 命令。
func coopBuildCommand(pos model.Position, btype model.BuildingType, autoApproach bool) model.Command {
	return model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Layer: "planet", Position: &pos},
		Payload: map[string]any{
			"building_type": string(btype),
			"auto_approach": autoApproach,
		},
	}
}

func coopTaskOf(ws *model.WorldState, mechaID string) []*model.ConstructionTask {
	var out []*model.ConstructionTask
	if ws.Construction == nil {
		return out
	}
	for _, task := range sortedConstructionTasks(ws) {
		if task != nil && task.MechaID == mechaID {
			out = append(out, task)
		}
	}
	return out
}

// 契约 §8-1：两个发令者各绑一台机甲，在同一星球相距很远的两处同时 build
// （auto_approach）：各自朝自己的工地走、互不打断；每台施工中 ≤ 2；
// 扣料各扣各的背包。
func TestMechaCoop_01_TwoIssuersBuildFarApart(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	coopDisableBuildRadius(ws)

	starterUnit := findExecutorUnit(t, ws) // p1 开局机甲，operator = p1
	// 挪到地图左半边，给 B 机甲留出足够远的工地。
	removeUnitFromTile(ws, model.TileKey(starterUnit.Position.X, starterUnit.Position.Y), starterUnit.ID)
	starterUnit.Position = model.Position{X: 12, Y: 10}
	ws.TileUnits[model.TileKey(12, 10)] = append(ws.TileUnits[model.TileKey(12, 10)], starterUnit.ID)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1-a"

	posB := model.Position{X: ws.MapWidth - 12, Y: ws.MapHeight - 10}
	unitB, recordB := coopSpawnMecha(ws, "p1", "u-coop-b", posB, "p1-b")

	grantAllItemsToMecha(recordA, 100)
	grantAllItemsToMecha(recordB, 100)

	var sitesA, sitesB []model.Position
	for i := 0; i < 3; i++ {
		site := coopBuildSite(t, ws, starterUnit.Position, 24, model.BuildingTypeWindTurbine)
		if res := issueInternalCommandAs(core, "p1", "p1-a", coopBuildCommand(site, model.BuildingTypeWindTurbine, true)); res.Code != model.CodeOK {
			t.Fatalf("p1-a build at %+v failed: %s (%s)", site, res.Code, res.Message)
		}
		sitesA = append(sitesA, site)
	}
	for i := 0; i < 2; i++ {
		site := coopBuildSite(t, ws, unitB.Position, 24, model.BuildingTypeWindTurbine)
		if res := issueInternalCommandAs(core, "p1", "p1-b", coopBuildCommand(site, model.BuildingTypeWindTurbine, true)); res.Code != model.CodeOK {
			t.Fatalf("p1-b build at %+v failed: %s (%s)", site, res.Code, res.Message)
		}
		sitesB = append(sitesB, site)
	}
	siteA1, siteB1 := sitesA[0], sitesB[0]
	if ws.SurfaceDistance(siteA1, siteB1) <= 2*model.ExecutorOperateRange() {
		t.Fatalf("sites must be far apart, got A=%+v B=%+v", siteA1, siteB1)
	}
	if got := len(coopTaskOf(ws, starterUnit.ID)); got != 3 {
		t.Fatalf("expected 3 tasks owned by mecha A, got %d", got)
	}
	if got := len(coopTaskOf(ws, unitB.ID)); got != 2 {
		t.Fatalf("expected 2 tasks owned by mecha B, got %d", got)
	}

	// 推进若干 tick：两台机甲各自朝自己的工地走，互不打断。
	seenA, seenB := false, false
	seenExecutorLimit := false
	for tick := 0; tick < 600; tick++ {
		core.processTick()
		if starterUnit.HasPath() && starterUnit.PathIntent == model.PathIntentTask {
			seenA = true
			pathTargetA := starterUnit.Path[len(starterUnit.Path)-1]
			if d := ws.SurfaceDistance(pathTargetA, siteA1); d > model.ExecutorOperateRange() {
				t.Fatalf("mecha A path must head to its own site, end=%+v dist=%d", pathTargetA, d)
			}
			if d := ws.SurfaceDistance(pathTargetA, siteB1); d <= model.ExecutorOperateRange() {
				t.Fatalf("mecha A path was hijacked to B's site: end=%+v", pathTargetA)
			}
		}
		if unitB.HasPath() && unitB.PathIntent == model.PathIntentTask {
			seenB = true
			pathTargetB := unitB.Path[len(unitB.Path)-1]
			if d := ws.SurfaceDistance(pathTargetB, siteB1); d > model.ExecutorOperateRange() {
				t.Fatalf("mecha B path must head to its own site, end=%+v dist=%d", pathTargetB, d)
			}
			if d := ws.SurfaceDistance(pathTargetB, siteA1); d <= model.ExecutorOperateRange() {
				t.Fatalf("mecha B path was hijacked to A's site: end=%+v", pathTargetB)
			}
		}
		active := map[string]int{}
		for _, task := range ws.Construction.Tasks {
			if task == nil || task.State != model.ConstructionInProgress {
				continue
			}
			active[task.MechaID]++
		}
		if active[starterUnit.ID] > 2 || active[unitB.ID] > 2 {
			t.Fatalf("per-mecha concurrent construction exceeded 2: %+v", active)
		}
		for _, task := range coopTaskOf(ws, starterUnit.ID) {
			if task.WaitReason == "executor_concurrent_limit" {
				seenExecutorLimit = true
			}
		}
		if len(ws.Construction.Tasks) == 0 {
			break
		}
	}
	if !seenA || !seenB {
		t.Fatalf("both mechas should walk their own auto_approach paths: A=%v B=%v", seenA, seenB)
	}
	if !seenExecutorLimit {
		t.Fatal("3rd task of mecha A should wait with executor_concurrent_limit")
	}
	if len(ws.Construction.Tasks) != 0 {
		t.Fatalf("expected all tasks done, remaining %+v", ws.Construction.Tasks)
	}
	built := 0
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeWindTurbine {
			built++
		}
	}
	if built != 5 {
		t.Fatalf("expected 5 wind turbines built, got %d", built)
	}

	// 扣料各扣各的背包：A 造 3 座、B 造 2 座（风力涡轮机：gear1/iron6/coil3）。
	cost := model.BuildCost{Items: []model.ItemAmount{
		{ItemID: model.ItemGear, Quantity: 1},
		{ItemID: model.ItemIronIngot, Quantity: 6},
		{ItemID: model.ItemMagneticCoil, Quantity: 3},
	}}
	for _, tc := range []struct {
		name   string
		record *model.MechaRecord
		built  int
	}{
		{"A", recordA, 3},
		{"B", recordB, 2},
	} {
		for _, item := range cost.Items {
			want := 100 - item.Quantity*tc.built
			if got := tc.record.Inventory[item.ItemID]; got != want {
				t.Fatalf("mecha %s %s: got %d, want %d (inventory %+v)", tc.name, item.ItemID, got, want, tc.record.Inventory)
			}
		}
	}
}

// 契约 §8-2：未绑定机甲的发令者 build / transfer_item / craft_item →
// EXECUTOR_UNAVAILABLE，世界状态不变。
func TestMechaCoop_02_UnboundIssuerRejectedWithoutStateChange(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	starter := starterMecha(ws, "p1")
	starter.Inventory = model.ItemInventory{model.ItemIronIngot: 10}

	base := botPlayerHQ(t, ws, "p1")
	site := coopBuildSite(t, ws, base.Position, 4, model.BuildingTypeWindTurbine)
	storageBefore := base.Storage.ItemQuantity(model.ItemIronIngot)
	queueBefore := len(ws.Construction.Tasks)

	buildRes, _ := execCommandAs(core, model.CmdBuild, ws, "p1", "p1-ghost", coopBuildCommand(site, model.BuildingTypeWindTurbine, false))
	if buildRes.Code != model.CodeExecutorUnavailable || !strings.Contains(buildRes.Message, "还没有绑定机甲") {
		t.Fatalf("unbound build: %s (%s)", buildRes.Code, buildRes.Message)
	}
	transferRes, _ := execCommandAs(core, model.CmdTransferItem, ws, "p1", "p1-ghost", model.Command{
		Payload: map[string]any{"building_id": base.ID, "item_id": model.ItemIronIngot, "quantity": 5},
	})
	if transferRes.Code != model.CodeExecutorUnavailable {
		t.Fatalf("unbound transfer: %s (%s)", transferRes.Code, transferRes.Message)
	}
	craftRes, _ := execCommandAs(core, model.CmdCraftItem, ws, "p1", "p1-ghost", model.Command{
		Payload: map[string]any{"recipe_id": "gear", "quantity": 1},
	})
	if craftRes.Code != model.CodeExecutorUnavailable {
		t.Fatalf("unbound craft: %s (%s)", craftRes.Code, craftRes.Message)
	}

	if got := len(ws.Construction.Tasks); got != queueBefore {
		t.Fatalf("unbound commands must not enqueue tasks, got %d want %d", got, queueBefore)
	}
	if got := base.Storage.ItemQuantity(model.ItemIronIngot); got != storageBefore {
		t.Fatalf("unbound transfer changed building storage: %d want %d", got, storageBefore)
	}
	if got := starter.Inventory[model.ItemIronIngot]; got != 10 {
		t.Fatalf("unbound craft consumed inventory: %+v", starter.Inventory)
	}
	for _, unit := range ws.Units {
		if unit != nil && unit.Mecha != nil && unit.Mecha.Job != nil {
			t.Fatalf("unbound craft started a job on %s", unit.ID)
		}
	}
}

// 契约 §8-3：显式 planet_id 指向自己机甲不在的星球 → EXECUTOR_UNAVAILABLE。
func TestMechaCoop_03_ExplicitPlanetWithoutMechaRejected(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	recordA := mechaOnPlanet(planetA, "p1", planetA.PlanetID)
	recordB := mechaOnPlanet(planetB, "p1", planetB.PlanetID)
	if recordA == nil || recordB == nil {
		t.Fatal("fixture must seed a mecha on both planets")
	}
	recordA.Operator = "p1"
	recordB.Operator = "p1-b"
	grantAllItems(planetA, "p1", 100)

	site := f4OpenTileNear(t, planetB, f4BasePos(t, planetB, "p1"))
	res := issueInternalCommandAs(core, "p1", "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &site, PlanetID: "planet-1-2"},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeExecutorUnavailable || !strings.Contains(res.Message, "不在本星球") {
		t.Fatalf("explicit foreign-planet build: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetA, "p1"); got != 0 {
		t.Fatalf("failed command leaked task to planet-1-1: %d", got)
	}
	if got := f4ConstructionTaskCount(planetB, "p1"); got != 0 {
		t.Fatalf("failed command leaked task to planet-1-2: %d", got)
	}
}

// 契约 §8-4：不带 planet_id 的 build 落在发令者机甲所在星球，即使玩家焦点是别处。
func TestMechaCoop_04_BuildFollowsIssuerMechaNotFocus(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	recordA := mechaOnPlanet(planetA, "p1", planetA.PlanetID)
	recordB := mechaOnPlanet(planetB, "p1", planetB.PlanetID)
	recordA.Operator = "p1"
	recordB.Operator = "p1-b"
	grantAllItems(planetA, "p1", 100)
	if got := planetA.Players["p1"].FocusPlanetID; got != "planet-1-2" {
		t.Fatalf("fixture focus should be planet-1-2, got %q", got)
	}

	site := f4OpenTileNear(t, planetA, f4BasePos(t, planetA, "p1"))
	res := issueInternalCommandAs(core, "p1", "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &site},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("build without planet_id failed: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetA, "p1"); got != 1 {
		t.Fatalf("expected task on issuer mecha's planet-1-1, got %d", got)
	}
	if got := f4ConstructionTaskCount(planetB, "p1"); got != 0 {
		t.Fatalf("task leaked to focus planet-1-2: %d", got)
	}
	if got := planetA.Players["p1"].FocusPlanetID; got != "planet-1-2" {
		t.Fatalf("focus must stay planet-1-2, got %q", got)
	}
	if got := core.ActivePlanetID(); got != "planet-1-2" {
		t.Fatalf("global active planet must not move, got %q", got)
	}
}

// 契约 §8-5：assign_mecha 的四种情况（抢占自动解绑 / 解绑 / 别人的机甲 / 非法 operator）。
func TestMechaCoop_05_AssignMechaCases(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	starter := starterMecha(ws, "p1")
	starter.Operator = "p1"
	unitB, recordB := coopSpawnMecha(ws, "p1", "u-assign-b", model.Position{X: 20, Y: 20}, "p1-b")

	assign := func(mechaID, operator string) (model.CommandResult, []*model.GameEvent) {
		return execCommandAs(core, model.CmdAssignMecha, ws, "p1", "p1", model.Command{
			Target:  model.CommandTarget{EntityID: mechaID},
			Payload: map[string]any{"operator": operator},
		})
	}

	// 把 B 绑给已绑 A 的发令者：A 自动变空闲，事件写明 released_mecha_id。
	res, events := assign(unitB.ID, "p1")
	if res.Code != model.CodeOK || recordB.Operator != "p1" {
		t.Fatalf("bind B to p1: %s (%s) record=%+v", res.Code, res.Message, recordB)
	}
	if starter.Operator != "" {
		t.Fatalf("previous mecha A must become idle, got operator %q", starter.Operator)
	}
	released := 0
	for _, evt := range events {
		if evt.EventType != model.EvtEntityUpdated {
			continue
		}
		released++
		if evt.Payload["released_mecha_id"] != starter.UnitID || evt.Payload["mecha_id"] != unitB.ID {
			t.Fatalf("single event must carry mecha_id=%s released_mecha_id=%s, got %+v", unitB.ID, starter.UnitID, evt.Payload)
		}
	}
	if released != 1 {
		t.Fatalf("assign_mecha must emit exactly one entity_updated, got %d: %+v", released, events)
	}

	// operator: "" 解绑。
	res, _ = assign(unitB.ID, "")
	if res.Code != model.CodeOK || recordB.Operator != "" {
		t.Fatalf("unbind B: %s (%s) operator=%q", res.Code, res.Message, recordB.Operator)
	}

	// 别人的机甲 → NOT_OWNER。
	p2Unit, p2Record := coopSpawnMecha(ws, "p2", "u-p2-mecha", model.Position{X: 30, Y: 30}, "p2")
	if res, _ := assign(p2Unit.ID, "p1"); res.Code != model.CodeNotOwner {
		t.Fatalf("assign foreign mecha: %s (%s)", res.Code, res.Message)
	}
	if p2Record.Operator != "p2" {
		t.Fatalf("foreign mecha must not change, got %q", p2Record.Operator)
	}

	// 非法 operator → VALIDATION_FAILED，绑定不变。
	if res, _ := assign(unitB.ID, "bad operator!"); res.Code != model.CodeValidationFailed {
		t.Fatalf("invalid operator: %s (%s)", res.Code, res.Message)
	}
	if recordB.Operator != "" {
		t.Fatalf("invalid operator changed binding: %q", recordB.Operator)
	}

	// 不存在的机甲 → ENTITY_NOT_FOUND。
	if res, _ := assign("u-missing", "p1"); res.Code != model.CodeEntityNotFound {
		t.Fatalf("missing mecha: %s (%s)", res.Code, res.Message)
	}
}

// 契约 §8-6：move 混合选中「自己的机甲 + 别人绑定的机甲 + 空闲机甲 + 士兵」：
// 只有别人那台 NOT_OPERATOR，其余照常移动。
func TestMechaCoop_06_MoveSkipsOnlyForeignOperatedMecha(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	mechaA := findExecutorUnit(t, ws)
	starterMecha(ws, "p1").Operator = "p1"
	mechaB, _ := coopSpawnMecha(ws, "p1", "u-move-b", ws.SurfaceOffset(mechaA.Position, 5, 0), "p1-agent")
	mechaC, _ := coopSpawnMecha(ws, "p1", "u-move-c", ws.SurfaceOffset(mechaA.Position, 0, 5), "")
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", ws.SurfaceOffset(mechaA.Position, 5, 5))

	var dest model.Position
	found := false
	for _, p := range ws.SurfaceDisc(mechaA.Position, 10) {
		ok := true
		for _, unit := range []*model.Unit{mechaA, mechaB, mechaC, soldier} {
			if !tileWalkableForUnit(ws, p, unit.ID) {
				ok = false
				break
			}
			if path, reachable := computeUnitPath(ws, unit.Position, p, unit.ID); !reachable || len(path) < 2 {
				ok = false
				break
			}
		}
		if ok {
			dest, found = p, true
			break
		}
	}
	if !found {
		t.Fatal("no shared walkable destination")
	}
	beforeB := mechaB.Position

	res, _ := execCommandAs(core, model.CmdMove, ws, "p1", "p1", model.Command{
		Target: model.CommandTarget{EntityIDs: []string{mechaA.ID, mechaB.ID, mechaC.ID, soldier.ID}, Position: &dest},
	})
	if res.Code != model.CodeNotOperator || res.Status != model.StatusExecuted {
		t.Fatalf("mixed move: %s/%s (%s)", res.Status, res.Code, res.Message)
	}
	if !mechaA.HasPath() || !mechaC.HasPath() || !soldier.HasPath() {
		t.Fatalf("own/idle/soldier must move: A=%v C=%v S=%v", mechaA.HasPath(), mechaC.HasPath(), soldier.HasPath())
	}
	if mechaB.HasPath() || mechaB.Position != beforeB {
		t.Fatalf("foreign-operated mecha must be skipped: path=%v pos=%+v", mechaB.Path, mechaB.Position)
	}
	for _, unit := range []*model.Unit{mechaA, mechaC, soldier} {
		if got := unit.Path[len(unit.Path)-1]; got != dest {
			t.Fatalf("unit %s should path to %+v, got %+v", unit.ID, dest, got)
		}
	}
	// 真实 tick 推进：被放行的三个单位真的动起来，被跳过的机甲原地不动。
	posBefore := map[string]model.Position{mechaA.ID: mechaA.Position, mechaC.ID: mechaC.Position, soldier.ID: soldier.Position}
	for i := 0; i < 5; i++ {
		core.processTick()
	}
	for _, unit := range []*model.Unit{mechaA, mechaC, soldier} {
		if unit.Position == posBefore[unit.ID] {
			t.Fatalf("unit %s should have moved from %+v", unit.ID, posBefore[unit.ID])
		}
	}
	if mechaB.Position != beforeB || mechaB.HasPath() {
		t.Fatalf("foreign-operated mecha must stay put: pos=%+v path=%v", mechaB.Position, mechaB.Path)
	}
}

// 契约 §8-7：背包满时 transfer_item to_player 只按本机甲剩余格数截断，
// 另一台机甲的背包不被借用。
func TestMechaCoop_07_WithdrawTruncatesByOwnMechaSlotsOnly(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	mechaA := findExecutorUnit(t, ws)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1"
	model.SyncMechaCapabilities(mechaA, ws.Players["p1"])
	slots := mechaA.Mecha.InventorySlots
	perSlot := model.ItemStackSize(model.ItemCoal)
	recordA.Inventory = model.ItemInventory{model.ItemCoal: (slots - 3) * perSlot}

	_, recordB := coopSpawnMecha(ws, "p1", "u-bag-b", ws.SurfaceOffset(mechaA.Position, 2, 0), "p1-b")

	depot := newBuilding("b-withdraw", model.BuildingTypeDepotMk1, "p1", coopBuildSite(t, ws, mechaA.Position, 2, model.BuildingTypeDepotMk1))
	depot.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, depot)
	if _, _, err := depot.Storage.Load(model.ItemIronIngot, 10*model.ItemStackSize(model.ItemIronIngot)); err != nil {
		t.Fatalf("load depot: %v", err)
	}
	request := 10 * model.ItemStackSize(model.ItemIronIngot)
	res, _ := execCommandAs(core, model.CmdTransferItem, ws, "p1", "p1", model.Command{
		Payload: map[string]any{
			"building_id": depot.ID,
			"item_id":     model.ItemIronIngot,
			"quantity":    request,
			"direction":   "to_player",
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("withdraw failed: %s (%s)", res.Code, res.Message)
	}
	wantAccepted := 3 * model.ItemStackSize(model.ItemIronIngot)
	if got := recordA.Inventory[model.ItemIronIngot]; got != wantAccepted {
		t.Fatalf("withdraw must fill exactly own free slots: got %d want %d", got, wantAccepted)
	}
	if got := recordA.Inventory.SlotsUsed(); got != slots {
		t.Fatalf("own bag should be full: %d/%d", got, slots)
	}
	if len(recordB.Inventory) != 0 {
		t.Fatalf("other mecha backpack must stay untouched: %+v", recordB.Inventory)
	}
}

// 契约 §8-8：机甲带货阵亡 → 复活后背包原样；作业被重置。
func TestMechaCoop_08_RespawnKeepsBackpackResetsJob(t *testing.T) {
	ws := newRTTWorld(true)
	hq := surfaceTestBuilding(ws, "hq-respawn", model.BuildingTypeBattlefieldAnalysisBase, model.Position{X: 4, Y: 4})
	hq.OwnerID = "p1"
	unit := spawnWorldTestUnit(ws, model.UnitTypeExecutor, "p1", model.Position{X: 2, Y: 2})
	record := registerMecha(ws, "p1", unit)
	record.Operator = "p1"
	record.Inventory = model.ItemInventory{model.ItemGear: 5}
	node := addManualCoal(ws, 2)
	core := &GameCore{}
	if res, _ := execCommandAs(core, model.CmdMineResource, ws, "p1", "p1", model.Command{
		Payload: map[string]any{"resource_id": node.ID, "quantity": 2},
	}); res.Code != model.CodeOK || unit.Mecha.Job == nil {
		t.Fatalf("start mining: %+v job=%+v", res, unit.Mecha.Job)
	}

	ws.Tick = 20
	killUnit(ws, unit, "enemy", "p2", "unit")
	deadline := record.RespawnAtTick
	if deadline != 20+model.ExecutorRespawnTicks() {
		t.Fatalf("wrong respawn deadline %d", deadline)
	}
	if got := record.Inventory[model.ItemGear]; got != 5 {
		t.Fatalf("death must keep backpack, got %d (%+v)", got, record.Inventory)
	}
	if ws.Units[unit.ID] != nil {
		t.Fatal("dead unit should be removed from world")
	}

	ws.Tick = deadline
	settleMechas(ws)
	revived := ws.Units[unit.ID]
	if revived == nil {
		t.Fatal("mecha should respawn at living HQ")
	}
	if record.RespawnAtTick != 0 {
		t.Fatalf("respawn tick should reset, got %d", record.RespawnAtTick)
	}
	if got := record.Inventory[model.ItemGear]; got != 5 {
		t.Fatalf("respawn must keep backpack, got %d (%+v)", got, record.Inventory)
	}
	if revived.Mecha.Job != nil {
		t.Fatalf("job must be reset on respawn, got %+v", revived.Mecha.Job)
	}
	if revived.Mecha.Energy != revived.Mecha.MaxEnergy {
		t.Fatalf("respawn must be full energy: %d/%d", revived.Mecha.Energy, revived.Mecha.MaxEnergy)
	}
}

// 契约 §8-9：基站 produce executor：成本从基站存储扣除；出厂后空闲、空背包、
// 满能量，出现在 summary mechas；可被 assign_mecha 绑定。
func TestMechaCoop_09_BaseProducesIdleMecha(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	base := botPlayerHQ(t, ws, "p1")
	// 基站在测试里不接电网：清零耗电，让它按运行状态推进生产。
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	base.Runtime.State = model.BuildingWorkRunning
	mechaA := findExecutorUnit(t, ws)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1"

	entry, ok := model.PublicWorldProduceUnitByID(string(model.UnitTypeExecutor))
	if !ok {
		t.Fatal("executor must be public world produce unit")
	}
	for _, cost := range entry.Cost {
		recordA.EnsureInventory()[cost.ItemID] = cost.Quantity
		if res, _ := execCommandAs(core, model.CmdTransferItem, ws, "p1", "p1", model.Command{
			Payload: map[string]any{"building_id": base.ID, "item_id": cost.ItemID, "quantity": cost.Quantity},
		}); res.Code != model.CodeOK {
			t.Fatalf("load %s into base: %s (%s)", cost.ItemID, res.Code, res.Message)
		}
		if got := base.Storage.ItemQuantity(cost.ItemID); got != cost.Quantity {
			t.Fatalf("base storage %s: got %d want %d", cost.ItemID, got, cost.Quantity)
		}
	}

	res, _ := execCommandAs(core, model.CmdProduce, ws, "p1", "p1", model.Command{
		Target:  model.CommandTarget{EntityID: base.ID},
		Payload: map[string]any{"unit_type": string(model.UnitTypeExecutor)},
	})
	if res.Code != model.CodeOK || len(base.UnitQueue) != 1 {
		t.Fatalf("produce executor: %s (%s) queue=%+v", res.Code, res.Message, base.UnitQueue)
	}
	for _, cost := range entry.Cost {
		if got := base.Storage.ItemQuantity(cost.ItemID); got != 0 {
			t.Fatalf("cost %s must be deducted from base storage, got %d", cost.ItemID, got)
		}
	}

	produced := ""
	for i := 0; i <= entry.ProductionTicks+2 && produced == ""; i++ {
		core.processTick()
		for id, unit := range ws.Units {
			if unit != nil && unit.OwnerID == "p1" && unit.Type == model.UnitTypeExecutor && id != mechaA.ID {
				produced = id
			}
		}
	}
	if produced == "" {
		t.Fatalf("executor not produced after %d ticks", entry.ProductionTicks)
	}
	unit := ws.Units[produced]
	record := ws.Players["p1"].MechaByUnitID(produced)
	if record == nil {
		t.Fatalf("produced mecha %s missing dossier", produced)
	}
	if record.Operator != "" || record.PlanetID != ws.PlanetID {
		t.Fatalf("produced mecha must be idle on this planet: %+v", record)
	}
	if len(record.Inventory) != 0 || record.Inventory.Count() != 0 {
		t.Fatalf("produced mecha must have empty backpack: %+v", record.Inventory)
	}
	if unit.Mecha == nil || unit.Mecha.Energy != unit.Mecha.MaxEnergy || unit.Mecha.Energy <= 0 {
		t.Fatalf("produced mecha must be full energy: %+v", unit.Mecha)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	summary := ql.Summary(ws, "p1", core.Victory(), worlds)
	var view *query.MechaView
	for i := range summary.Players["p1"].Mechas {
		if summary.Players["p1"].Mechas[i].UnitID == produced {
			view = &summary.Players["p1"].Mechas[i]
		}
	}
	if view == nil {
		t.Fatalf("produced mecha missing from summary mechas: %+v", summary.Players["p1"].Mechas)
	}
	if !view.Alive || view.Operator != "" || view.InventorySlotsUsed != 0 {
		t.Fatalf("summary mecha view mismatch: %+v", view)
	}

	if res, _ := execCommandAs(core, model.CmdAssignMecha, ws, "p1", "p1", model.Command{
		Target:  model.CommandTarget{EntityID: produced},
		Payload: map[string]any{"operator": "p1-producer"},
	}); res.Code != model.CodeOK {
		t.Fatalf("assign produced mecha: %s (%s)", res.Code, res.Message)
	}
	if record.Operator != "p1-producer" {
		t.Fatalf("produced mecha not bound, operator=%q", record.Operator)
	}
}

// 契约 §8-10：A 机甲缺料、B 机甲有料：A 的任务等料，不会去拿 B 的。
func TestMechaCoop_10_NoCrossMechaMaterialPooling(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	mechaA := findExecutorUnit(t, ws)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1-a"
	recordA.Inventory = model.ItemInventory{
		model.ItemGear:         1,
		model.ItemIronIngot:    6,
		model.ItemMagneticCoil: 3,
	}
	_, recordB := coopSpawnMecha(ws, "p1", "u-rich-b", ws.SurfaceOffset(mechaA.Position, 2, 0), "p1-b")
	grantAllItemsToMecha(recordB, 100)
	richBefore := recordB.Inventory.Clone()

	site := coopBuildSite(t, ws, mechaA.Position, 2, model.BuildingTypeWindTurbine)
	if res := issueInternalCommandAs(core, "p1", "p1-a", coopBuildCommand(site, model.BuildingTypeWindTurbine, false)); res.Code != model.CodeOK {
		t.Fatalf("build: %s (%s)", res.Code, res.Message)
	}
	taskID := ws.Construction.Order[0]
	// A 的料被别处拿走（模拟背包被清空）：任务只能等料。
	recordA.Inventory = nil

	for i := 0; i < 5; i++ {
		core.processTick()
		task := ws.Construction.Tasks[taskID]
		if task == nil {
			t.Fatalf("task %s disappeared (cross-mecha borrowing?)", taskID)
		}
		if task.State != model.ConstructionPending || task.WaitReason != "insufficient_materials" {
			t.Fatalf("tick %d: task should wait for own mecha materials, state=%s wait=%q", i, task.State, task.WaitReason)
		}
		if len(recordA.Inventory) != 0 {
			t.Fatalf("materials appeared in A's backpack: %+v", recordA.Inventory)
		}
		if len(recordB.Inventory) != len(richBefore) {
			t.Fatalf("B's backpack was borrowed: %+v", recordB.Inventory)
		}
	}
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeWindTurbine {
			t.Fatal("construction must not complete without A's materials")
		}
	}

	// 给 A 补回自己的料：任务照常推进并落成。
	recordA.Inventory = model.ItemInventory{
		model.ItemGear:         1,
		model.ItemIronIngot:    6,
		model.ItemMagneticCoil: 3,
	}
	for i := 0; i < 10 && ws.Construction.Tasks[taskID] != nil; i++ {
		core.processTick()
	}
	if ws.Construction.Tasks[taskID] != nil {
		t.Fatalf("task should complete once A has materials: %+v", ws.Construction.Tasks[taskID])
	}
	built := false
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeWindTurbine {
			built = true
		}
	}
	if !built {
		t.Fatal("wind turbine should be built after A restocked")
	}
}

// 契约 §8-11：C 取消 A 的施工任务（已扣料）→ 退料进 A 的背包，不是 C 的。
func TestMechaCoop_11_CancelRefundsIntoTaskMecha(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	mechaA := findExecutorUnit(t, ws)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1-a"
	recordA.Inventory = model.ItemInventory{
		model.ItemGear:         1,
		model.ItemIronIngot:    6,
		model.ItemMagneticCoil: 3,
	}
	_, recordC := coopSpawnMecha(ws, "p1", "u-cancel-c", ws.SurfaceOffset(mechaA.Position, 2, 0), "p1-c")
	recordC.Inventory = model.ItemInventory{}

	site := coopBuildSite(t, ws, mechaA.Position, 2, model.BuildingTypeWindTurbine)
	if res := issueInternalCommandAs(core, "p1", "p1-a", coopBuildCommand(site, model.BuildingTypeWindTurbine, false)); res.Code != model.CodeOK {
		t.Fatalf("build: %s (%s)", res.Code, res.Message)
	}
	taskID := ws.Construction.Order[0]
	task := ws.Construction.Tasks[taskID]

	// 已扣料状态（生产路径在落成时扣料；扣料后失败/取消走同一条退料逻辑）。
	if !recordA.DeductItems(task.Cost.Items) {
		t.Fatal("fixture could not deduct task cost from A")
	}
	task.MaterialsDeducted = true
	if err := ws.Construction.Transition(task.ID, model.ConstructionInProgress); err != nil {
		t.Fatalf("transition: %v", err)
	}
	task.TotalTicks, task.RemainingTicks = 10, 5

	res := issueInternalCommandAs(core, "p1", "p1-c", model.Command{
		Type:    model.CmdCancelConstruction,
		Payload: map[string]any{"task_id": taskID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("cancel by C: %s (%s)", res.Code, res.Message)
	}
	if task.State != model.ConstructionCancelled {
		t.Fatalf("task should be cancelled, got %s", task.State)
	}
	for _, id := range ws.Construction.Order {
		if id == taskID {
			t.Fatal("cancelled task should leave the queue order")
		}
	}
	// ratio = 5/10：gear ceil? 实现用 int() 截断 → gear 0、iron 3、coil 1。
	want := model.ItemInventory{
		model.ItemIronIngot:    3,
		model.ItemMagneticCoil: 1,
	}
	if len(recordA.Inventory) != len(want) {
		t.Fatalf("refund must land in task mecha A, got %+v", recordA.Inventory)
	}
	for item, qty := range want {
		if got := recordA.Inventory[item]; got != qty {
			t.Fatalf("refund %s: got %d want %d (%+v)", item, got, qty, recordA.Inventory)
		}
	}
	if len(recordC.Inventory) != 0 {
		t.Fatalf("cancelling issuer's backpack must not receive the refund: %+v", recordC.Inventory)
	}
}

// 契约 §8-12：拆除退料进发令者机甲背包；背包满时超出部分丢弃。
func TestMechaCoop_12_DemolishRefundGoesToIssuerMecha(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	mechaA := findExecutorUnit(t, ws)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1-a"
	recordA.Inventory = model.ItemInventory{}
	_, recordB := coopSpawnMecha(ws, "p1", "u-demolish-b", ws.SurfaceOffset(mechaA.Position, 2, 0), "p1-b")
	recordB.Inventory = model.ItemInventory{}

	buildAndDemolish := func(id string) model.BuildingType {
		b := newBuilding(id, model.BuildingTypeWindTurbine, "p1", coopBuildSite(t, ws, mechaA.Position, 3, model.BuildingTypeWindTurbine))
		placeBuilding(ws, b)
		res, _ := execCommandAs(core, model.CmdDemolish, ws, "p1", "p1-a", model.Command{
			Target: model.CommandTarget{EntityID: b.ID},
		})
		if res.Code != model.CodeOK {
			t.Fatalf("demolish %s: %s (%s)", id, res.Code, res.Message)
		}
		return b.Type
	}
	buildAndDemolish("b-demolish-1")

	// 风力涡轮机 refund rate 0.5，按 ceil：gear1、iron3、coil2。
	want := model.ItemInventory{
		model.ItemGear:         1,
		model.ItemIronIngot:    3,
		model.ItemMagneticCoil: 2,
	}
	for item, qty := range want {
		if got := recordA.Inventory[item]; got != qty {
			t.Fatalf("demolish refund %s: got %d want %d (%+v)", item, got, qty, recordA.Inventory)
		}
	}
	if len(recordB.Inventory) != 0 {
		t.Fatalf("other mecha must not receive refund: %+v", recordB.Inventory)
	}

	// 背包满：超出部分丢弃，永远不超格数上限。
	model.SyncMechaCapabilities(mechaA, ws.Players["p1"])
	slots := mechaA.Mecha.InventorySlots
	recordA.Inventory = model.ItemInventory{model.ItemCoal: slots * model.ItemStackSize(model.ItemCoal)}
	buildAndDemolish("b-demolish-2")
	if got := recordA.Inventory.SlotsUsed(); got > slots {
		t.Fatalf("demolish refund pushed bag over capacity: %d/%d", got, slots)
	}
	if got := recordA.Inventory[model.ItemGear]; got != 0 {
		t.Fatalf("full bag must discard refund, got gear %d (%+v)", got, recordA.Inventory)
	}
}

// 契约 §8-13：配送器只给发出请求的那台机甲送货 / 回收。
func TestMechaCoop_13_DistributorServesOnlyRequestingMecha(t *testing.T) {
	ws, home, sink := distributorTestWorld(t)
	sink.Distributor.Mode = model.LogisticsStationModeNone
	home.Distributor.Mode = model.LogisticsStationModeNone
	home.Distributor.LocalStorage = 0
	home.Distributor.PlayerDeliveryEnabled = true
	home.Distributor.PlayerCollectionEnabled = true
	home.Distributor.Energy = home.Distributor.EnergyCapacity
	distributorTestLoad(t, ws, home, model.ItemIronOre, 40)

	// 请求机甲：ID "mecha"（min 5 / max 12），位置在配送范围内。
	requesting := distributorTestMecha(ws, sink.Position)
	// 另一台机甲（开局机甲 u-starter）在 home 旁边、没有物流请求。
	other := ws.Units["u-starter"]
	if other == nil {
		t.Fatal("fixture missing starter mecha")
	}
	otherRecord := ws.Players["p1"].MechaByUnitID(other.ID)
	if otherRecord == nil {
		t.Fatal("starter mecha dossier missing")
	}
	// 另一台机甲没有物流请求：它的背包既不该被送货，也不该被回收
	// （超量铁矿石留在它自己包里）。
	otherRecord.Inventory = model.ItemInventory{model.ItemIronOre: 50}

	for _, id := range []string{"a", "b", "c"} {
		distributorTestBot(t, ws, home, id)
	}
	for i := 0; i < 60; i++ {
		settleDistributors(ws)
		for _, bot := range ws.LogisticsBots {
			if bot.Status != model.LogisticsDroneIdle && bot.TargetKind == "mecha" {
				if bot.TargetID != requesting.ID {
					t.Fatalf("distributor served non-requesting mecha %s", bot.TargetID)
				}
			}
			if err := bot.Validate(); err != nil {
				t.Fatalf("tick %d bot %+v: %v", i, bot, err)
			}
		}
		ws.Tick++
		if ws.PowerSnapshot != nil {
			ws.PowerSnapshot.Tick = ws.Tick
		}
	}
	requestingRecord := ws.Players["p1"].MechaByUnitID(requesting.ID)
	if got := requestingRecord.Inventory[model.ItemIronOre]; got != 12 {
		t.Fatalf("requesting mecha should be filled to max 12, got %d", got)
	}
	if got := otherRecord.Inventory[model.ItemIronOre]; got != 50 {
		t.Fatalf("non-requesting mecha must be left alone (neither delivered nor collected), got %d", got)
	}
}

// 契约 §8-15：检查点契约 item_gte 统计所有机甲背包之和。
func TestMechaCoop_15_ItemGteSumsAllMechaBackpacks(t *testing.T) {
	core := newMechaCoopCore(t)
	ws := core.World()
	mechaA := findExecutorUnit(t, ws)
	recordA := starterMecha(ws, "p1")
	recordA.Operator = "p1-a"
	recordA.Inventory = model.ItemInventory{model.ItemIronIngot: 4}
	_, recordB := coopSpawnMecha(ws, "p1", "u-sum-b", ws.SurfaceOffset(mechaA.Position, 2, 0), "p1-b")
	recordB.Inventory = model.ItemInventory{model.ItemIronIngot: 5}
	if got := ws.Players["p1"].TotalItems(model.ItemIronIngot); got != 9 {
		t.Fatalf("TotalItems should sum mecha backpacks, got %d", got)
	}

	pass := core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{
		{Kind: "item_gte", Player: "p1", ItemID: string(model.ItemIronIngot), N: 9},
	}})
	if !pass.Passed || pass.Results[0].Actual != "9" {
		t.Fatalf("item_gte must pass on summed backpacks: %+v", pass)
	}
	fail := core.EvaluateContract(checkpoint.Contract{Checks: []checkpoint.ContractCheck{
		{Kind: "item_gte", Player: "p1", ItemID: string(model.ItemIronIngot), N: 10},
	}})
	if fail.Passed || fail.Results[0].Actual != "9" {
		t.Fatalf("item_gte must fail above the summed total: %+v", fail)
	}
}

// 契约 §8-20：transfer_item 目标建筑不在基站覆盖内、且机甲超出 operate_range
// → OUT_OF_RANGE；把机甲开近后成功。
func TestMechaCoop_20_TransferOutOfRangeThenApproach(t *testing.T) {
	ws := model.NewWorldState("planet-20", 24)
	player := &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Players["p1"] = player
	unit := spawnWorldTestUnit(ws, model.UnitTypeExecutor, "p1", model.Position{X: 30, Y: 20})
	record := registerMecha(ws, "p1", unit)
	record.Operator = "p1"
	record.Inventory = model.ItemInventory{model.ItemIronIngot: 20}

	var depotPos model.Position
	foundFar := false
	for _, p := range ws.SurfaceDisc(unit.Position, 40) {
		if ws.SurfaceDistance(unit.Position, p) <= model.ExecutorOperateRange()+4 {
			continue
		}
		def, _ := model.BuildingDefinitionByID(model.BuildingTypeDepotMk1)
		if !ws.FootprintFits(p, def.Footprint, model.BuildingTypeDepotMk1, "") {
			continue
		}
		depotPos, foundFar = p, true
		break
	}
	if !foundFar {
		t.Fatal("no buildable tile beyond operate range")
	}
	depot := newBuilding("b-far-depot", model.BuildingTypeDepotMk1, "p1", depotPos)
	placeBuilding(ws, depot)
	if d := ws.SurfaceDistance(unit.Position, depot.Position); d <= model.ExecutorOperateRange() {
		t.Fatalf("fixture distance %d must exceed operate range %d", d, model.ExecutorOperateRange())
	}
	core := &GameCore{executorUsage: make(map[string]int)}

	transfer := func() model.CommandResult {
		res, _ := execCommandAs(core, model.CmdTransferItem, ws, "p1", "p1", model.Command{
			Payload: map[string]any{
				"building_id": depot.ID,
				"item_id":     model.ItemIronIngot,
				"quantity":    5,
			},
		})
		return res
	}
	if res := transfer(); res.Code != model.CodeOutOfRange {
		t.Fatalf("transfer out of range: %s (%s)", res.Code, res.Message)
	}
	if got := depot.Storage.ItemQuantity(model.ItemIronIngot); got != 0 {
		t.Fatalf("out-of-range transfer changed storage: %d", got)
	}
	if got := record.Inventory[model.ItemIronIngot]; got != 20 {
		t.Fatalf("out-of-range transfer consumed inventory: %d", got)
	}

	// 把机甲开近：一条 move 命令 + 逐 tick 推进（真实移动结算）。
	var dest model.Position
	found := false
	for _, p := range ws.SurfaceDisc(depot.Position, 8) {
		if tileWalkableForUnit(ws, p, unit.ID) && ws.SurfaceDistance(p, depot.Position) <= model.ExecutorOperateRange() {
			dest, found = p, true
			break
		}
	}
	if !found {
		t.Fatal("no walkable tile near depot")
	}
	if res, _ := execCommandAs(core, model.CmdMove, ws, "p1", "p1", model.Command{
		Target: model.CommandTarget{EntityID: unit.ID, Position: &dest},
	}); res.Code != model.CodeOK {
		t.Fatalf("move mecha near depot: %s (%s)", res.Code, res.Message)
	}
	for i := 0; i < 300 && unit.Position != dest; i++ {
		ws.Tick++
		settleUnitMovement(ws)
	}
	if unit.Position != dest {
		t.Fatalf("mecha never reached %+v, at %+v", dest, unit.Position)
	}
	if d := ws.SurfaceDistance(unit.Position, depot.Position); d > model.ExecutorOperateRange() {
		t.Fatalf("mecha still out of range: %d > %d", d, model.ExecutorOperateRange())
	}
	if res := transfer(); res.Code != model.CodeOK {
		t.Fatalf("transfer after approaching: %s (%s)", res.Code, res.Message)
	}
	if got := depot.Storage.ItemQuantity(model.ItemIronIngot); got != 5 {
		t.Fatalf("storage should receive 5, got %d", got)
	}
	if got := record.Inventory[model.ItemIronIngot]; got != 15 {
		t.Fatalf("backpack should keep 15, got %d", got)
	}
}
