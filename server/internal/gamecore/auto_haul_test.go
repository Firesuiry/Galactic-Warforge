package gamecore

import (
	"testing"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/terrain"
)

// 运输机器人全局自动模式（§2.1）验收：出厂默认、单台送料让熔炉持续生产、
// 多台不扎堆、同建筑并发上限、缺料优先、不从生产建筑主库存拿原料、
// 认领不超发、端点被拆释放认领并带货改派、存读档后继续、模式切换、派单性能。
//
// 夹具：一块全平地的 48 面小行星（p1 有执行体、全物品与全科技），建筑用
// placeAutoBuilding 直接摆放（无能耗、running）——自动模式测的是「派单 + 搬运」，
// 电力接线与机甲作业范围是另一套规则的验收对象，这里固定住它们才不会让
// 「机器人没送料」的失败被误读成「熔炉断电」。每 tick 只跑
// 「电力 → 资源 → 生产 → 存储 → 单位生产 → 移动 → 运输机器人」这条最短链路
// （与真实管线里的相对顺序一致），不跑黑雾/bot，保证确定性。

// advanceAutoTicks 推进若干 tick 的确定性子集结算（含自动模式派单）。
func advanceAutoTicks(core *GameCore, ws *model.WorldState, ticks int) {
	for i := 0; i < ticks; i++ {
		ws.Tick++
		settlePowerGeneration(ws, currentPlanetEnvironment(core.maps, ws.PlanetID))
		finalizePowerSettlement(ws, nil)
		settleResources(ws)
		settleProduction(ws)
		settleStorage(ws)
		settleUnitProduction(ws)
		settleUnitMovement(ws)
		settleTransportRobots(ws)
	}
}

// placeAutoBuilding 在世界上摆一座己方、无能耗、running 的建筑并登记占地。
// 先登记进 ws.Buildings 再 IndexBuilding（与真实施工完工路径同一顺序）。
func placeAutoBuilding(t *testing.T, ws *model.WorldState, id string, btype model.BuildingType, pos model.Position) *model.Building {
	t.Helper()
	b := placeAutoBuildingRaw(t, ws, id, btype, pos)
	model.RegisterPowerGridBuilding(ws, b)
	return b
}

// placeAutoBuildingRaw 摆放建筑但不登记电网（基准夹具用）。
// origin 只是搜索起点：5×5 的 HQ 贴近立方体角会折角自重叠，一律用
// FindFootprintOrigin 找一块整片可落的空地（与场景预设落位同一入口）。
func placeAutoBuildingRaw(t *testing.T, ws *model.WorldState, id string, btype model.BuildingType, origin model.Position) *model.Building {
	t.Helper()
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		t.Fatalf("未知建筑 %s", btype)
	}
	pos, ok := ws.FindFootprintOrigin(origin, def.Footprint, btype, "")
	if !ok {
		t.Fatalf("找不到 %s 的落位（起点 %+v）", btype, origin)
	}
	profile := model.BuildingProfileFor(btype, 1)
	b := &model.Building{
		ID:          id,
		Type:        btype,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	b.Runtime.State = model.BuildingWorkRunning
	b.Runtime.Params.EnergyConsume = 0
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	model.InitBuildingStorage(b)
	model.InitBuildingProduction(b)
	model.InitBuildingLogisticsStation(b)
	ws.Buildings[id] = b
	if err := ws.IndexBuilding(b); err != nil {
		delete(ws.Buildings, id)
		t.Fatalf("摆放 %s 到 %+v 失败: %v", btype, pos, err)
	}
	return b
}

// placeAutoSmelter 摆一座设了 smelt_iron 配方、缺料待喂的电弧熔炉。
func placeAutoSmelter(t *testing.T, ws *model.WorldState, id string, pos model.Position) *model.Building {
	t.Helper()
	smelter := placeAutoBuilding(t, ws, id, model.BuildingTypeArcSmelter, pos)
	smelter.Production.RecipeID = "smelt_iron"
	smelter.SyncStorageReserve()
	return smelter
}

// autoHaulFixture 一座储物仓（供给）+ 一座缺料熔炉（需求）。
type autoHaulFixture struct {
	core    *GameCore
	ws      *model.WorldState
	depot   *model.Building
	smelter *model.Building
}

func newAutoHaulFixture(t *testing.T) autoHaulFixture {
	t.Helper()
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 20})
	smelter := placeAutoSmelter(t, ws, "b-smelter", model.Position{X: 40, Y: 20})
	return autoHaulFixture{core: core, ws: ws, depot: depot, smelter: smelter}
}

