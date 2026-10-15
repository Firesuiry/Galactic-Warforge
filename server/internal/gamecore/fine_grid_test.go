package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 细分网格（§1）的规则验收：多格占地的落位/占用/拆除、外圈 IO、分拣器扫到
// 占地任一 cell、采矿机「占地 + 外圈」框选、单位不能进占地。
//
// 这些用例全部走真实入口（execBuild / settleBuildingIO / settleSorters /
// settleResources / computeUnitPath），不直接调用内部辅助函数，保证规则在
// 命令链上生效而不是只在工具函数里成立。

// fineGridCore 建一个 32 面、全平地的测试世界，p1 有执行体与足量资源。
func fineGridCore(t *testing.T) (*GameCore, *model.WorldState) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "fine-grid", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		Server:      config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 32, ResourceDensity: 0},
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Energy = 100000
	grantAllItems(ws, "p1", 500)
	grantTechs(ws, "p1",
		"basic_logistics_system", "basic_assembling_processes", "automatic_metallurgy",
		"solar_collection", "high_strength_crystal", "integrated_logistics",
		"electromagnetism")
	return core, ws
}

// flatBuildSpot 找一块整片可建、无占用的空地（保证大占地能落下）。
func flatBuildSpot(t *testing.T, ws *model.WorldState, btype model.BuildingType, origin model.Position) model.Position {
	t.Helper()
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		t.Fatalf("unknown building %s", btype)
	}
	pos, ok := ws.FindFootprintOrigin(origin, def.Footprint, btype, "")
	if !ok {
		t.Fatalf("no flat spot for %s near %+v", btype, origin)
	}
	return pos
}

// buildAndReturn 下达一次建造（走真实命令校验）并立即结算施工，返回落成的建筑。
// 不直接写 WorldState：占地/占用/地形校验必须真的跑一遍。
func buildAndReturn(t *testing.T, core *GameCore, ws *model.WorldState, btype model.BuildingType, pos model.Position) *model.Building {
	t.Helper()
	res := buildAt(t, core, ws, pos, btype)
	if res.Status != model.StatusExecuted {
		t.Fatalf("build %s at %+v failed: %s %s", btype, pos, res.Code, res.Message)
	}
	var task *model.ConstructionTask
	for _, candidate := range ws.Construction.Tasks {
		if candidate.BuildingType == btype && candidate.Position.X == pos.X && candidate.Position.Y == pos.Y {
			task = candidate
		}
	}
	if task == nil {
		t.Fatalf("build %s at %+v queued no construction task", btype, pos)
	}
	events, err := core.completeConstructionTask(ws, task)
	if err != nil {
		t.Fatalf("complete %s at %+v: %v", btype, pos, err)
	}
	// 真实结算路径（settleConstructionTasks）在完工后从队列移除任务并释放
	// 预留格；这里同样释放，否则后续在同一占地上叠放（配送器）会被自己的
	// 施工预留挡住。
	ws.Construction.Remove(task.ID)
	building := extractScenarioCreatedBuilding(events)
	if building == nil {
		t.Fatalf("complete %s at %+v produced no building", btype, pos)
	}
	return building
}

// 1) 3×3 的熔炉落位后，占地 9 格全部登记；再在同一占地内的任一格建东西会被
// 明确拒绝（不是只占锚点）。
func TestFineGridBuildIndexesWholeFootprint(t *testing.T) {
	core, ws := fineGridCore(t)
	origin := flatBuildSpot(t, ws, model.BuildingTypeArcSmelter, model.Position{X: 8, Y: 8})
	smelter := buildAndReturn(t, core, ws, model.BuildingTypeArcSmelter, origin)

	tiles, err := ws.BuildingTiles(smelter)
	if err != nil {
		t.Fatal(err)
	}
	if len(tiles) != 9 {
		t.Fatalf("3x3 smelter occupies %d tiles, want 9", len(tiles))
	}
	for _, tile := range tiles {
		if id := ws.TileBuilding[model.TileKey(tile.X, tile.Y)]; id != smelter.ID {
			t.Fatalf("footprint cell %+v not registered to %s (got %q)", tile, smelter.ID, id)
		}
		if ws.Grid[tile.Y][tile.X].BuildingID != smelter.ID {
			t.Fatalf("grid cell %+v missing BuildingID", tile)
		}
	}

	// 占地内任一格（不是锚点）再建风机必须被拒。
	inside := tiles[len(tiles)-1]
	def, _ := model.BuildingDefinitionByID(model.BuildingTypeWindTurbine)
	if ws.FootprintFits(inside, def.Footprint, model.BuildingTypeWindTurbine, "") {
		t.Fatalf("FootprintFits accepted a wind turbine on smelter cell %+v", inside)
	}
	cmd := model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Layer: "planet", Position: &inside},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res.Status == model.StatusExecuted {
		t.Fatalf("build on occupied footprint cell %+v was accepted", inside)
	}
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("expected POSITION_OCCUPIED, got %s (%s)", res.Code, res.Message)
	}

	// 拆除后 9 格全部释放。
	demolish := model.Command{
		Type:   model.CmdDemolish,
		Target: model.CommandTarget{Layer: "planet", EntityID: smelter.ID},
	}
	if res, _ := execCommand(core, model.CmdDemolish, ws, "p1", demolish); res.Status != model.StatusExecuted {
		t.Fatalf("demolish failed: %s %s", res.Code, res.Message)
	}
	// 拆除是异步作业：推进到完成。
	for i := 0; i < 2000 && ws.Buildings[smelter.ID] != nil; i++ {
		core.processTick()
	}
	for _, tile := range tiles {
		if id := ws.TileBuilding[model.TileKey(tile.X, tile.Y)]; id != "" {
			t.Fatalf("demolition left cell %+v occupied by %q", tile, id)
		}
		if ws.Grid[tile.Y][tile.X].BuildingID != "" {
			t.Fatalf("demolition left grid cell %+v indexed", tile)
		}
	}
}