// autoRobot 放一台自动模式（出厂默认）的运输机器人。
func autoRobot(t *testing.T, ws *model.WorldState, pos model.Position) *model.Unit {
	t.Helper()
	robot := haulSpawnRobot(t, ws, pos)
	if robot.Haul == nil || robot.Haul.Mode != model.HaulModeAuto {
		t.Fatalf("出厂机器人不是自动模式: %+v", robot.Haul)
	}
	return robot
}

// toDispatchTick 推进到下一个派单 tick（每 10 tick 一次）并停在那里
// （tick 0 也是 0%10==0，所以先无条件走一 tick，否则一次结算都不会发生）。
func toDispatchTick(core *GameCore, ws *model.WorldState) {
	advanceAutoTicks(core, ws, 1)
	for ws.Tick%haulDispatchIntervalTicks != 0 {
		advanceAutoTicks(core, ws, 1)
	}
}

// demolishAutoBuilding 从世界里移除一座建筑（等价于被拆除/摧毁）。
func demolishAutoBuilding(ws *model.WorldState, id string) {
	b := ws.Buildings[id]
	if b == nil {
		return
	}
	delete(ws.Buildings, id)
	ws.UnindexBuilding(b)
}

// 1) 出厂默认：运输机器人出厂即 auto + idle，不需要任何指令。
func TestAutoHaulFactoryDefaultMode(t *testing.T) {
	f := newAutoHaulFixture(t)
	hq := placeAutoBuilding(t, f.ws, "b-hq", model.BuildingTypeBattlefieldAnalysisBase, model.Position{X: 20, Y: 40})
	hq.UnitQueue = []model.UnitProductionOrder{{UnitType: model.UnitTypeTransportRobot, RemainingTicks: 1, TotalTicks: 1}}

	advanceAutoTicks(f.core, f.ws, 2)

	spawned := 0
	for _, u := range f.ws.Units {
		if u == nil || u.Type != model.UnitTypeTransportRobot {
			continue
		}
		spawned++
		if u.Haul == nil {
			t.Fatal("运输机器人没有 haul 状态")
		}
		if u.Haul.Mode != model.HaulModeAuto || u.Haul.Phase != model.HaulPhaseIdle {
			t.Fatalf("出厂机器人状态 = %+v, want mode=auto phase=idle", u.Haul)
		}
	}
	if spawned != 1 {
		t.Fatalf("出厂机器人 = %d 台, want 1", spawned)
	}
}

// 2) 单台机器人把仓库里的铁矿送到缺料熔炉，并让熔炉持续生产。
func TestAutoHaulRobotFeedsStarvedSmelter(t *testing.T) {
	f := newAutoHaulFixture(t)
	haulFill(f.depot, model.ItemIronOre, 60)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})

	advanceAutoTicks(f.core, f.ws, 1500)

	if f.smelter.ExportableItemQuantity(model.ItemIronIngot) == 0 {
		t.Fatalf("熔炉没有产出铁块: state=%s reason=%s storage=%+v production=%+v haul=%+v",
			f.smelter.Runtime.State, f.smelter.Runtime.StateReason, f.smelter.Storage, f.smelter.Production, robot.Haul)
	}
	if robot.Haul.DeliveredTotal == 0 {
		t.Fatalf("机器人一件都没送到: haul=%+v", robot.Haul)
	}
	if got := haulStored(f.smelter, model.ItemIronOre); got == 0 {
		t.Fatal("熔炉没有收到铁矿")
	}
	// 仓库的铁矿必须减少（确实是从仓库取的）。
	if got := f.depot.Storage.Inventory[model.ItemIronOre]; got >= 60 {
		t.Fatalf("仓库铁矿没有减少: %d", got)
	}
}

// 3) 3 台熔炉缺料 + 3 台机器人 → 每台熔炉都得到服务（不扎堆）。
func TestAutoHaulSpreadsAcrossStarvedSmelters(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 30})
	smelters := []*model.Building{
		placeAutoSmelter(t, ws, "b-s1", model.Position{X: 40, Y: 12}),
		placeAutoSmelter(t, ws, "b-s2", model.Position{X: 40, Y: 30}),
		placeAutoSmelter(t, ws, "b-s3", model.Position{X: 40, Y: 48}),
	}
	haulFill(depot, model.ItemIronOre, 120)
	robots := []*model.Unit{
		autoRobot(t, ws, model.Position{X: 30, Y: 28}),
		autoRobot(t, ws, model.Position{X: 30, Y: 30}),
		autoRobot(t, ws, model.Position{X: 30, Y: 32}),
	}
	toDispatchTick(core, ws)

	served := map[string]int{}
	for _, robot := range robots {
		if robot.Haul.ToBuildingID == "" {
			t.Fatalf("机器人 %s 没有被派单: %+v", robot.ID, robot.Haul)
		}
		served[robot.Haul.ToBuildingID]++
	}
	if len(served) != len(smelters) {
		t.Fatalf("3 台熔炉只有 %d 台被服务（扎堆）: %v", len(served), served)
	}
	for _, smelter := range smelters {
		if served[smelter.ID] != 1 {
			t.Fatalf("熔炉 %s 被 %d 台机器人服务，want 1: %v", smelter.ID, served[smelter.ID], served)
		}
	}
	// 继续跑：三座熔炉都能持续生产。
	advanceAutoTicks(core, ws, 2000)
	for i, smelter := range smelters {
		if smelter.ExportableItemQuantity(model.ItemIronIngot) == 0 {
			t.Fatalf("第 %d 座熔炉没有产出铁块: state=%s reason=%s", i+1, smelter.Runtime.State, smelter.Runtime.StateReason)
		}
	}
}

// 4) 1 台熔炉缺料 + 5 台机器人 → 认领把 2 件缺口占满后，不再吸引别的机器人（其余原地待命）。
func TestAutoHaulFillsGapThenStopsAssigning(t *testing.T) {
	f := newAutoHaulFixture(t)
	haulFill(f.depot, model.ItemIronOre, 200)
	robots := make([]*model.Unit, 0, 5)
	for i := 0; i < 5; i++ {
		robots = append(robots, autoRobot(t, f.ws, model.Position{X: 30, Y: 18 + i}))
	}
	toDispatchTick(f.core, f.ws)

	serving := 0
	for _, robot := range robots {
		switch {
		case robot.Haul.ToBuildingID == f.smelter.ID:
			serving++
		case robot.Haul.ToBuildingID == "":
			if robot.Haul.Phase != model.HaulPhaseIdle {
				t.Fatalf("没被派单的机器人 phase = %s, want idle", robot.Haul.Phase)
			}
			if robot.HasPath() {
				t.Fatalf("没被派单的机器人却在移动: path=%v", robot.Path)
			}
		default:
			t.Fatalf("机器人被派去了意外的建筑 %s", robot.Haul.ToBuildingID)
		}
	}
	// 缺口 2 件 → 一台机器人一次认领就占满，其余机器人看到「未认领缺口 = 0」而不派单。
	if serving != 1 {
		t.Fatalf("去服务熔炉的机器人 = %d, want 1（缺口 2 件被一次认领占满）", serving)
	}
	// 已在服务中的机器人不会被重复派单。
	before := robots[0].Haul.ToBuildingID
	toDispatchTick(f.core, f.ws)
	for _, robot := range robots {
		if robot.Haul.ToBuildingID != "" && robot.Haul.ToBuildingID != before {
			t.Fatalf("已在服务中的机器人被重新派单: %s -> %s", before, robot.Haul.ToBuildingID)
		}
	}
}

// 4b) 同一建筑最多 2 台：需求缺口大到能容下 3 台机器人时，第 3 台被并发上限挡住。
func TestAutoHaulCapsRobotsPerDemand(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 30})
	// logistics_drone 配方：iron_ingot 一批 5 件 → 目标库存 10 件 → 缺口 10，
	// 足够让 3 台机器人各认领 4 件，从而真正触发「同一建筑最多 2 台」的上限。
	machine := placeAutoBuilding(t, ws, "b-assembler", model.BuildingTypeAssemblingMachineMk1, model.Position{X: 40, Y: 30})
	machine.Production.RecipeID = "logistics_drone"
	machine.SyncStorageReserve()
	// 只供给 iron_ingot：其余两种原料没有供给，因此只有一条需求，上限判定不被干扰。
	haulFill(depot, model.ItemIronIngot, 100)

	robots := make([]*model.Unit, 0, 3)
	for i := 0; i < 3; i++ {
		robots = append(robots, autoRobot(t, ws, model.Position{X: 30, Y: 28 + i}))
	}
	toDispatchTick(core, ws)

	serving := 0
	idle := 0
	for _, robot := range robots {
		switch robot.Haul.ToBuildingID {
		case machine.ID:
			serving++
		case "":
			idle++
		default:
			t.Fatalf("机器人被派去了意外的建筑 %s", robot.Haul.ToBuildingID)
		}
	}
	if serving != haulMaxRobotsPerDemand {
		t.Fatalf("服务同一建筑的机器人 = %d, want %d", serving, haulMaxRobotsPerDemand)
	}
	if idle != 1 {
		t.Fatalf("待命机器人 = %d, want 1（第 3 台被并发上限挡住）", idle)
	}
}