// 2) 分拣器（取货端）只要扫到占地外圈的任一 cell 就算连上——包括"贴着 3×3
// 仓库的非锚点边"那种旧规则下接不上的位置。第 16 轮契约起仓储不再与皮带直连，
// 这里走真实入口：带 → 分拣器 → 仓库。
func TestFineGridSorterFeedsDepotOnAnyRingCell(t *testing.T) {
	core, ws := fineGridCore(t)
	origin := flatBuildSpot(t, ws, model.BuildingTypeDepotMk1, model.Position{X: 10, Y: 10})
	depot := buildAndReturn(t, core, ws, model.BuildingTypeDepotMk1, origin)

	ring, err := ws.BuildingRingCells(depot)
	if err != nil {
		t.Fatal(err)
	}
	facing := ws.RingFacingDirections(depot)
	// 选一个"既不在锚点所在行、也不在锚点所在列"的环格：旧实现（只看锚点四邻）
	// 永远接不到它，只有"外圈一圈 cell"规则才能把它算成输入口。
	var cell model.Position
	for _, candidate := range ring {
		if _, ok := facing[candidate]; !ok {
			continue
		}
		if candidate.Y != origin.Y && candidate.X != origin.X {
			cell = candidate
			break
		}
	}
	if cell.X == 0 && cell.Y == 0 {
		t.Fatal("no off-axis ring cell found")
	}

	// 分拣器放在该环格外侧，正面（放货端）朝仓库；背面（取货端）外侧再放一条带子。
	outward := facing[cell] // 从环格指向占地的方向
	sorterPos, _ := ws.SurfaceStep(cell, outward)
	sorter := newSorterBuilding("sorter", sorterPos)
	sorter.Rotation = model.PlanRotationForDirection(outward)
	sorter.Sorter.Range = 1
	beltPos, _ := ws.SurfaceStep(sorterPos, outward.Opposite())
	belt := newConveyorBuilding("belt", beltPos, outward)
	attachBuilding(ws, sorter)
	attachBuilding(ws, belt)

	if _, _, err := belt.Conveyor.Insert(model.ItemIronOre, 3); err != nil {
		t.Fatalf("insert belt: %v", err)
	}

	settleBuildingIO(ws)
	settleSorters(ws)

	if got := belt.Conveyor.TotalItems(); got != 2 {
		t.Fatalf("ring belt kept %d items, want 1 moved into depot", got)
	}
	if got := depot.Storage.UsedInputBuffer(); got != 1 {
		t.Fatalf("depot input buffer %d, want 1 (sorter fed the off-axis ring cell %+v)", got, cell)
	}
}