//  5. 缺料停工的优先于远近：0.5 倍距离让远处「已经停工」的熔炉压过近处
//     「只是偏低」的熔炉（近 30 cell 未停工 vs 远 40 cell 停工 → 20 < 30）。
func TestAutoHaulPrefersStarvedBuildingOverNearby(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 64)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 10, Y: 30})
	near := placeAutoSmelter(t, ws, "b-near", model.Position{X: 45, Y: 30})
	far := placeAutoSmelter(t, ws, "b-far", model.Position{X: 55, Y: 30})
	haulFill(depot, model.ItemIronOre, 200)

	// 近处熔炉先给 1 件（够开工、不足以填满目标库存 2 件）→ 它只是偏低，没停工。
	haulFill(near, model.ItemIronOre, 1)
	// 远处熔炉一件没有 → 停工。

	robot := autoRobot(t, ws, model.Position{X: 15, Y: 30})
	nearDistance := ws.SurfaceDistance(robot.Position, near.Position)
	farDistance := ws.SurfaceDistance(robot.Position, far.Position)
	if nearDistance != 30 || farDistance != 40 {
		t.Fatalf("夹具距离不对: near=%d far=%d（want 30 / 40）", nearDistance, farDistance)
	}
	demands := []haulDemand{
		{buildingID: far.ID, itemID: model.ItemIronOre, quantity: 2},
		{buildingID: near.ID, itemID: model.ItemIronOre, quantity: 1},
	}
	starved := haulStarvedBuildings(ws, demands)
	if !starved[far.ID] {
		t.Fatal("远处熔炉应判定为缺料停工")
	}
	if starved[near.ID] {
		t.Fatal("近处熔炉有 1 件铁矿，不应判定为缺料停工")
	}

	toDispatchTick(core, ws)
	if robot.Haul.ToBuildingID != far.ID {
		t.Fatalf("机器人去了 %s, want 缺料停工的远处熔炉 %s", robot.Haul.ToBuildingID, far.ID)
	}
}

// 6) 绝不从生产建筑的主库存里拿它自己的原料（只认输出缓冲的成品）。
func TestAutoHaulNeverTakesRecipeInputFromProductionInventory(t *testing.T) {
	f := newAutoHaulFixture(t)
	// 熔炉主库存里放满铁矿（它自己的原料），输出缓冲为空。
	haulFill(f.smelter, model.ItemIronOre, 6)
	smelterDemand := haulDemand{buildingID: f.smelter.ID, itemID: model.ItemIronOre, quantity: 2}

	supplies := haulSupplies(f.ws, haulClaims(f.ws), "p1")
	for _, supply := range supplies {
		if supply.buildingID == f.smelter.ID {
			t.Fatalf("熔炉自己的原料被当成供给: %+v", supply)
		}
	}
	if idx := nearestHaulSupply(f.ws, supplies, smelterDemand, nil); idx >= 0 {
		t.Fatalf("缺铁料的熔炉被指派了供给: %+v", supplies[idx])
	}

	// 集成：世界里只有这座熔炉有铁矿时，机器人不会被派去取它的原料。
	// （熔炉会自己把主库存的 6 件铁矿当原料消耗掉，所以断言「没有被派去取熔炉的料」，
	// 而不是库存件数不变——原料被生产周期消耗掉才是正确行为。）
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	toDispatchTick(f.core, f.ws)
	if robot.Haul.FromBuildingID == f.smelter.ID {
		t.Fatalf("机器人被派去熔炉自己取原料: %+v", robot.Haul)
	}
	// 熔炉自己的 6 件原料必须没被搬走：要么还在，要么被它自己消耗成铁块
	// （熔炉是 1 件/批，第 1 tick 就吃掉 1 件并进入 58 tick 的生产周期，
	// 所以按「铁矿 + 铁块 + 正在生产的一批」守恒判定）。
	remaining := haulStored(f.smelter, model.ItemIronOre)
	produced := f.smelter.ExportableItemQuantity(model.ItemIronIngot)
	inFlight := 0
	for _, pending := range f.smelter.Production.PendingOutputs {
		inFlight += pending.Quantity
	}
	if remaining+produced+inFlight < 6 {
		t.Fatalf("熔炉的原料被搬走了: 剩余 %d + 已产 %d + 在产 %d < 6", remaining, produced, inFlight)
	}
	// 生产确实在推进：证明少掉的 1 件是进了生产周期，而不是被搬走。
	if f.smelter.Production.RemainingTicks == 0 && produced == 0 {
		t.Fatalf("熔炉既没产出也没进度: production=%+v", f.smelter.Production)
	}
}

// 7) 认领不超发：供给只有 4 件时，两台机器人合计认领不超过 4。
func TestAutoHaulClaimsDoNotOverbook(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 30})
	placeAutoSmelter(t, ws, "b-s1", model.Position{X: 40, Y: 20})
	placeAutoSmelter(t, ws, "b-s2", model.Position{X: 40, Y: 40})
	haulFill(depot, model.ItemIronOre, 4)
	robots := []*model.Unit{
		autoRobot(t, ws, model.Position{X: 30, Y: 28}),
		autoRobot(t, ws, model.Position{X: 30, Y: 32}),
	}
	toDispatchTick(core, ws)

	claimed := 0
	assigned := 0
	for _, robot := range robots {
		if robot.Haul.Claim == nil {
			continue
		}
		assigned++
		claimed += robot.Haul.Claim.Quantity
		if robot.Haul.Claim.Quantity > haulCargoCapacity {
			t.Fatalf("认领量 %d 超过载量 %d", robot.Haul.Claim.Quantity, haulCargoCapacity)
		}
	}
	if assigned == 0 {
		t.Fatal("没有任何机器人被派单")
	}
	if claimed > 4 {
		t.Fatalf("合计认领 %d 超过供给 4 件", claimed)
	}
	// 认领记账必须与机器人身上的 Claim 一致（读档后靠它重建）：
	// 记账按（建筑, 物品）汇总，所以两台的认领都记在同一个键上，取一次即可。
	book := haulClaims(ws)
	total := 0
	for _, robot := range robots {
		if robot.Haul.Claim == nil {
			continue
		}
		total += robot.Haul.Claim.Quantity
	}
	if got := book.supplyQuantity(depot.ID, model.ItemIronOre); got != total {
		t.Fatalf("认领记账 %d 与机器人身上的认领 %d 不一致", got, total)
	}
	// 再派一次单：供给已被认领满，不会有人再接这一批货。
	toDispatchTick(core, ws)
	for _, robot := range robots {
		if robot.Haul.Claim == nil {
			continue
		}
		if robot.Haul.Claim.Quantity > haulCargoCapacity {
			t.Fatalf("第二次派单后认领量 %d 超过载量", robot.Haul.Claim.Quantity)
		}
	}
	again := 0
	for _, robot := range robots {
		if robot.Haul.Claim != nil {
			again += robot.Haul.Claim.Quantity
		}
	}
	if again > 4 {
		t.Fatalf("第二次派单后合计认领 %d 超过供给 4 件", again)
	}
}

// 8) 端点被拆：释放认领、回到待命；车上没有货时原地待命。
func TestAutoHaulReleasesClaimWhenEndpointDemolished(t *testing.T) {
	f := newAutoHaulFixture(t)
	haulFill(f.depot, model.ItemIronOre, 40)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	toDispatchTick(f.core, f.ws)
	if robot.Haul.Claim == nil {
		t.Fatalf("机器人没有被派单: %+v", robot.Haul)
	}

	// 拆掉供给建筑：认领必须释放（其它机器人可以接手这批货）。
	demolishAutoBuilding(f.ws, f.depot.ID)
	settleTransportRobots(f.ws)
	if robot.Haul.Claim != nil {
		t.Fatalf("端点消失后认领未释放: %+v", robot.Haul.Claim)
	}
	if robot.Haul.FromBuildingID != "" || robot.Haul.ToBuildingID != "" {
		t.Fatalf("端点消失后任务未清空: %+v", robot.Haul)
	}
	if robot.Haul.Mode != model.HaulModeAuto {
		t.Fatalf("端点消失后模式被改成了 %s", robot.Haul.Mode)
	}
	// 没有供给也没有货 → 原地待命，不乱跑。
	advanceAutoTicks(f.core, f.ws, 60)
	if robot.Haul.Phase != model.HaulPhaseIdle || robot.HasPath() {
		t.Fatalf("无供给时没有原地待命: phase=%s path=%v", robot.Haul.Phase, robot.HasPath())
	}
}