// 3) 分拣器沿方向扫到建筑占地的任一 cell 即连上，且端口按方向收敛到锚点。
func TestFineGridSorterConnectsToAnyFootprintCell(t *testing.T) {
	core, ws := fineGridCore(t)
	origin := flatBuildSpot(t, ws, model.BuildingTypeArcSmelter, model.Position{X: 12, Y: 12})
	smelter := buildAndReturn(t, core, ws, model.BuildingTypeArcSmelter, origin)

	// 取一条"扫到非锚点 cell"的方向：从熔炉右侧一列往里扫。
	target := origin
	target.X = origin.X + 2
	target.Y = origin.Y + 1 // 占地内、非锚点
	sorterPos, _ := ws.SurfaceStep(target, model.ConveyorEast)
	// 分拣器朝向 90°（背面=西、正面=东）：取货端从西侧沿轴扫，正好扫进熔炉占地。
	sorter := newSorterBuilding("sorter", sorterPos)
	sorter.Sorter.Range = 3
	attachBuilding(ws, sorter)

	links := sorterInputEndpoints(ws, sorter, sorter.Sorter)
	if len(links) != 1 || links[0].id != smelter.ID {
		t.Fatalf("sorter did not connect to smelter through footprint cell %+v: %+v", target, links)
	}
}

// 4) 采矿机覆盖「占地 + 外圈」：矿在占地外 1 格也能开采，且 3×3 占地把整簇
// 矿脉（多格）一起计入，总产速随覆盖格数增长。
func TestFineGridMinerCoversFootprintPlusRing(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Tech: model.NewPlayerTechState("p1")}

	// 在 3×3 采矿机的占地外圈放一格矿。
	addFiniteVein(ws, "r-out", "iron_ore", "c1", 4, 1, 20, 100)
	// 占地内也放一格（锚点右下方）。
	addFiniteVein(ws, "r-in", "iron_ore", "c1", 2, 2, 20, 100)

	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 1, Y: 1}, 8)
	ws.Buildings["b1"] = miner

	covered := coveredResourceNodeIDs(ws, miner)
	if len(covered) != 2 {
		t.Fatalf("miner covered %v, want both the in-footprint and ring veins", covered)
	}

	settleResources(ws)
	if got := totalStorageItems(miner.Storage); got != 16 {
		t.Fatalf("expected 2 veins x 8 = 16 ore, got %d", got)
	}
	if got := ws.Resources["r-out"].Remaining; got != 92 {
		t.Fatalf("ring vein remaining %d, want 92", got)
	}

	// 外圈之外的矿不在覆盖内：占地 3×3 起于 (1,1)，覆盖到 x/y ∈ [0,4]。
	addFiniteVein(ws, "r-far", "iron_ore", "c1", 5, 1, 20, 100)
	if ids := coveredResourceNodeIDs(ws, miner); len(ids) != 2 {
		t.Fatalf("miner covered beyond one ring: %v", ids)
	}
}

// 5) 单位不能走进建筑占地：路径必须绕行，直接指定占地内目标不可达。
func TestFineGridUnitsCannotEnterFootprint(t *testing.T) {
	core, ws := fineGridCore(t)
	origin := flatBuildSpot(t, ws, model.BuildingTypeArcSmelter, model.Position{X: 14, Y: 14})
	smelter := buildAndReturn(t, core, ws, model.BuildingTypeArcSmelter, origin)

	exec := executorForPlayer(t, ws, "p1")
	start, _ := ws.SurfaceStep(origin, model.ConveyorWest)
	start, _ = ws.SurfaceStep(start, model.ConveyorWest)
	stepUnitTo(ws, exec, start)

	tiles, _ := ws.BuildingTiles(smelter)
	for _, tile := range tiles {
		if tileWalkableForUnit(ws, tile, exec.ID) {
			t.Fatalf("unit may walk into footprint cell %+v", tile)
		}
		// 目标落在占地内时，寻路只能停在占地外的邻格，绝不停在占地里。
		path, ok := computeUnitPath(ws, start, tile, exec.ID)
		if !ok {
			continue
		}
		for _, p := range path {
			if ws.BuildingOccupies(smelter, p) {
				t.Fatalf("path to footprint cell %+v ends inside the footprint at %+v", tile, p)
			}
		}
	}

	// 绕行路径存在且不经过占地。
	dest, _ := ws.SurfaceStep(origin, model.ConveyorEast)
	dest, _ = ws.SurfaceStep(dest, model.ConveyorEast)
	dest, _ = ws.SurfaceStep(dest, model.ConveyorEast)
	path, ok := computeUnitPath(ws, start, dest, exec.ID)
	if !ok {
		t.Fatalf("no detour path from %+v to %+v", start, dest)
	}
	for _, p := range path {
		if ws.BuildingOccupies(smelter, p) {
			t.Fatalf("detour path crosses the smelter footprint at %+v", p)
		}
	}
}