// 9) 端点消失时车上带着货：优先送给另一台缺同种原料的建筑，否则送回最近仓储。
func TestAutoHaulReroutesCargoAfterEndpointLost(t *testing.T) {
	core, ws := haulTestCoreWithFace(t, 48)
	depot := placeAutoBuilding(t, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 20, Y: 30})
	first := placeAutoSmelter(t, ws, "b-s1", model.Position{X: 40, Y: 20})
	second := placeAutoSmelter(t, ws, "b-s2", model.Position{X: 40, Y: 40})
	haulFill(depot, model.ItemIronOre, 40)
	robot := autoRobot(t, ws, model.Position{X: 30, Y: 20})
	toDispatchTick(core, ws)
	if robot.Haul.ToBuildingID == "" {
		t.Fatalf("机器人没有被派单: %+v", robot.Haul)
	}
	// 让它先装上货。
	for i := 0; i < 400 && robot.Haul.CargoQuantity() == 0; i++ {
		advanceAutoTicks(core, ws, 1)
	}
	if robot.Haul.CargoQuantity() == 0 {
		t.Fatalf("机器人没装上货: %+v", robot.Haul)
	}
	target := robot.Haul.ToBuildingID
	// 拆掉目标熔炉：车上的铁矿应改送另一台缺铁料的熔炉。
	demolishAutoBuilding(ws, target)
	settleTransportRobots(ws)
	if robot.Haul.CargoQuantity() == 0 {
		t.Fatal("改派时货丢了")
	}
	if robot.Haul.ToBuildingID == "" {
		t.Fatalf("车上有货却没有改派目标: %+v", robot.Haul)
	}
	if robot.Haul.ToBuildingID != first.ID && robot.Haul.ToBuildingID != second.ID {
		t.Fatalf("改派目标 = %s, want 另一台缺铁料的熔炉", robot.Haul.ToBuildingID)
	}
	if robot.Haul.Claim == nil || robot.Haul.Claim.SupplyBuildingID != "" {
		t.Fatalf("车上带货的认领不应再有供给端: %+v", robot.Haul.Claim)
	}

	// 没有任何需求时：送回最近的仓储。
	haulFill(first, model.ItemIronOre, 8)
	haulFill(second, model.ItemIronOre, 8)
	fallback := robot.Haul.ToBuildingID
	demolishAutoBuilding(ws, fallback)
	settleTransportRobots(ws)
	if robot.Haul.Claim == nil || robot.Haul.Claim.DemandBuildingID != depot.ID {
		t.Fatalf("没有需求时没有把货送回仓储: %+v", robot.Haul)
	}
	if robot.Haul.Claim.SupplyBuildingID != "" {
		t.Fatalf("车上带货的认领不应再有供给端: %+v", robot.Haul.Claim)
	}
}

// 10) 存读档：认领与行程随单位快照持久化，读档后继续按认领派单。
func TestAutoHaulSurvivesSnapshotRoundTrip(t *testing.T) {
	f := newAutoHaulFixture(t)
	haulFill(f.depot, model.ItemIronOre, 40)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})
	toDispatchTick(f.core, f.ws)
	if robot.Haul.Claim == nil {
		t.Fatalf("机器人没有被派单: %+v", robot.Haul)
	}
	before := robot.Haul.Clone()
	clone := f.ws.Units[robot.ID].Clone()
	if clone.Haul == nil || clone.Haul.Mode != model.HaulModeAuto || clone.Haul.Claim == nil {
		t.Fatalf("克隆丢失自动模式认领: %+v", clone.Haul)
	}
	if clone.Haul.Claim.DemandBuildingID != before.Claim.DemandBuildingID || clone.Haul.Claim.SupplyBuildingID != before.Claim.SupplyBuildingID {
		t.Fatalf("克隆的认领端点不一致: %+v vs %+v", clone.Haul.Claim, before.Claim)
	}
	// 从克隆体继续跑：读档后认领仍被算进在途量，任务继续推进并送达。
	f.ws.Units[robot.ID] = clone
	book := haulClaims(f.ws)
	if got := book.demandQuantity(before.Claim.DemandBuildingID, before.Claim.ItemID); got != before.Claim.Quantity {
		t.Fatalf("读档后认领未重建: %d, want %d", got, before.Claim.Quantity)
	}
	delivered := clone.Haul.DeliveredTotal
	advanceAutoTicks(f.core, f.ws, 1500)
	if clone.Haul.DeliveredTotal <= delivered {
		t.Fatalf("读档后没有继续送达: %d -> %d", delivered, clone.Haul.DeliveredTotal)
	}
}