// 6) 距离类数值 ×3 后，机甲手采判定半径同步放宽（bot 的移动阈值与命令校验
// 必须是同一个数，否则执行体停在判定圈外永远开不了矿）。
func TestFineGridMechaMineRangeMatchesBotThreshold(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	addFiniteVein(ws, "r1", "iron_ore", "c1", 4, 4, 20, 100)
	node := ws.Resources["r1"]
	// addFiniteVein 不写 Position，这里补上。
	node.Position = model.Position{X: 4, Y: 4}

	unit := &model.Unit{
		ID:      "u-1",
		Type:    model.UnitTypeExecutor,
		OwnerID: "p1",
		Domain:  model.UnitDomainGround,
		HP:      100,
		Mecha:   &model.MechaState{Energy: 100},
	}
	ws.Units["u-1"] = unit
	model.SyncMechaCapabilities(unit, ws.Players["p1"])
	core := &GameCore{}

	// 3 格（旧阈值 2 之外的"邻格"）必须被接受——这正是细分网格后 bot 的位置。
	unit.Position = model.Position{X: 4, Y: 1}
	cmd := model.Command{
		Type:    model.CmdMineResource,
		Target:  model.CommandTarget{Layer: "planet", EntityID: "u-1"},
		Payload: map[string]any{"resource_id": "r1", "quantity": 2},
	}
	if res, _ := core.execMineResource(ws, "p1", cmd, mineResourcePayload{ResourceID: "r1", Quantity: 2}); res.Status != model.StatusExecuted {
		t.Fatalf("mine at distance 3 rejected: %s %s", res.Code, res.Message)
	}
	unit.Mecha.Job = nil

	// 7 格超出 ×3 后的判定半径，必须拒绝。
	unit.Position = model.Position{X: 4, Y: 11}
	if res, _ := core.execMineResource(ws, "p1", cmd, mineResourcePayload{ResourceID: "r1", Quantity: 2}); res.Code != model.CodeOutOfRange {
		t.Fatalf("mine at distance 7 not rejected: %s %s", res.Code, res.Message)
	}
}

// 7) 数据层：§1.1 的占地表逐条核对（防止后续改数据时悄悄退回 1×1）。
func TestFineGridFootprintTableMatchesDesign(t *testing.T) {
	want := map[model.BuildingType][2]int{
		model.BuildingTypeBattlefieldAnalysisBase:      {5, 5},
		model.BuildingTypeMiningMachine:                {3, 3},
		model.BuildingTypeAdvancedMiningMachine:        {3, 3},
		model.BuildingTypeWaterPump:                    {3, 3},
		model.BuildingTypeOilExtractor:                 {3, 3},
		model.BuildingTypeArcSmelter:                   {3, 3},
		model.BuildingTypePlaneSmelter:                 {3, 3},
		model.BuildingTypeNegentropySmelter:            {3, 3},
		model.BuildingTypeAssemblingMachineMk1:         {3, 3},
		model.BuildingTypeAssemblingMachineMk2:         {3, 3},
		model.BuildingTypeAssemblingMachineMk3:         {3, 3},
		model.BuildingTypeRecomposingAssembler:         {3, 3},
		model.BuildingTypeMatrixLab:                    {3, 3},
		model.BuildingTypeSelfEvolutionLab:             {3, 3},
		model.BuildingTypeDepotMk1:                     {3, 3},
		model.BuildingTypeDepotMk2:                     {3, 3},
		model.BuildingTypeStorageTank:                  {3, 3},
		model.BuildingTypeSprayCoater:                  {3, 3},
		"barracks":                                     {3, 3},
		model.BuildingTypeSupplyStation:                {3, 3},
		model.BuildingTypeSolarPanel:                   {3, 3},
		model.BuildingTypeThermalPowerPlant:            {3, 3},
		model.BuildingTypeGeothermalPowerStation:       {3, 3},
		model.BuildingTypeMiniFusionPowerPlant:         {3, 3},
		model.BuildingTypeEnergyExchanger:              {3, 3},
		model.BuildingTypeSatelliteSubstation:          {3, 3},
		model.BuildingTypeWindTurbine:                  {2, 2},
		model.BuildingTypeAccumulator:                  {2, 2},
		model.BuildingTypeAccumulatorFull:              {2, 2},
		model.BuildingTypeGaussTurret:                  {2, 2},
		model.BuildingTypeMissileTurret:                {2, 2},
		model.BuildingTypeLaserTurret:                  {2, 2},
		model.BuildingTypePlasmaTurret:                 {2, 2},
		model.BuildingTypeSRPlasmaTurret:               {2, 2},
		model.BuildingTypeImplosionCannon:              {2, 2},
		model.BuildingTypeJammerTower:                  {2, 2},
		"anti_air_turret":                              {2, 2},
		"artillery_turret":                             {2, 2},
		model.BuildingTypeConveyorBeltMk1:              {1, 1},
		model.BuildingTypeConveyorBeltMk2:              {1, 1},
		model.BuildingTypeConveyorBeltMk3:              {1, 1},
		model.BuildingTypeSplitter:                     {1, 1},
		model.BuildingTypeAutomaticPiler:               {1, 1},
		model.BuildingTypeTrafficMonitor:               {1, 1},
		model.BuildingTypeSorterMk1:                    {1, 1},
		model.BuildingTypeSorterMk2:                    {1, 1},
		model.BuildingTypeSorterMk3:                    {1, 1},
		model.BuildingTypePileSorter:                   {1, 1},
		model.BuildingTypeTeslaTower:                   {1, 1},
		model.BuildingTypeWirelessPowerTower:           {1, 1},
		model.BuildingTypeSignalTower:                  {1, 1},
		model.BuildingTypeFoundation:                   {1, 1},
		model.BuildingTypePlanetaryLogisticsStation:    {5, 5},
		model.BuildingTypeInterstellarLogisticsStation: {5, 5},
		model.BuildingTypeMiniatureParticleCollider:    {5, 5},
		model.BuildingTypeRayReceiver:                  {5, 5},
		model.BuildingTypeArtificialStar:               {5, 5},
		model.BuildingTypePlanetaryShieldGenerator:     {5, 5},
		model.BuildingTypeEMRailEjector:                {5, 5},
		model.BuildingTypeVerticalLaunchingSilo:        {5, 5},
		"vehicle_factory":                              {5, 5},
		"airfield":                                     {5, 5},
		// 配送器叠在宿主仓库上，占地取宿主（§1.2）；宿主仓库是 3×3。
		model.BuildingTypeLogisticsDistributor: {3, 3},
	}
	for btype, size := range want {
		def, ok := model.BuildingDefinitionByID(btype)
		if !ok {
			t.Fatalf("building %s missing from catalog", btype)
		}
		if def.Footprint.Width != size[0] || def.Footprint.Height != size[1] {
			t.Errorf("%s footprint = %dx%d, want %dx%d", btype, def.Footprint.Width, def.Footprint.Height, size[0], size[1])
		}
	}
}

// 8) 配送器叠在宿主仓库上（§1.2）：占地取宿主的 3×3，不是数据文件里的独立值；
// 它自己不占地面格，但外圈 IO / 路线端点必须按宿主 3×3 算。
func TestFineGridDistributorTakesHostFootprint(t *testing.T) {
	core, ws := fineGridCore(t)
	origin := flatBuildSpot(t, ws, model.BuildingTypeDepotMk1, model.Position{X: 10, Y: 10})
	depot := buildAndReturn(t, core, ws, model.BuildingTypeDepotMk1, origin)
	grantTechs(ws, "p1", "distribution_logistics")

	mounted := buildAndReturn(t, core, ws, model.BuildingTypeLogisticsDistributor, origin)
	if mounted.Position.Z != 1 || mounted.Distributor == nil || mounted.Distributor.HostBuildingID != depot.ID {
		t.Fatalf("distributor did not mount on the depot: %+v", mounted)
	}

	tiles, err := ws.BuildingTiles(mounted)
	if err != nil {
		t.Fatal(err)
	}
	if len(tiles) != 9 {
		t.Fatalf("distributor footprint = %d cell, want the host depot's 3×3 = 9", len(tiles))
	}
	for _, tile := range tiles {
		if id := ws.TileBuilding[model.TileKey(tile.X, tile.Y)]; id != depot.ID {
			t.Fatalf("cell %+v registered to %q, want the host depot %s（配送器不占地面格）", tile, id, depot.ID)
		}
	}

	// 外圈 = 宿主 3×3 的一圈（3×3 外圈是 4×4 减去 9 = 7 个格，立方体面上取不到折叠）。
	ring, err := ws.BuildingRingCells(mounted)
	if err != nil {
		t.Fatal(err)
	}
	hostRing, err := ws.BuildingRingCells(depot)
	if err != nil {
		t.Fatal(err)
	}
	if len(ring) != len(hostRing) {
		t.Fatalf("distributor ring = %d cell, want the host's %d", len(ring), len(hostRing))
	}
	for _, cell := range ring {
		if ws.BuildingOccupies(mounted, cell) {
			t.Fatalf("distributor ring cell %+v is inside its own footprint", cell)
		}
	}

	// 拆掉宿主后配送器失去宿主：占地退回自身数据值，不能 panic。
	delete(ws.Buildings, depot.ID)
	if _, err := ws.BuildingTiles(mounted); err != nil {
		t.Fatalf("orphaned distributor must still resolve a footprint: %v", err)
	}
}