// 11) 模式切换：auto（出厂）→ route（haul）→ idle（stop）→ auto（auto_haul）。
func TestAutoHaulModeSwitching(t *testing.T) {
	f := newAutoHaulFixture(t)
	robot := autoRobot(t, f.ws, model.Position{X: 30, Y: 20})

	order := func(order string, payload map[string]any) model.CommandResult {
		body := map[string]any{"order": order}
		for k, v := range payload {
			body[k] = v
		}
		res, _ := execCommand(f.core, model.CmdUnitOrder, f.ws, "p1", model.Command{
			Type:    model.CmdUnitOrder,
			Target:  model.CommandTarget{EntityID: robot.ID},
			Payload: body,
		})
		return res
	}

	// auto → route
	res := order("haul", map[string]any{"from_building_id": f.depot.ID, "to_building_id": f.smelter.ID})
	if res.Status != model.StatusExecuted {
		t.Fatalf("haul: %s %s", res.Code, res.Message)
	}
	if robot.Haul.Mode != model.HaulModeRoute || robot.Haul.FromBuildingID != f.depot.ID || robot.Haul.ToBuildingID != f.smelter.ID {
		t.Fatalf("haul 未进入固定路线模式: %+v", robot.Haul)
	}
	if robot.Haul.Claim != nil {
		t.Fatalf("固定路线模式不应带认领: %+v", robot.Haul.Claim)
	}

	// route → idle
	res = order("stop", nil)
	if res.Status != model.StatusExecuted {
		t.Fatalf("stop: %s %s", res.Code, res.Message)
	}
	if robot.Haul.Mode != model.HaulModeIdle || robot.Haul.Phase != "" {
		t.Fatalf("stop 未进入待命: %+v", robot.Haul)
	}
	// 待命时即使有需求也不接自动派单。
	haulFill(f.depot, model.ItemIronOre, 40)
	advanceAutoTicks(f.core, f.ws, 40)
	if robot.Haul.ToBuildingID != "" {
		t.Fatalf("待命机器人被自动派单了: %+v", robot.Haul)
	}

	// idle → auto
	res = order("auto_haul", nil)
	if res.Status != model.StatusExecuted {
		t.Fatalf("auto_haul: %s %s", res.Code, res.Message)
	}
	if robot.Haul.Mode != model.HaulModeAuto || robot.Haul.Phase != model.HaulPhaseIdle {
		t.Fatalf("auto_haul 未回到自动模式: %+v", robot.Haul)
	}
	if robot.Stance != model.UnitStanceIdle || robot.HasPath() {
		t.Fatalf("切回自动后机器人没有停下: stance=%s path=%v", robot.Stance, robot.HasPath())
	}
	toDispatchTick(f.core, f.ws)
	if robot.Haul.ToBuildingID == "" {
		t.Fatalf("切回自动后没有被派单: %+v", robot.Haul)
	}

	// 非运输机器人：中文拒绝。
	soldier := spawnWorldTestUnit(f.ws, model.UnitTypeSoldier, "p1", model.Position{X: 31, Y: 20})
	res, _ = execCommand(f.core, model.CmdUnitOrder, f.ws, "p1", model.Command{
		Type:    model.CmdUnitOrder,
		Target:  model.CommandTarget{EntityID: soldier.ID},
		Payload: map[string]any{"order": "auto_haul"},
	})
	if res.Status == model.StatusExecuted || res.Code != model.CodeInvalidTarget {
		t.Fatalf("步兵执行 auto_haul 未被拒绝: %s %s", res.Code, res.Message)
	}
}

// 12) 性能：20 台机器人 + 50 座生产建筑下，派单 tick 的耗时可接受。
//
// 断言的是「一次派单」的墙钟耗时上限（含需求/供给扫描、打分与认领记账），
// 不是整个 tick；20 台机器人是每玩家上限，50 座生产建筑是试玩规模的产线。
// 取 5 次派单里最慢的一次（含第一次的冷启动，电力快照与寻路缓存都要现建）。
func TestAutoHaulDispatchTickBudget(t *testing.T) {
	_, ws := autoHaulPerfWorld(t)
	// 先跑到派单 tick 上，再量 5 次派单。
	for ws.Tick%haulDispatchIntervalTicks != 0 {
		ws.Tick++
	}
	slowest := time.Duration(0)
	var total time.Duration
	for i := 0; i < 5; i++ {
		start := time.Now()
		settleTransportRobots(ws)
		elapsed := time.Since(start)
		total += elapsed
		if elapsed > slowest {
			slowest = elapsed
		}
		ws.Tick += haulDispatchIntervalTicks
	}
	t.Logf("20 台机器人 + %d 座建筑的派单耗时: 最慢 %s / 平均 %s", len(ws.Buildings), slowest, total/5)
	if slowest > 500*time.Millisecond {
		t.Fatalf("派单耗时 %s 超过 500ms 上限", slowest)
	}
}

// BenchmarkAutoHaulDispatchTick 派单 tick 的基准（20 台机器人 + 50 座生产建筑）。
func BenchmarkAutoHaulDispatchTick(b *testing.B) {
	_, ws := autoHaulPerfWorld(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ws.Tick += haulDispatchIntervalTicks
		settleTransportRobots(ws)
	}
}

// autoHaulPerfWorld 搭一个 20 台自动机器人 + 50 座缺料熔炉 + 1 座满仓的世界
// （只测派单本身，不推进生产）。建筑用 findFootprintOrigin 沿固定步长散开摆放。
func autoHaulPerfWorld(tb testing.TB) (*GameCore, *model.WorldState) {
	tb.Helper()
	core, ws := haulTestCoreWithFaceTB(tb, 96)
	depot := placeAutoBuildingTB(tb, ws, "b-depot", model.BuildingTypeDepotMk1, model.Position{X: 10, Y: 10})
	haulFill(depot, model.ItemIronOre, 100000)
	for i := 0; i < 50; i++ {
		origin := model.Position{X: 30 + (i%10)*7, Y: 20 + (i/10)*7}
		smelter := placeAutoBuildingTB(tb, ws, "b-smelter-"+itoa(i), model.BuildingTypeArcSmelter, origin)
		smelter.Production.RecipeID = "smelt_iron"
		smelter.SyncStorageReserve()
	}
	for i := 0; i < maxHaulPerPlayer; i++ {
		unit := model.UnitStats(model.UnitTypeTransportRobot)
		unit.ID = ws.NextEntityID("u")
		unit.OwnerID = "p1"
		unit.Position = model.Position{X: 20 + i, Y: 12}
		ws.Units[unit.ID] = &unit
		key := model.TileKey(unit.Position.X, unit.Position.Y)
		ws.TileUnits[key] = append(ws.TileUnits[key], unit.ID)
	}
	if len(ws.Buildings) < 50 {
		tb.Fatalf("夹具不足: buildings=%d", len(ws.Buildings))
	}
	return core, ws
}

// placeAutoBuildingTB / placeAutoSmelterTB / haulTestCoreWithFaceTB 是 tb 版夹具
// （基准与测试共用同一套摆放逻辑，避免两份夹具漂移）。
func placeAutoBuildingTB(tb testing.TB, ws *model.WorldState, id string, btype model.BuildingType, origin model.Position) *model.Building {
	tb.Helper()
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		tb.Fatalf("未知建筑 %s", btype)
	}
	pos, ok := ws.FindFootprintOrigin(origin, def.Footprint, btype, "")
	if !ok {
		tb.Fatalf("找不到 %s 的落位（起点 %+v）", btype, origin)
	}
	profile := model.BuildingProfileFor(btype, 1)
	b := &model.Building{
		ID: id, Type: btype, OwnerID: "p1", Position: pos,
		Runtime: profile.Runtime, VisionRange: profile.VisionRange,
		MaxHP: profile.MaxHP, HP: profile.MaxHP, Level: 1,
	}
	b.Runtime.State = model.BuildingWorkRunning
	b.Runtime.Params.EnergyConsume = 0
	if b.Runtime.Functions.Energy != nil {
		b.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	model.InitBuildingStorage(b)
	model.InitBuildingProduction(b)
	model.InitBuildingLogisticsStation(b)
	ws.Buildings[id] = b
	if err := ws.IndexBuilding(b); err != nil {
		delete(ws.Buildings, id)
		tb.Fatalf("摆放 %s 到 %+v 失败: %v", btype, pos, err)
	}
	model.RegisterPowerGridBuilding(ws, b)
	return b
}

func placeAutoSmelterTB(tb testing.TB, ws *model.WorldState, _ model.BuildingType, pos model.Position, index int) *model.Building {
	tb.Helper()
	smelter := placeAutoBuildingTB(tb, ws, "b-smelter-"+itoa(index), model.BuildingTypeArcSmelter, pos)
	smelter.Production.RecipeID = "smelt_iron"
	smelter.SyncStorageReserve()
	return smelter
}

// haulTestCoreWithFaceTB 与 haulTestCoreWithFace 同构的 tb 版本。
func haulTestCoreWithFaceTB(tb testing.TB, faceSize int) (*GameCore, *model.WorldState) {
	tb.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "auto-haul", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		Server:      config.ServerConfig{Port: 9999},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: faceSize, ResourceDensity: 0},
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Energy = 100000
	grantAllItems(ws, "p1", 500)
	grantAllTechs(ws, "p1", "p2")
	for y := range ws.Grid {
		for x := range ws.Grid[y] {
			ws.Grid[y][x].Terrain = terrain.TileBuildable
		}
	}
	return core, ws
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := make([]byte, 0, 8)
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
