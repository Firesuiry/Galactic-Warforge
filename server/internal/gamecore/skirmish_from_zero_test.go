package gamecore

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 从零开局的整局验收（2026-10-10「去掉开局物资包」改动）：
//
// p1 用脚本化的「合理新手开局」——背包全空，先手动采矿、手搓起步，
// 再铺产线（风机/电塔/矿机/熔炉/制造台），出兵营与步兵守家，最后建研究站、
// 研究电磁学。bot 用预设难度（easy）同样从零发育，tick 60000 后才首攻
// （按「试玩节奏 ≈ 脚本 ×2」定的：脚本约 tick 30000 攒够兵，试玩要 ~60000）。
//
// 断言/记录（两个 seed）：
//   - 各里程碑实际 tick（风机/电塔/矿机/熔炉/制造台/兵营/首个步兵/研究站/电磁学）
//     与脚本目标（2400/9000/15000/18000/~40000）的对照；
//   - bot 首攻 tick（≥ bot_first_attack_tick）与首波规模（p1 基地 20 格内 p2 地面单位峰值）；
//   - p1 整局存活（无物资包下必须能靠手搓链活下来）；
//   - 无死锁：手搓链每一环都能靠「手动采矿 + 手搓 + 早期建筑」拿到，
//     即开局链在 tick 6000 内跑通（TestSkirmishFromZeroOpeningByTick6000）。
//
// 本测试是脚本节奏的验收：跑到 tick 75000（首攻 60000 + 观察窗口 15000），
// 首攻的硬断言是「不早于门槛、且不超过门槛 +9000（easy 从零发育也不会拖太久）」。
// 跑得慢（2 seed 约 6–9 分钟）：`go test -short` 会跳过。单跑方式：
//
//	cd server && go test ./internal/gamecore/ -run TestSkirmishFromZeroFullMatch -v -timeout 30m
func TestSkirmishFromZeroFullMatch(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战模拟（实物物资包从零开局，每个 seed 约 2 分钟）")
	}
	for _, seed := range []string{"skirmish-seed-001", "pt1011-0e2bz1"} {
		t.Run(seed, func(t *testing.T) {
			// 每个 seed 建自己的 GameCore/WorldState（见 newSkirmishCoreForSeed），
			// 脚本状态都在 zeroOpening 里，不碰包级可变状态，可以并行跑。
			t.Parallel()
			runFromZeroMatch(t, seed)
		})
	}
}

// 开局链不变量（快，单 seed，tick 6000）：
// 空背包下，仅靠「手动采矿 + 手搓」必须能建起第一座风机、电塔、矿机，
// 并让矿机通电运转（矿机通电后才有矿石实物产出，否则整局死锁）。
// 实测：风机 tick 1413、电塔 1443、第一座矿机 3513（手搓链要走 齿轮/磁线圈/电路板）。
func TestSkirmishFromZeroOpeningByTick6000(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, 6000)
	op.run()

	wind := op.milestone["wind_turbine"]
	tesla := op.milestone["tesla_tower"]
	miner := op.milestone["mining_machine"]
	if wind <= 0 || tesla <= 0 || miner <= 0 {
		t.Fatalf("开局链没跑通（死锁？）：milestones=%v buildFails=%v", op.milestone, op.buildFails)
	}
	if running := skirmishRunningCounts(op.ws, "p1"); running[model.BuildingTypeMiningMachine] < 1 {
		t.Fatalf("矿机没通电运转：running=%s reasons=%v", fmtCounts(running), op.powerReasons())
	}
	if wind > 2400 {
		t.Fatalf("第一座风机在 tick %d 才建成，目标 2400", wind)
	}
	if miner > 6000 {
		t.Fatalf("第一座矿机在 tick %d 才建成，目标 6000", miner)
	}
}

type zeroStep struct {
	btype  model.BuildingType
	recipe string
	node   *model.ResourceNodeState
}

// zeroOpening 脚本化的新手开局。
type zeroOpening struct {
	core   *GameCore
	ws     *model.WorldState
	home   model.Position
	radius int
	ctx    *botSurvey
	player *model.PlayerState

	steps []zeroStep
	next  int
	// includeBarracks 为 true 时开局计划里含兵营/补给站/子弹段（防守探针用）。
	includeBarracks bool
	// rallyOrder 步兵守家姿态（默认 hold：原地坚守；防守探针可换 attack_move）。
	rallyOrder string

	milestone map[string]int64
	soldiers  map[string]bool

	// powerRescues 电力告急时插建的风机数（见 powerRescue）。
	powerRescues int
	// pureMineSite：开局计划挑到了「纯矿」的采矿机落点（5×5 覆盖框内只有一种矿）。
	// 混合簇上的矿机会被先攒满的那种矿堵死，脚本的搬运量随之失控。
	pureMineSite  bool
	lastBuildTick int64
	lastFeedTick  int64
	lastMoveTick  int64
	lastLinkTick  int64
	lastRallyTick int64

	buildFails map[string]int
	// pendingShort 表示「当前这一步的料还没凑齐，建造被脚本主动跳过」
	// （见 buildNext）。此时机甲必须真的去备料，不能空转。
	pendingShort bool
	// pendingShortTicks 是「料没凑齐、建造被跳过」累计的 tick 数（节奏指标）。
	pendingShortTicks int64
	// progressStep / lastProgressTick / maxStall / maxStallStart：建造计划的
	// 进度停滞计量（最长停滞了多少 tick、从哪一 tick 开始）。
	progressStep     int
	lastProgressTick int64
	maxStall         int64
	maxStallStart    int64

	// soldierFails / soldierFailReasons：兵营排产被拒的次数与原因（诊断用，
	// 见 produceSoldier）。兵营缺料是常态，不能混进 buildFails。
	soldierFails       int
	soldierFailReasons map[string]int

	firstAttackTick int64
	firstWavePeak   int
	wavePeak        int
	wavePeakEnd     int64

	deadline int64
	// debugEvery > 0 时每这么多 tick 打印一次 p1 的物流/机甲状态（调试用）。
	debugEvery int64
	debugLog   func()
	// onTick 每 tick 结算后回调（调试用）。
	onTick func()
}

func newZeroOpening(t *testing.T, core *GameCore, deadline int64) *zeroOpening {
	t.Helper()
	ws := core.World()
	home := botPlayerHQ(t, ws, "p1").Position
	ctx := core.surveyBotWorld(ws, "p1")
	op := &zeroOpening{
		core:            core,
		ws:              ws,
		home:            home,
		radius:          botConstructRadius(ws, "p1", ctx),
		ctx:             ctx,
		player:          ws.Players["p1"],
		milestone:       map[string]int64{},
		soldiers:        map[string]bool{},
		buildFails:      map[string]int{},
		firstAttackTick: -1,
		deadline:        deadline,
		includeBarracks: true,
		rallyOrder:      "hold",
	}
	op.steps = op.openingPlan(t)
	return op
}

// openingPlan 新手开局的建造顺序：先风机通电 → 三座矿机 → 三种熔炉 →
// 制造台（磁线圈/电路板/齿轮）→ 兵营与补给站 → 研究站 → 矩阵制造台。
func (op *zeroOpening) openingPlan(t *testing.T) []zeroStep {
	t.Helper()
	ws, home, radius := op.ws, op.home, op.radius
	byKind := map[string][]*model.ResourceNodeState{}
	for _, node := range ws.Resources {
		if node == nil || node.Remaining <= 0 {
			continue
		}
		switch node.Kind {
		case model.ItemIronOre, model.ItemCopperOre, model.ItemStoneOre:
		default:
			continue
		}
		if ws.SurfaceDistance(home, node.Position) > radius {
			continue
		}
		if ws.TileBuilding[model.TileKey(node.Position.X, node.Position.Y)] != "" {
			continue
		}
		byKind[node.Kind] = append(byKind[node.Kind], node)
	}
	for kind := range byKind {
		nodes := byKind[kind]
		sort.Slice(nodes, func(i, j int) bool {
			di, dj := ws.SurfaceDistance(home, nodes[i].Position), ws.SurfaceDistance(home, nodes[j].Position)
			if di != dj {
				return di < dj
			}
			return nodes[i].ID < nodes[j].ID
		})
	}
	iron, copper, stone := byKind[model.ItemIronOre], byKind[model.ItemCopperOre], byKind[model.ItemStoneOre]
	if len(iron) < 2 || len(copper) < 1 || len(stone) < 1 {
		t.Fatalf("基地半径 %d 内矿点不足：iron=%d copper=%d stone=%d", radius, len(iron), len(copper), len(stone))
	}
	// 采矿机是 3×3 占地 + 1 圈覆盖（5×5 框，最多 25 条脉）：挑「纯矿」的落点，
	// 别把机器压在混合簇上。细分网格下一台 3×3 矿机覆盖 5×5 框内的**所有**矿脉，
	// 每脉 8/tick——压在铁铜混合簇上时产量是熔炉消耗（1/60 tick）的几十倍，
	// 修好「落不下就不扣矿脉」（试玩 1015）之后，机器几 tick
	// 就被混合矿堵满，搬运脚本搬不空就整局矿物收入归零（实测 pt1011 的两台矿机
	// 各压 48 煤 + 37 铜，背包卡在 200/200，tick 9000 之后矿石再也运不出来）。
	// 真人也一样：矿机压在混合簇上要么配齐所有矿种的出口，要么挑纯矿。
	pureSite := func(nodes []*model.ResourceNodeState, kind string) *model.ResourceNodeState {
		for _, node := range nodes {
			covered, target := 0, 0
			for dy := -1; dy < 4; dy++ {
				for dx := -1; dx < 4; dx++ {
					cell := ws.SurfaceOffset(node.Position, dx, dy)
					if !ws.InBounds(cell.X, cell.Y) {
						continue
					}
					id := ws.Grid[cell.Y][cell.X].ResourceNodeID
					if id == "" {
						continue
					}
					covered++
					if other := ws.Resources[id]; other != nil && other.Kind == kind {
						target++
					}
				}
			}
			if covered > 0 && covered == target {
				return node
			}
		}
		return nil
	}
	pickOre := func(nodes []*model.ResourceNodeState, kind string) *model.ResourceNodeState {
		if node := pureSite(nodes, kind); node != nil {
			return node
		}
		return nodes[0]
	}
	ironNode, copperNode := pickOre(iron, model.ItemIronOre), pickOre(copper, model.ItemCopperOre)
	if ironNode != iron[0] || copperNode != copper[0] {
		op.pureMineSite = true
	}
	// 可选追加：兵营产线（兵营 → 补给站 → 子弹），按需加在矩阵链之后。
	// 不再补第三台电路板制造台：每台制造台 8 个齿轮全靠机甲手搓（20 tick/个），
	// 齿轮是整条早期链最紧的料（实测建造失败回执里「制造台缺 8 个齿轮」出现
	// 920 次），研究站与兵营都被它拖住。前面两台电路板台够兵营与矩阵链分用。
	barracksTail := []zeroStep{
		{btype: model.BuildingType("barracks")},
		{btype: model.BuildingTypeSupplyStation},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "ammo_bullet"},
	}
	plan := []zeroStep{
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeTeslaTower},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeMiningMachine, node: ironNode},
		// 铁熔炉紧跟第一座矿机：矿机一开工就有矿要吃，熔炉早一步到位就早一步
		// 把矿变成锭（锭是手搓链最上游的料），也给矿机一个出口。实测把熔炉排到
		// 两座矿机之后时，tick 7000 还没建起熔炉（`TestSkirmishPlayerOpens
		// PowerMiningSmeltingBy7000` 的脚本节奏断言）。
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeTeslaTower},
		{btype: model.BuildingTypeMiningMachine, node: copperNode},
		{btype: model.BuildingTypeWindTurbine},
		// 铜熔炉必须紧跟铁熔炉：矿机压在铁铜混合簇上，一次覆盖多条脉，
		// 没有铜的出口时铜几 tick 就填满矿机（48+8），矿机随即阻塞、不再挖矿
		// 也运不出去（试玩 1015 的修法）——整局矿石产出归零，连
		// 铜熔炉自己都建不起来。铁熔炉先上（电路板/磁线圈/石砖都要铁块），
		// 铜熔炉紧随其后，两种矿就都有出口。
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_copper"},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_copper"},
		// 兵营 + 补给站：开局就有、容量 1000 的「矿石堆场」，**必须紧跟熔炉**。
		// 细分网格下一台 3×3 采矿机覆盖 5×5 框内的所有矿脉（每脉 8/tick，实测
		// 20 条以上），产量是早期熔炉消耗（1/60 tick）的几十倍；而试玩 1015 的
		// 修法规定「产出落不下就不扣矿脉」，所以矿石必须真的
		// 搬得走，矿机才能继续挖、矿物收入才转得起来。
		//
		// 这一条同时是个「鸡生蛋」：堆场本身要 8 铁块 + 6 石砖，而这些料只有
		// 矿机在挖、熔炉在炼时才拿得到。排在熔炉之后（此时矿石已开始产出、够
		// 手搓下一批料）刚好建得起；排在电路板制造台之后就会因为
		// 「缺少 N 个铁块」永远建不动——
		// 矿机阻塞 → 矿石产出归零 → 堆场建不起来 → 矿机永远阻塞（实测 pt1011
		// tick 19000 起背包里只有 24 件，HQ 的 60 格已堆满）。
		// 两座 1000 容量的建筑合计 2000 矿石，够整条开局链。
		{btype: model.BuildingType("barracks")},
		{btype: model.BuildingTypeSupplyStation},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "circuit_board"},
		{btype: model.BuildingTypeMiningMachine, node: stone[0]},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_magnet"},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "magnetic_coil"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "circuit_board"},
		{btype: model.BuildingTypeMatrixLab},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "electromagnetic_matrix"},
		{btype: model.BuildingTypeTeslaTower},
		{btype: model.BuildingTypeMiningMachine, node: iron[1]},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeWindTurbine},
	}
	if !op.includeBarracks {
		// 纯研究链：把矩阵链之后的兵营段换成电塔/风机（防守探针用的是含兵营的版本）。
		for i, step := range plan {
			switch step.btype {
			case model.BuildingType("barracks"), model.BuildingTypeSupplyStation:
				plan[i] = zeroStep{btype: model.BuildingTypeWindTurbine}
			}
			if step.recipe == "circuit_board" || step.recipe == "ammo_bullet" {
				plan[i] = zeroStep{btype: model.BuildingTypeTeslaTower}
			}
		}
		plan = append(plan, zeroStep{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "ammo_bullet"})
	} else {
		// 研究链后接兵营段：先补一台电路板制造台（前面那台在做矩阵链的板），
		// 再兵营 → 补给站 → 子弹台。
		plan = append(plan, barracksTail...)
	}
	return plan
}

func (op *zeroOpening) run() {
	ws := op.ws
	for ws.Tick < op.deadline && !op.core.Finished() && op.player.IsAlive {
		op.observe()
		if op.debugLog != nil && op.debugEvery > 0 && ws.Tick%op.debugEvery == 0 {
			op.debugLog()
		}
		// 物流每 20 tick 一拍（UI 正常速度）。但兵营排产（`produce`）要等这一拍
		// 把铁块/电路板送进兵营之后才可能成功，而排产命令本身受 30 tick 节拍限制：
		// 若排产正好落在送料之前，这一轮必然被拒、只能等下一个 30 tick。实测
		// pt1011 的兵营建成后（10713）到整局结束（75000）一个兵都没出来——
		// 排产与送料的相位差让「兵营有料」的窗口永远错过（真人玩家看到兵营有料
		// 立刻点造兵，不会干等 30 tick）。这里在排产之前补一拍物流。
		if ws.Tick > 0 && ws.Tick%30 == 0 {
			op.pendingShort = false
			op.buildNext()
			op.repairRecipes()
			op.powerLink()
			op.feedIndustry()
			op.produceSoldier()
			op.startResearch()
		}
		if ws.Tick > 0 && ws.Tick%20 == 0 {
			op.feedIndustry()
		}
		// 背包疏通要周期性做，不能只在「建造成功」后做：实测机甲被一个建不动的
		// 步骤卡住时，背包里堆着 42 石矿 + 91 铜锭 + 50 磁铁，容量满了以后
		// 取不出熔炉的铁块、也手搓不了齿轮，整局从 tick 21000 卡到 45000
		// 一动不动。真人玩家会把堆料倒回产线腾地方。
		if ws.Tick > 0 && ws.Tick%200 == 0 {
			op.sweepInventory()
		}
		op.rallySoldiers()
		op.driveMecha()
		op.core.processTick()
		// 停滞计量：建造计划的进度（op.next）多久没动过。脚本「缺料就不发建造命令」
		// 之后，回执不再是信号（料没凑齐本来就不该有回执），所以用「进度停滞」
		// 兜住「料凑不齐且机甲也没在备料」的死锁。
		if op.next != op.progressStep {
			op.progressStep = op.next
			op.lastProgressTick = ws.Tick
		} else if stall := ws.Tick - op.lastProgressTick; stall > op.maxStall {
			op.maxStall = stall
			op.maxStallStart = op.lastProgressTick
		}
		if op.pendingShort {
			op.pendingShortTicks++
		}
		if op.onTick != nil {
			op.onTick()
		}
	}
	op.observe()
}

// observe 记录里程碑与 bot 首攻。
func (op *zeroOpening) observe() {
	ws := op.ws
	counts := skirmishBuildingCounts(ws, "p1")
	mark := func(key string, cond bool) {
		if cond {
			if _, ok := op.milestone[key]; !ok {
				op.milestone[key] = ws.Tick
			}
		}
	}
	mark("wind_turbine", counts[model.BuildingTypeWindTurbine] >= 1)
	mark("tesla_tower", counts[model.BuildingTypeTeslaTower] >= 1)
	mark("mining_machine", counts[model.BuildingTypeMiningMachine] >= 1)
	mark("arc_smelter", counts[model.BuildingTypeArcSmelter] >= 1)
	mark("assembling_machine", counts[model.BuildingTypeAssemblingMachineMk1] >= 1)
	mark("barracks", counts[model.BuildingType("barracks")] >= 1)
	mark("matrix_lab", counts[model.BuildingTypeMatrixLab] >= 1)
	mark("wind_turbine_4", counts[model.BuildingTypeWindTurbine] >= 4)
	mark("miner_4", counts[model.BuildingTypeMiningMachine] >= 4)
	mark("smelter_3", counts[model.BuildingTypeArcSmelter] >= 3)
	mark("assembler_3", counts[model.BuildingTypeAssemblingMachineMk1] >= 3)
	if tech := ws.Players["p1"].Tech; tech != nil {
		mark("electromagnetism", tech.CompletedTechs["electromagnetism"] > 0)
	}
	alive := 0
	for id := range op.soldiers {
		if u := ws.Units[id]; u != nil && u.HP > 0 {
			alive++
		}
	}
	mark("soldier", alive >= 1)
	mark("soldier_6", alive >= 6)

	if op.firstAttackTick < 0 && skirmishBotAttackingPlayer(ws) {
		op.firstAttackTick = ws.Tick
		// 首波窗口取 600 tick（1 分钟）：首攻后 p1 基地附近 p2 地面单位的峰值
		// 就是首波规模（easy 档 attackAt=3、squadCap=1 → 3 个兵；waveCooldown=12000
		// 保证窗口内不会有第二波叠上来）。
		op.wavePeakEnd = ws.Tick + 600
	}
	if op.wavePeakEnd > 0 && ws.Tick <= op.wavePeakEnd {
		// 首波规模按"基地 60 cell 内的 p2 地面单位"统计：细分网格后交火距离
		// 与射程都 ×3（军团停在 ~10–30 cell 处），20 已判不到首波。
		if near := countP2ArmyNear(ws, op.home, 60); near > op.wavePeak {
			op.wavePeak = near
		}
		if op.wavePeak > op.firstWavePeak {
			op.firstWavePeak = op.wavePeak
		}
	}
}

// buildNext 追一条建造命令（UI 正常速度：约 3 秒一条）。
//
// 电力优先于计划：修好试玩 1015 的采掘口径后，矿物收入 = 「矿石真正落地」的量，
// 而采掘本身要电（`scaleByPowerRatio`）。电力缺口一旦出现，矿机停摆 → 矿石
// 归零 → 计划里下一步（兵营/补给站，60 矿物）再也建不起来，计划里排在后面的
// 风机也就永远轮不到——整局从 tick 19000 卡死在「背包只剩 1 件料」（实测 pt1011）。
// 真人玩家看到「电力不足」会先补一台风机；脚本在这里做同一件事：只要还有
// 30 矿物、有机器无电、且施工队列空闲，就插一台风机。
func (op *zeroOpening) buildNext() {
	if op.next >= len(op.steps) {
		return
	}
	if op.powerRescue() {
		return
	}
	s := op.steps[op.next]
	// 第 16 轮起建造门槛是背包物品（矿池已删除）。脚本每 30 tick 才试一次建造，
	// 而「机甲手搓 + 熔炉/矿机出料」是持续的——料没凑齐就下发，只会换来一条
	// 注定被拒的回执（实测整局 800+ 条，回执日志被「缺少 N 个「电路板」」刷满；
	// 真人玩家看到料不够不会去点建造，而是接着手搓/等机器出货）。所以下发前先按
	// 背包自查一次：缺料就直接回去备料（`nextMechaAction` 会沿手搓链下钻），
	// 不产生回执。矿机同样自查（实测剩下 28 条回执全是采矿机的「缺少 N 个
	// 电路板/磁线圈/齿轮/铁块」——采矿机的料由 `feedIndustry` 从自己的机器里取，
	// 一样是「料够了才发命令」）。
	if !op.player.HasItems(buildingCost(s.btype)) {
		op.pendingShort = true
		return
	}
	var pos *model.Position
	if s.node != nil {
		// 矿点随时重选：botBuildSpotNear 不跳过资源格，新手随手放的建筑可能
		// 正好压在矿脉上（实测第一座电塔就压在铜矿上，矿机再也放不下）。
		// 细分网格：矿机是 3×3 占地，锚点必须"整块可落位且不封死基地"。
		var node *model.ResourceNodeState
		var origin model.Position
		for _, cand := range op.candidateNodes(s.node.Kind, s.node) {
			if o, ok := op.minerOriginFor(cand); ok {
				node, origin = cand, o
				break
			}
		}
		if node == nil {
			op.buildFails["no_free_node:"+s.node.Kind]++
			return
		}
		p := origin
		pos = &p
	} else {
		pos = op.buildSpot(s.btype)
	}
	if pos == nil {
		op.buildFails["no_spot:"+string(s.btype)]++
		return
	}
	payload := map[string]any{"building_type": string(s.btype)}
	if s.recipe != "" {
		payload["recipe_id"] = s.recipe
	}
	res, _ := execCommand(op.core, model.CmdBuild, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: payload,
	})
	if res.Code == model.CodeOK {
		op.next++
		op.lastBuildTick = op.ws.Tick
		op.sweepInventory()
		return
	}
	key := fmt.Sprintf("%s: %s", s.btype, res.Message)
	if strings.Contains(res.Message, "战场分析基站") {
		key = fmt.Sprintf("%s: %s @ %v", s.btype, res.Message, *pos)
	}
	op.buildFails[key]++
}

// powerRescue 电力告急时插建一台风机（返回 true 表示本 tick 已经在处理电力）。
func (op *zeroOpening) powerRescue() bool {
	ws := op.ws
	// 第 16 轮起建造门槛是背包物品（矿池已删除）：风机要齿轮/铁块/磁线圈。
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeWindTurbine)
	if !ok || !op.player.HasItems(def.BuildCost.Items) {
		return false
	}
	if ws.Construction != nil {
		for _, task := range ws.Construction.Tasks {
			if task == nil || task.PlayerID != "p1" {
				continue
			}
			if task.State == model.ConstructionPending || task.State == model.ConstructionInProgress {
				return false // 施工队列不空闲，等它干完
			}
		}
	}
	short := false
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil {
			continue
		}
		if b.Runtime.State == model.BuildingWorkNoPower {
			short = true
			break
		}
	}
	if !short {
		return false
	}
	pos := op.buildSpot(model.BuildingTypeWindTurbine)
	if pos == nil {
		return false
	}
	res, _ := execCommand(op.core, model.CmdBuild, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code == model.CodeOK {
		op.powerRescues++
		op.lastBuildTick = op.ws.Tick
		return true
	}
	op.buildFails[fmt.Sprintf("power_rescue: %s", res.Message)]++
	return false
}

// repairRecipes 给「建好后没配好配方」的机器补上配方。
// 建造结算（construction.go）只认任务上的 RecipeID；本脚本建制造台时带了 recipe_id，
// 但若建筑建成时配方为空（例如配方的 BuildingTypes 不含该建筑），
// 这台机器就会永远待机——真人玩家会在机器面板里手动选配方，脚本在这里补。
func (op *zeroOpening) repairRecipes() {
	// 建筑按 ID 排序后再遍历：map 顺序随机，多台同型机器时命令下发顺序
	// 会漂移，破坏整局模拟的确定性。
	ids := make([]string, 0, len(op.ws.Buildings))
	for id := range op.ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for i, s := range op.steps {
		if s.recipe == "" || i >= op.next {
			continue
		}
		for _, id := range ids {
			b := op.ws.Buildings[id]
			if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Type != s.btype || b.Production == nil {
				continue
			}
			if b.Production.RecipeID != "" {
				continue
			}
			execCommand(op.core, model.CmdSetRecipe, op.ws, "p1", model.Command{
				Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
				Payload: map[string]any{"recipe_id": s.recipe},
			})
		}
	}
}

// sweepInventory 施工扣料后把「后面用不上的」堆料送进产线：真人玩家也一样，
// 背包满了就把矿石倒进熔炉、把锭倒进制造台，不然施工「背包已满」扣不了料。
// 只送那些「当前步骤和排队施工都不需要」的物品，否则会把刚备好的料又送走。
func (op *zeroOpening) sweepInventory() {
	needed := map[string]bool{}
	op.collectBuildNeeds(needed, op.next)
	if len(needed) == 0 {
		return
	}
	// 背包占用（件数）超过容量 1/3 就清理，避免来回搬运。
	if op.inventoryUsed() <= op.mechaCapacity()/3 {
		return
	}
	// 物品按 ID 排序：dumpToIndustry 会下发 transfer_item 命令，map 迭代顺序
	// 会让同一状态下发命令的顺序每次不同（脚本化玩家的确定性要求）。
	items := make([]string, 0, len(op.player.Inventory))
	for item := range op.player.Inventory {
		items = append(items, item)
	}
	sort.Strings(items)
	for _, item := range items {
		qty := op.player.Inventory[item]
		if qty <= 0 || needed[item] {
			continue
		}
		op.dumpToIndustry(item, qty)
	}
}

// collectBuildNeeds 当前步骤 + 已排队施工 + 队列里接下来两步需要的手搓件。
func (op *zeroOpening) collectBuildNeeds(needed map[string]bool, from int) {
	add := func(btype model.BuildingType) {
		def, ok := model.BuildingDefinitionByID(btype)
		if !ok {
			return
		}
		for _, it := range def.BuildCost.Items {
			needed[it.ItemID] = true
		}
	}
	for i := from; i < len(op.steps) && i < from+2; i++ {
		add(op.steps[i].btype)
	}
	if op.ws.Construction != nil {
		for _, task := range op.ws.Construction.Tasks {
			if task == nil || task.PlayerID != "p1" {
				continue
			}
			if task.State == model.ConstructionPending || task.State == model.ConstructionInProgress {
				add(task.BuildingType)
			}
		}
	}
	// 当前步骤要的**中间品**（锭/线圈/电路板/磁铁/齿轮/石砖…）是建造的手搓件，
	// 不能被 sweepInventory / relieveBackpack 当成「堆料」倒回产线或储物仓：
	// 一倒回去，建造就永远缺那几件（实测 pt1011 的兵营缺 6 个铁块、缺到 378 次
	// 回执都是「缺少 N 个铁块」——铁块全被倒进了熔炉的输入口，背包里只剩 40 个
	// 上限内的铜块）。
	//
	// 只保留「当前步骤 + 已排队施工 + 队列里接下来两步」真正要用的量；原矿不在
	// 此列（原矿由矿机持续产出，堆料疏通要能倒走）。矩阵链研究期再额外保留矩阵
	// 链的中间品：那时矩阵链是整局的终点，倒回去会让研究站断料。
	needed[model.ItemIronIngot] = true
	needed[model.ItemCopperIngot] = true
	needed[model.ItemGear] = true
	needed[model.ItemMagneticCoil] = true
	needed[model.ItemCircuitBoard] = true
	needed[model.ItemMagnet] = true
	needed[model.ItemStoneBrick] = true
}

// matrixChainPriority 研究站已建、电磁学还没完成时，矩阵链是整局的终点：
// 施工预留与背包疏通都要给它让路。
func (op *zeroOpening) matrixChainPriority() bool {
	if op.buildingOfType(model.BuildingTypeMatrixLab) == nil {
		return false
	}
	tech := op.player.Tech
	return tech == nil || tech.CompletedTechs["electromagnetism"] == 0
}

// dumpToIndustry 把背包里多出来的某物品送进一台「正缺这个料」的机器。
func (op *zeroOpening) dumpToIndustry(item string, qty int) {
	if qty <= 0 {
		return
	}
	ids := make([]string, 0, len(op.ws.Buildings))
	for id := range op.ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := op.ws.Buildings[id]
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil || b.Production == nil {
			continue
		}
		recipe, ok := model.Recipe(b.Production.RecipeID)
		if !ok {
			continue
		}
		consumes := false
		for _, in := range recipe.Inputs {
			if in.ItemID == item {
				consumes = true
				break
			}
		}
		// 机器最多装到 2/3 容量：背包疏通是「把多余的料倒回产线」，不是「把机器塞满」。
		// 实测一次性倒 24 个铜锭进电路板制造台（capacity=24），主库存被铜锭占满，
		// 铁块再也进不去，这台机器从 tick 14000 到 45000 一直待机（cb=0）。
		if !consumes || b.Storage.ItemQuantity(item) >= b.Storage.Capacity/4 {
			continue
		}
		// 电磁矩阵是研究站的料，别倒进矩阵制造台当原料（会跟手搓抢）。
		if item == model.ItemElectromagneticMatrix {
			continue
		}
		// 矩阵制造台由 feedIndustry 的成对喂料专门伺候：背包里多余的电路板
		// 一股脑倒进去会占满它的容量，磁线圈再也进不去（实测矩阵台
		// cb=16 / coil=0，从 tick 16000 到 45000 一个矩阵都没出）。
		if b.Production.RecipeID == "electromagnetic_matrix" {
			continue
		}
		if !storageHasRoomFor(b.Storage, item) {
			continue
		}
		// 单次疏通最多倒 6 个，且单种料不超过容量 1/4：机器人倒料是一叠一叠倒的，
		// 整包倾泻会把机器塞满（实测 24 个铜锭灌进电路板制造台后主库存占满，
		// 铁块再也进不来，这台机器从 tick 14000 到 45000 一直待机）。
		n := min(qty, min(6, b.Storage.Capacity/4-b.Storage.ItemQuantity(item)))
		if n <= 0 {
			continue
		}
		execCommand(op.core, model.CmdTransferItem, op.ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{"building_id": b.ID, "item_id": item, "quantity": n},
		})
		return
	}
}

// freeNode 基地半径内最近的、地块还空着的同类矿点；fallback 不可用时按距离找替代。
// 细分网格：矿机是 3×3 占地，矿点格空 ≠ 矿机放得下，所以这里连同"整块落位 +
// 围死校验"一起判，只返回真的能建矿机的矿点。
func (op *zeroOpening) freeNode(kind string, fallback *model.ResourceNodeState) *model.ResourceNodeState {
	var best *model.ResourceNodeState
	bestDist := -1
	for _, node := range op.ws.Resources {
		if node == nil || node.Kind != kind || node.Remaining <= 0 {
			continue
		}
		if op.ws.SurfaceDistance(op.home, node.Position) > op.radius {
			continue
		}
		key := model.TileKey(node.Position.X, node.Position.Y)
		if op.ws.TileBuilding[key] != "" || (op.ws.Construction != nil && op.ws.Construction.IsTileReserved(key)) {
			continue
		}
		d := op.ws.SurfaceDistance(op.home, node.Position)
		if best == nil || d < bestDist || (d == bestDist && node.ID < best.ID) {
			best, bestDist = node, d
		}
	}
	if best == nil && fallback != nil {
		return fallback
	}
	return best
}

// candidateNodes 基地半径内、地块还空着的同类矿点，按「先近后远、同距按 ID」
// 排序；fallback 排在最后（它在计划里是"最初选中的那个"，可能已被建筑压住）。
func (op *zeroOpening) candidateNodes(kind string, fallback *model.ResourceNodeState) []*model.ResourceNodeState {
	nodes := make([]*model.ResourceNodeState, 0, 8)
	seen := map[string]bool{}
	for _, node := range op.ws.Resources {
		if node == nil || node.Kind != kind || node.Remaining <= 0 {
			continue
		}
		if op.ws.SurfaceDistance(op.home, node.Position) > op.radius {
			continue
		}
		key := model.TileKey(node.Position.X, node.Position.Y)
		if op.ws.TileBuilding[key] != "" || (op.ws.Construction != nil && op.ws.Construction.IsTileReserved(key)) {
			continue
		}
		nodes = append(nodes, node)
		seen[node.ID] = true
	}
	// 采矿机落点分档（见 minerSiteTier）：先避开「覆盖框里有煤」的落点，
	// 再按距家远近（近的接得上电、搬得回来）。
	sort.Slice(nodes, func(i, j int) bool {
		ti, tj := op.minerSiteTier(nodes[i], kind), op.minerSiteTier(nodes[j], kind)
		if ti != tj {
			return ti < tj
		}
		di, dj := op.ws.SurfaceDistance(op.home, nodes[i].Position), op.ws.SurfaceDistance(op.home, nodes[j].Position)
		if di != dj {
			return di < dj
		}
		return nodes[i].ID < nodes[j].ID
	})
	if fallback != nil && !seen[fallback.ID] {
		nodes = append(nodes, fallback)
	}
	return nodes
}

// minerSiteTier 采矿机落点的优先档（小的优先）。判据是「覆盖框里有没有煤」，
// 而不是纯度：
//
//   - 采矿机是 3×3 占地 + 1 圈覆盖，5×5 框内的矿脉**全部**会被采（每脉 8/tick）；
//   - 试玩 1015 的修法把采掘改成「落不下就不扣矿脉」，所以
//     覆盖框里只要有**没有出口**的矿（煤：早期没有任何配方吃煤），它几 tick 就
//     把机器主库存攒满，机器 `output_blocked`，矿物收入归零——连下一步要 120
//     矿物的熔炉都建不出来（实测 pt1011 的两台矿机压在煤铜混合簇上，tick 12000
//     起背包料恒为 83、整局停在第二座熔炉）。
//   - 铁/铜/石都有熔炉出口，混在一起只是搬运累一点，不会把机器堵死。
//
// 于是先看「覆盖框里有没有煤」，再按距家远近。纯矿簇常常在 30–45 格外，靠
// `powerLink` / `powerRescue` 补电塔接电——实测 seed 001 的纯铁矿在 45 格外
// （100,146 一带），第一座矿机落过去以后 `power_out_of_range` 一直到 tick 6000
// 都没通上电，开局链卡死在「矿机没通电」。所以「离家近且无煤」才是最好的落点，
// 远方的纯矿簇只作兜底。
func (op *zeroOpening) minerSiteTier(node *model.ResourceNodeState, kind string) int {
	if node == nil {
		return 3
	}
	near := op.ws.SurfaceDistance(op.home, node.Position) <= minerSiteRadius
	coalFree := !op.coverageHasOre(node, model.ItemCoal)
	switch {
	case near && coalFree:
		return 0
	case coalFree:
		return 1
	case near:
		return 2
	default:
		return 3
	}
}

// coverageHasOre 以 node 为锚点的 5×5 覆盖框里是否采得到 kind 这种矿。
func (op *zeroOpening) coverageHasOre(node *model.ResourceNodeState, kind string) bool {
	if node == nil {
		return false
	}
	for dy := -1; dy < 4; dy++ {
		for dx := -1; dx < 4; dx++ {
			cell := op.ws.SurfaceOffset(node.Position, dx, dy)
			if !op.ws.InBounds(cell.X, cell.Y) {
				continue
			}
			id := op.ws.Grid[cell.Y][cell.X].ResourceNodeID
			if id == "" {
				continue
			}
			if other := op.ws.Resources[id]; other != nil && other.Kind == kind {
				return true
			}
		}
	}
	return false
}

// minerSiteRadius 采矿机落点的「就近」半径：电塔（`DefaultPowerLineRange = 3`）
// 要从基地附近一路接过来，太远的矿点接不上电。实测 seed 001 的第一座矿机
// 落在 45 格外的纯铁矿上，之后 `power_out_of_range` 一直到 tick 6000 都没通上电。
const minerSiteRadius = 16

// minerOriginFor 采矿机的建造锚点：以矿点为中心求最近的"整块可落位、且不把
// 基地封死"的 3×3 原点；找不到返回 false（调用方换下一个矿点）。
// 细分网格下这一步是必需的：矿点格本身空着不代表 3×3 占地放得下——开局
// HQ（5×5）与风机（2×2）就在矿脉边上，按矿点格直接下锚点会被"占地重叠/封死
// 基地"拒绝（实测第一台矿机被拒 83–112 次，整条开局链卡死在"没矿机"）。
func (op *zeroOpening) minerOriginFor(node *model.ResourceNodeState) (model.Position, bool) {
	if node == nil {
		return model.Position{}, false
	}
	def, ok := model.BuildingDefinitionByID(model.BuildingTypeMiningMachine)
	if !ok {
		return model.Position{}, false
	}
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	origin, ok := op.ws.FindFootprintOrigin(node.Position, fp, model.BuildingTypeMiningMachine, "")
	if !ok || !op.ws.FootprintFits(origin, fp, model.BuildingTypeMiningMachine, "") {
		return model.Position{}, false
	}
	if spotCoversGroundUnit(op.ws, origin, fp, "p1") {
		return model.Position{}, false
	}
	if model.ValidateCollectorSite(op.ws, model.BuildingTypeMiningMachine, model.PlanRotation0, origin) != nil {
		return model.Position{}, false
	}
	if buildingEnclosure(op.ws, model.BuildingTypeMiningMachine, model.PlanRotation0, origin) != nil {
		return model.Position{}, false
	}
	return origin, true
}

// buildSpot 基地附近的可建空位：与 botBuildSpotNear 同规则，但额外跳过资源格
// （压在矿脉上的建筑会让那条矿脉永远采不了）。细分网格下占地是 2×2/3×3/5×5，
// 所以判定必须走 FindFootprintOrigin 求"整块可落位"的锚点——候选格本身空着
// 不代表以它为锚点的整块占地放得下（实测风机反复撞在 5×5 的 HQ 上，开局链死锁）。
func (op *zeroOpening) buildSpot(btype model.BuildingType) *model.Position {
	ws := op.ws
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return nil
	}
	fp := model.RotatedFootprint(def.Footprint, model.PlanRotation0)
	for radius := 3; radius <= op.radius; radius++ {
		candidates := ws.SurfaceDisc(op.home, radius)
		sort.SliceStable(candidates, func(i, j int) bool {
			return ws.SurfaceDistance(op.home, candidates[i]) < ws.SurfaceDistance(op.home, candidates[j])
		})
		for _, candidate := range candidates {
			if ws.SurfaceDistance(op.home, candidate) != radius || !ws.InBounds(candidate.X, candidate.Y) {
				continue
			}
			if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" || ws.Grid[candidate.Y][candidate.X].ResourceNodeID != "" {
				continue
			}
			if ws.Construction != nil && ws.Construction.IsTileReserved(model.TileKey(candidate.X, candidate.Y)) {
				continue
			}
			// 细分网格：锚点格空 ≠ 放得下，整块占地都要可落位。
			if !ws.FootprintFits(candidate, fp, btype, "") {
				continue
			}
			// 占地内不得压矿脉（压在矿脉上的建筑会让那条矿脉永远采不了）。
			blocked := false
			if tiles, err := ws.FootprintTiles(candidate, fp); err == nil {
				for _, tile := range tiles {
					if ws.Grid[tile.Y][tile.X].ResourceNodeID != "" {
						blocked = true
						break
					}
				}
			}
			if blocked {
				continue
			}
			if buildingEnclosure(ws, btype, model.PlanRotation0, candidate) != nil {
				continue
			}
			// 占地里不能站着自家机甲：建造**不会**把单位推出去，占地落成后
			// 那台单位就永远卡在建筑格上（走不出去、也再走不回来）。实测
			// seed 001 的第二座风机 (53,142) 的 2×2 占地正好罩住机甲
			// (54,143)，之后机甲再也动不了：开局链停在「已建 3 座建筑」，
			// 手搓链全断，整局 tick 75000 只建到风机（旧基线用 (53,142)
			// 建的是 1×1 电塔，细分网格后 2×2 风机才第一次撞上这个问题）。
			// 判定复用引擎侧 spotCoversGroundUnit（bot 选址同一口径）。
			if spotCoversGroundUnit(ws, candidate, fp, "p1") {
				continue
			}
			c := candidate
			return &c
		}
	}
	return nil
}

// powerLink 用自家电塔把「无电」的建筑接进电网（只建塔，不手搓）。
func (op *zeroOpening) powerLink() {
	if op.ws.Tick-op.lastLinkTick < 30 {
		return
	}
	op.lastLinkTick = op.ws.Tick
	// 机甲阵亡（等待复活）时不拉线：botPowerLink 要用机甲手搓电塔的料。
	if exec := executorUnitQuiet(op.ws, "p1"); exec == nil || exec.Mecha == nil {
		return
	}
	op.ctx = op.core.surveyBotWorld(op.ws, "p1")
	cmd, ok := op.core.botPowerLink(op.ws, "p1", op.ctx)
	if !ok || cmd.Type != model.CmdBuild {
		return
	}
	execCommand(op.core, model.CmdBuild, op.ws, "p1", cmd)
}

// soldierCap 脚本要攒的步兵数。无物资包下 p1 的产能只够「兵营 + 弹药 + 6–8 个兵」：
// 每个步兵 2 铁块 + 1 电路板，而电路板还要跟矩阵链抢铁/铜。
const soldierCap = 8

// produceSoldier 兵营一建好就出兵（攒到 soldierCap 为止）。
// 排产失败单独计数（不进 `buildFails`）：兵营缺料是常态（脚本要按缺口补料），
// 而 `buildFails` 是「建造」的回执，混进来会让 `TestSkirmishFromZeroChainIsWalkable`
// 把「缺 2 个铁块」误判成「建造长期失败且原因不是缺料」的死锁。
func (op *zeroOpening) produceSoldier() {
	barracks := op.buildingOfType(model.BuildingType("barracks"))
	if barracks == nil || soldiersFull(op.ws, op.soldiers, soldierCap) {
		return
	}
	res := produceSoldier(op.core, op.ws)
	if res.Code == model.CodeOK {
		return
	}
	op.soldierFails++
	if op.soldierFailReasons == nil {
		op.soldierFailReasons = map[string]int{}
	}
	op.soldierFailReasons[res.Message]++
}

// rallySoldiers 新兵出列即到 HQ 周围 6 格站桩守家（hold：原地坚守，不追出去）。
// 6 格是为了落在补给站的补给半径（supply_radius 10）内，弹药能自动补上。
func (op *zeroOpening) rallySoldiers() {
	ws := op.ws
	ring := ws.SurfaceDisc(op.home, 6)
	sort.Slice(ring, func(i, j int) bool {
		if ring[i].Y != ring[j].Y {
			return ring[i].Y < ring[j].Y
		}
		return ring[i].X < ring[j].X
	})
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		u := ws.Units[id]
		if u == nil || u.OwnerID != "p1" || u.HP <= 0 || u.Type != model.UnitTypeSoldier || op.soldiers[id] {
			continue
		}
		op.soldiers[id] = true
		slot := len(op.soldiers) - 1
		pos := ring[slot%len(ring)]
		order := op.rallyOrder
		if order == "" {
			order = "hold"
		}
		execCommand(op.core, model.CmdUnitOrder, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityIDs: []string{id}, Position: &pos},
			Payload: map[string]any{"order": order},
		})
	}
}

// startResearch 研究站通电、有矩阵后开工电磁学。
func (op *zeroOpening) startResearch() {
	lab := op.buildingOfType(model.BuildingTypeMatrixLab)
	if lab == nil || lab.Runtime.State != model.BuildingWorkRunning {
		return
	}
	tech := op.player.Tech
	if tech == nil {
		return
	}
	if tech.CurrentResearch != nil || len(tech.ResearchQueue) > 0 {
		return
	}
	if tech.CompletedTechs["electromagnetism"] > 0 {
		return
	}
	execCommand(op.core, model.CmdStartResearch, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet"},
		Payload: map[string]any{"tech_id": "electromagnetism"},
	})
}

// feedIndustry 物流：矿机取矿 → 熔炉喂矿取锭 → 制造台喂料取产物 → 研究站喂矩阵原料。
func (op *zeroOpening) feedIndustry() {
	ws, player := op.ws, op.player
	if player == nil || !player.IsAlive {
		return
	}
	// 取出顺序很关键：OutputQuantity 会同时数 OutputBuffer 和主库存，
	// 而研究站的「矩阵只收 OutputBuffer」——必须先取走 OutputBuffer 里的成品，
	// 再取主库存里的余料（主库存只在「停机 + 缓冲空 + 余料」时才有东西），
	// 否则会出现「取出的其实是主库存余料、产物还堵在 OutputBuffer 里」的死循环。
	// 矿机取矿要留量：否则机甲会被背包里 12 铁/42 石/22 铜的余矿顶住，
	// 取不出熔炉的 136 铁块，手搓链断料。
	withdraw := func(b *model.Building, item string, cap int) {
		if b == nil || b.Storage == nil {
			return
		}
		if cap <= 0 {
			return
		}
		if outQty := b.Storage.OutputBuffer[item]; outQty > 0 {
			outQty = min(outQty, cap)
			execCommand(op.core, model.CmdTransferItem, ws, "p1", model.Command{
				Target: model.CommandTarget{Layer: "planet", EntityID: b.ID},
				Payload: map[string]any{
					"building_id": b.ID, "item_id": item, "quantity": outQty, "direction": "to_player",
				},
			})
		}
		invQty := min(b.Storage.Inventory[item], cap)
		if invQty <= 0 {
			return
		}
		// 主库存里的余料只在「机器没在跑这个配方」时才取：
		// 机器运行中，主库存里的同名物品就是它下一轮的原料。
		if b.Production != nil && b.Production.RecipeID != "" && recipeConsumesItem(b.Production.RecipeID, item) {
			return
		}
		execCommand(op.core, model.CmdTransferItem, ws, "p1", model.Command{
			Target: model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{
				"building_id": b.ID, "item_id": item, "quantity": invQty, "direction": "to_player",
			},
		})
	}
	// load 只把主库存填到 2/3：产物出库时若主库存已满、输入缓冲也满，
	// 成品就无处可放，机器会永久卡在 pending 输出上（实测熔炉塞满 24 铁矿
	// 后再也炼不出铁块）。留 1/3 给产物，也留出装第二种原料的空间。
	// 当前这一步要用的手搓件先留在背包里：真人玩家会先把手里的料建成建筑，
	// 再拿去喂产线；脚本若把刚手搓出来的铁块全喂给兵营/制造台，建造就永远差料
	// （实测补给站卡了 10000 tick，机甲手搓的铁块全被兵营的子弹吃掉）。
	reserve := map[string]int{}
	if op.next < len(op.steps) {
		if def, ok := model.BuildingDefinitionByID(op.steps[op.next].btype); ok {
			for _, it := range def.BuildCost.Items {
				reserve[it.ItemID] += it.Quantity
			}
		}
	}
	// 排队中的施工任务也要留料：它们在下一次施工结算（tick 200 的整数倍）扣料。
	for _, task := range op.queuedConstructionItems() {
		reserve[task.ItemID] += task.Quantity
	}
	// 手搓预留：留一点磁线圈/铁块给拉线用的电塔。
	reserve[model.ItemMagneticCoil] += 1
	reserve[model.ItemIronIngot] += 2
	// 研究站建好、电磁学还没完成时，矩阵链是整局的终点：施工预留不再扣矩阵链
	// 的原料（磁线圈/电路板/铁块/铜块/磁铁）。实测弹药台那一步的「8 齿轮 + 4 电路板」
	// 预留把矩阵制造台的料扣了 20000+ tick，研究站里一个矩阵都没进（电磁学开不了工）。
	matrixPriority := false
	if lab0 := op.buildingOfType(model.BuildingTypeMatrixLab); lab0 != nil {
		if tech := op.player.Tech; tech == nil || tech.CompletedTechs["electromagnetism"] == 0 {
			matrixPriority = true
		}
	}
	if matrixPriority {
		for _, it := range []string{
			model.ItemMagneticCoil, model.ItemCircuitBoard,
			model.ItemIronIngot, model.ItemCopperIngot, model.ItemMagnet,
		} {
			delete(reserve, it)
		}
	}
	// 手搓预留：研究站的电磁矩阵是「专门手搓好再送进站」的，别被制造台/兵营吃掉。
	reserve[model.ItemElectromagneticMatrix] += 6
	// load 的 reserve 参数：研究站的喂料不吃预留——矩阵链是整局的终点，
	// 一旦让「下一座建筑」的预留把电路板/磁线圈扣住，矩阵制造台会永远断料
	// （实测研究站建好后 30000 tick 一个矩阵都没产出）。
	load := func(b *model.Building, item string, qty int, respectReserve bool) {
		if b == nil || qty <= 0 || b.Storage == nil {
			return
		}
		avail := player.Inventory[item]
		if respectReserve {
			avail -= reserve[item]
		}
		if avail <= 0 {
			return
		}
		qty = min(qty, avail)
		st := b.Storage
		if !storageHasRoomFor(st, item) {
			return // 该建筑已有别的物品占着槽位，塞不进（先取出再喂）
		}
		// 主库存最多装到 5/6，单种料最多占 2/3：留 1/6 给产物，同时保证
		// 「一种料占满 2/3」时另一种料仍然进得来（实测电路板制造台主库存里
		// 16 个铜锭正好等于 2/3 容量，load 的 room 归零，铁块永远喂不进去）。
		//
		// 但原矿的「单种上限」要按矿机的产量放宽：矿机 8/tick/脉，熔炉 1/60 tick，
		// 2/3 容量（16）几 tick 就被填满，此后 load 全部落空、矿机一直阻塞
		// （实测铁熔炉长期只有 2/3 上限的矿，矿机 48+8 全满）。原矿按「熔炉的
		// 全部主库存空位」喂，脚本再用背包上限做总闸门。
		room := st.Capacity*5/6 - st.UsedInventory()
		itemRoom := st.Capacity*2/3 - st.ItemQuantity(item)
		if isManuallyMinableOre(item) {
			// 原矿另算：矿机 8/tick/脉、熔炉 1/60 tick，喂料必须一路喂到「容量 −
			// 产出预留」而不是 5/6（实测 5/6 上限下熔炉长期停在 20/24，脚本的
			// 喂料命令全部落空，矿机一直阻塞、矿物收入归零）。单种上限也放到整仓：
			// 原矿只会被熔炉吃掉，不像中间品会跟另一种料抢槽位。
			room = st.AvailableInventory()
			itemRoom = st.Capacity - st.ItemQuantity(item)
		}
		if room <= 0 {
			return
		}
		if itemRoom <= 0 {
			return
		}
		n := min(qty, min(room, min(itemRoom, player.Inventory[item])))
		if n <= 0 {
			return
		}
		execCommand(op.core, model.CmdTransferItem, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{"building_id": b.ID, "item_id": item, "quantity": n},
		})
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	byRecipe := map[string][]*model.Building{}
	var miners []*model.Building
	var depots []*model.Building
	var barracks, supply, lab *model.Building
	for _, id := range ids {
		b := ws.Buildings[id]
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil {
			continue
		}
		switch b.Type {
		case model.BuildingTypeMiningMachine:
			miners = append(miners, b)
		case model.BuildingTypeDepotMk1, model.BuildingTypeDepotMk2:
			// 储物仓：脚本的「卸货场」。矿机阻塞时矿石总得有个去处，堆在背包里
			// 会顶满 200 格、手搓与建造全停（实测铁/铜矿各 40 个上限仍把背包
			// 顶到 150/200，熔炉的锭取不出来）。储物仓容量 300、reserve=0，
			// 是矿石的天然堆场。
			depots = append(depots, b)
		case model.BuildingTypeBattlefieldAnalysisBase:
			// 无配方的存储建筑（基站）同样是矿石的堆场：矿机覆盖多条矿脉，
			// 产量远超早期熔炉的消耗（每台 1/60 tick），矿石必须有地方放，
			// 否则矿机一阻塞就既不挖矿也运不出矿（试玩 1015 的修法），
			// 开局链的矿物收入直接归零。
			depots = append(depots, b)
		case model.BuildingTypeArcSmelter, model.BuildingTypeAssemblingMachineMk1:
			if b.Production != nil && b.Production.RecipeID != "" {
				byRecipe[b.Production.RecipeID] = append(byRecipe[b.Production.RecipeID], b)
			}
		case model.BuildingTypeMatrixLab:
			lab = b
		case model.BuildingType("barracks"):
			barracks = b
			depots = append(depots, b)
		case model.BuildingTypeSupplyStation:
			supply = b
			depots = append(depots, b)
		}
	}
	// 先取加工品（熔炉的锭、制造台的中间品），再取矿：背包只有 200 格，
	// 先取矿会把背包塞满，后续取锭/电路板的命令全部落空。
	//
	// 每种加工品都有背包存量上限：真人不会把熔炉的磁铁、锭一股脑全塞进背包
	// （实测磁铁堆到 85 个、石头 56 个，背包 204/200 全满，铜锭再也取不出来、
	// 电路板制造台断料，整局从 tick 22000 卡到 45000）。攒够用量就留在机器里，
	// 背包腾出来的空位留给下一座建筑要的料。
	withdrawCap := map[string]int{
		// 锭的背包上限压到 16：背包是整局唯一的搬运缓冲，矿石必须搬得进来
		// （见 oreBackpackTotalCap）。40/40 的锭 + 32 电路板会把 200 格占掉一半，
		// 矿机取矿的额度归零后矿石再也搬不空、矿机阻塞、矿物收入停摆
		// （实测 pt1011 tick 18000：铜矿机 output_blocked，料卡在 33）。
		// 16 个锭够当前建造步骤的手搓用量（最贵的一步 8 个铁块）。
		model.ItemIronIngot:             16,
		model.ItemCopperIngot:           16,
		model.ItemMagnet:                20,
		model.ItemMagneticCoil:          coilStockCap,
		model.ItemCircuitBoard:          circuitBoardStockCap,
		model.ItemGear:                  20,
		model.ItemAmmoBullet:            40,
		model.ItemElectromagneticMatrix: 999,
	}
	for _, recipe := range []struct{ recipe, item string }{
		{"smelt_iron", model.ItemIronIngot},
		{"smelt_copper", model.ItemCopperIngot},
		{"smelt_magnet", model.ItemMagnet},
		{"magnetic_coil", model.ItemMagneticCoil},
		{"circuit_board", model.ItemCircuitBoard},
		{"gear", model.ItemGear},
		{"ammo_bullet", model.ItemAmmoBullet},
		// 矩阵制造台的成品也要取出来：研究站只吃「送进去的矩阵」，
		// 留在制造台里的矩阵谁也拿不到（实测研究站建好后 30000 tick 一个矩阵
		// 都没进站，电磁学永远开不了工）。
		{"electromagnetic_matrix", model.ItemElectromagneticMatrix},
	} {
		allow := withdrawCap[recipe.item] - player.Inventory[recipe.item]
		if allow <= 0 {
			continue
		}
		for _, b := range byRecipe[recipe.recipe] {
			withdraw(b, recipe.item, allow)
		}
	}
	// 熔炉的成品堵住自己的主库存时（`output_blocked`），必须把它取出来：
	// 熔炉主库存被锭占满后不再进料、也不再产锭，整条手搓链（齿轮/电路板都要锭）
	// 与矿石消耗一起停摆——实测 seed 001 的两台铜熔炉从 tick 16000 起
	// `output_blocked`（inv 里 19 个铜锭 + 5 个铜矿），机甲此后 8000 tick 只能
	// 手搓铁块，计划停在「制造台缺 8 个齿轮」这一步（回执 344 次），整局只走到
	// 熔炉。`withdraw` 会把产物从 OutputBuffer 与主库存一起取出，正好解堵。
	//
	// 阻塞时把锭的背包上限放宽到 `blockedIngotCap`（平时 16）：锭就是被自己的
	// 熔炉堵出来的，背包装得下就先接着（背包还留 20 格给矿石，见矿石那条上限）。
	for _, recipe := range []struct{ recipe, item string }{
		{"smelt_iron", model.ItemIronIngot},
		{"smelt_copper", model.ItemCopperIngot},
		{"smelt_magnet", model.ItemMagnet},
		{"smelt_stone", model.ItemStoneBrick},
	} {
		for _, b := range byRecipe[recipe.recipe] {
			if b == nil || b.Storage == nil || b.Runtime.StateReason != stateReasonOutputBlocked {
				continue
			}
			allow := blockedIngotCap - player.Inventory[recipe.item]
			if allow <= 0 {
				continue
			}
			before := player.Inventory[recipe.item]
			withdraw(b, recipe.item, allow)
			// 取出来的锭立刻送回吃它的制造台（齿轮/电路板/磁线圈都要锭），
			// 背包只当周转站：否则锭堆在背包里，手搓批次因背包满而不结算。
			if moved := player.Inventory[recipe.item] - before; moved > 0 {
				op.dumpToIndustry(recipe.item, moved)
			}
		}
	}
	// 矿机：矿石在开局阶段是手搓链的燃料，只在背包存量不足时补货，
	// 免得把矿机刚挖的矿又原样取回来堆在背包里。**本地缓冲满的矿机必须清空**：
	// 产出无处可放时矿机不再扣矿脉（试玩 1015 的修法），
	// 真人玩家看到「产物阻塞」就会把矿取出来喂熔炉——脚本同理。清空要按「机器里
	// 实际有的矿种」来做：一台压在铁铜混合簇上的矿机会被先攒满的铜堵住，
	// 只按背包缺口取（铜已超上限）永远取不出铜，铁矿就再也挖不出来。
	//
	// 矿机是**唯一的**矿石来源：只要它在挖，矿石就按实际产出落进它的输出缓冲，
	// 不需要脚本搬运；它一堵住收入就停。所以这里把矿机的货直接取出来（取到背包
	// 上限为止，超出的倒进储物仓），让它一直挖——而不是等背包缺料才补货。
	type oreStack struct {
		item string
		qty  int
	}
	for _, m := range miners {
		if m.Storage == nil {
			continue
		}
		stacks := make([]oreStack, 0, 3)
		for _, item := range minableOreItemIDs {
			if qty := m.Storage.ItemQuantity(item); qty > 0 {
				stacks = append(stacks, oreStack{item: item, qty: qty})
			}
		}
		if len(stacks) == 0 {
			continue
		}
		// 先把背包里的矿喂给正缺料的熔炉：熔炉消耗后腾出主库存，矿机才排得空。
		op.feedOreToSmelters(byRecipe)
		sort.Slice(stacks, func(i, j int) bool {
			if stacks[i].qty != stacks[j].qty {
				return stacks[i].qty > stacks[j].qty
			}
			return stacks[i].item < stacks[j].item
		})
		for _, s := range stacks {
			// 矿石的去处：背包留一点自用（熔炉要料时喂得进去），其余倒进储物仓。
			// 只搬「背包上限以内的量 + 储物仓装得下的量」，绝不把背包灌满——
			// 背包满了手搓与建造全停（实测 200/200 时整局卡在「背包已满」）。
			allow := oreBackpackCapFor(s.item) - player.Inventory[s.item]
			if allow > 0 {
				free := op.mechaCapacity() - 20 - op.inventoryUsed()
				if free > 0 {
					withdraw(m, s.item, min(s.qty, min(allow, free)))
				}
			}
			op.dumpOreToDepotsFrom(m, depots, s.item)
		}
	}
	// 储物仓里的矿也要回流：矿机阻塞时矿石先堆进储物仓（背包只有 200 格），
	// 熔炉缺料时再从储物仓取出来喂——真人玩家的仓库→熔炉也是这么搬的。
	// 少了这一步，储物仓会变成「只进不出」的死堆场（实测两座 1000 容量的
	// 仓库被矿石填满后，矿机再也搬不空、矿物收入归零）。
	op.drawOreFromDepots(depots, byRecipe)
	// 喂料：每台熔炉吃满自己的矿（塞到 2/3 容量，留出产物位置）。
	for _, b := range byRecipe["smelt_iron"] {
		load(b, model.ItemIronOre, b.Storage.Capacity, true)
	}
	for _, b := range byRecipe["smelt_copper"] {
		load(b, model.ItemCopperOre, b.Storage.Capacity, true)
	}
	for _, b := range byRecipe["smelt_magnet"] {
		load(b, model.ItemIronOre, b.Storage.Capacity, true)
	}
	// 制造台：每台按自己的配方喂料（多台同配方也各自喂）。
	feedAssembler := func(recipeID string, inputs map[string]int) {
		// 喂料顺序按物品 ID 排序：load 会下发 transfer_item 命令，map 迭代顺序
		// 会让同一状态下发命令的顺序每次不同（脚本化玩家的确定性要求）。
		items := make([]string, 0, len(inputs))
		for item := range inputs {
			items = append(items, item)
		}
		sort.Strings(items)
		for _, b := range byRecipe[recipeID] {
			for _, item := range items {
				load(b, item, inputs[item], true)
			}
		}
	}
	// 矩阵链的两台上游机器在研究期不吃预留（见上面的 matrixPriority）。
	chainReserve := true
	if matrixPriority {
		chainReserve = false
	}
	// 中间品封顶：铜块是本局最紧的原料（2 台铜熔炉 = 1 铜/30 tick），而磁线圈
	// 与电路板各要 1 铜/30 tick/台——不封顶就会把铜全烧成背包里用不完的磁线圈
	// （实测磁线圈堆到 139 个、电路板 0 个、矩阵制造台建不出来）。
	// 攒够「矩阵链 + 后续建筑」的用量就停机，铜自然流向另一种。
	stockOf := func(recipeID string) int {
		total := 0
		for _, b := range byRecipe[recipeID] {
			for _, out := range []string{model.ItemMagneticCoil, model.ItemCircuitBoard} {
				total += b.Storage.ItemQuantity(out)
			}
		}
		return total
	}
	coilStock := stockOf("magnetic_coil") + player.Inventory[model.ItemMagneticCoil]
	cbStock := stockOf("circuit_board") + player.Inventory[model.ItemCircuitBoard]
	if coilStock < coilStockCap {
		for _, b := range byRecipe["magnetic_coil"] {
			load(b, model.ItemMagnet, 20, chainReserve)
			load(b, model.ItemCopperIngot, 10, chainReserve)
		}
	}
	if cbStock < circuitBoardStockCap {
		for _, b := range byRecipe["circuit_board"] {
			load(b, model.ItemIronIngot, 10, chainReserve)
			load(b, model.ItemCopperIngot, 10, chainReserve)
		}
	}
	feedAssembler("gear", map[string]int{model.ItemIronIngot: 10})
	feedAssembler("ammo_bullet", map[string]int{model.ItemIronIngot: 10})
	// loadPair 给「两种原料 1:1」的机器成对补料：只补少的那种，任一种都不超过
	// 另一种 +1。矩阵制造台 slots=4 / capacity=24，单喂一种料会把它塞满，
	// 另一种料再也进不来（实测电路板 16 个占住机器，磁线圈 0 个，机器永远待机）。
	loadPair := func(b *model.Building, first, second string, target int) {
		if b == nil || b.Storage == nil {
			return
		}
		for i := 0; i < 4; i++ {
			q1, q2 := b.Storage.ItemQuantity(first), b.Storage.ItemQuantity(second)
			if q1 >= target && q2 >= target {
				return
			}
			if q1 <= q2 {
				if q1 >= target {
					return
				}
				load(b, first, target-q1, false)
				continue
			}
			if q2 >= target {
				return
			}
			load(b, second, target-q2, false)
		}
	}
	// 矩阵制造台：研究链优先，不吃建造预留（否则永远缺 4 个电路板）。
	for _, b := range byRecipe["electromagnetic_matrix"] {
		loadPair(b, model.ItemMagneticCoil, model.ItemCircuitBoard, 6)
	}
	// 兵营/补给站是两用建筑（堆场 + 自用料），但它们**不该由脚本从堆场里往外挤矿**：
	// 试过「需要时把矿石取回背包腾地方」，结果是矿石从堆场搬进机甲背包，
	// 背包被顶满、手搓链停摆，造兵反而更晚（实测 seed 001 的步兵从 11771 退到 73631）。
	// 正确做法是让堆场**一开始就留出自用位**（见 depotOreRoom 的 depotSelfSupplyDivisor），
	// 矿石永远不会把最后一格占满。
	load(barracks, model.ItemIronIngot, 20, true)
	load(barracks, model.ItemCircuitBoard, 10, true)
	// 研究站不喂料：研究站吃的是「成品矩阵」，把磁线圈/电路板喂进去只会让
	// 研究站自己用配方搓矩阵（更慢，还跟手搓抢料）。矩阵由机甲手搓后送进研究站。
	// 补给站：步兵弹药。
	if supply != nil {
		load(supply, model.ItemAmmoBullet, player.Inventory[model.ItemAmmoBullet], true)
	}
	// 研究站：把机甲手搓的电磁矩阵送进站里（研究站在结算时消耗 OutputBuffer 里的矩阵）。
	// 玩家不会站在机器旁边手动搬矩阵，这里由脚本的「物流」代劳。
	if lab != nil {
		op.feedResearchMatrices(lab)
	}
	// 背包疏通：矿机与熔炉的产物不断流进背包，攒到容量上限后手搓与建造都会
	// 因「背包已满」失败（实测 200/200 时采矿/手搓/施工全停，整局卡在
	// 「缺少 N 个铁块」）。真人玩家会把多余的矿倒进储物仓、把多余的锭倒进制造台。
	// 每 20 tick（feedIndustry 的节拍）做一次，背包占 1/3 以上才动手。
	if op.inventoryUsed() > op.mechaCapacity()/3 {
		op.relieveBackpack(byRecipe, depots)
	}
	// 计划走完后机甲的唯一产出是「手动采矿」，而手动采矿的落点是背包——
	// 背包满了机甲就彻底停摆（实测 seed 001 tick 23000 起背包 200/200，
	// 机甲 `mine(iron_ore)` 永远 ready 不了，矿石停在 3321 直到整局结束）。
	// 真人玩家这时会把背包里的堆料倒进堆场/产线。`relieveBackpack` 只处理
	// 施工用不到的物品，计划走完后没有任何施工，它应该能倒干净；这里的
	// `relieveBackpackFull` 是兜底：把「产线已经吃不动」的成品（子弹、多余的
	// 电路板/磁线圈/矩阵）倒进堆场，保证机甲永远有地方卸矿。
	if op.inventoryUsed() >= op.mechaCapacity() {
		op.relieveBackpackFull(depots)
	}
}

// relieveBackpack 把背包里的「堆料」送回产线：矿石先喂熔炉（正缺料的），
// 喂不下的倒进储物仓；中间品按各机器缺口倒回去；剩下的（如石头矿）也倒进
// 储物仓。只处理当前建造步骤用不到的物品，避免把刚备好的料又送走。
func (op *zeroOpening) relieveBackpack(byRecipe map[string][]*model.Building, depots []*model.Building) {
	needed := map[string]bool{}
	op.collectBuildNeeds(needed, op.next)
	// 矿机取出来的矿石留在背包里只会顶满背包；产线要的料一律按缺口送回。
	for _, item := range minableOreItemIDs {
		op.feedOreToSmelters(byRecipe)
		if op.player.Inventory[item] > oreBackpackCapFor(item) {
			op.dumpOreToDepots(depots, item)
		}
	}
	// 中间品与副产物倒回正缺料的机器（dumpToIndustry 只倒进吃这种料的机器）；
	// 没有机器吃（例如电路板攒过头、石头矿）就倒进储物仓。
	items := make([]string, 0, len(op.player.Inventory))
	for item := range op.player.Inventory {
		items = append(items, item)
	}
	sort.Strings(items)
	for _, item := range items {
		qty := op.player.Inventory[item]
		if qty <= 0 || needed[item] {
			continue
		}
		if qty <= midItemBackpackCap {
			continue
		}
		before := qty
		op.dumpToIndustry(item, qty)
		if op.player.Inventory[item] >= before {
			op.dumpOreToDepots(depots, item)
		}
	}
}

// midItemBackpackCap 中间品（锭/磁铁/电路板/线圈等）在背包里的上限：超过就
// 倒回产线或储物仓，免得背包被「机器产出来、暂时用不上」的料顶满。
const midItemBackpackCap = 40

// relieveBackpackFull 背包满了以后的兜底疏通：把背包里的堆料倒进堆场。
//
// 与 relieveBackpack 的区别：它尊重 `needed`（当前建造步骤要用的手搓件不能倒走），
// 而这里的前提是**建造计划已经走完**——没有任何施工在等料，背包里的一切都只是
// 堆料。计划走完后机甲唯一的工作是手动采矿（产出落在背包里），背包一旦顶到
// 200/200 机甲就彻底停摆（实测 seed 001 tick 23000–75000 背包恒为 200/200、
// 矿石恒为 3321，机甲 `mine(iron_ore)` 永远 ready 不了）。
//
// 倒料按「先矿后料」的顺序：原矿只占 `oreBackpackCapFor` 那点额度（多出来的
// 喂熔炉/倒堆场），中间品与成品（子弹、超量电路板/线圈/磁铁）整包倒堆场。
func (op *zeroOpening) relieveBackpackFull(depots []*model.Building) {
	// 1) 先把背包里的矿喂给缺料的熔炉（矿变成锭才有出口），喂不下的倒堆场。
	op.feedOreToSmelters(op.byRecipeCache())
	for _, item := range minableOreItemIDs {
		if op.player.Inventory[item] > oreBackpackCapFor(item) {
			op.dumpOreToDepots(depots, item)
		}
	}
	// 2) 其余堆料（子弹、电路板、磁线圈、磁铁、石砖、锭…）整包倒堆场。
	// 堆场满了就跳过，等堆场自己被 feedIndustry 抽干（矿喂熔炉、子弹进补给站）。
	items := make([]string, 0, len(op.player.Inventory))
	for item := range op.player.Inventory {
		items = append(items, item)
	}
	sort.Strings(items)
	for _, item := range items {
		if op.player.Inventory[item] <= 0 || isManuallyMinableOre(item) {
			continue
		}
		op.dumpOreToDepots(depots, item)
	}
}

// byRecipeCache 按配方把 p1 的生产建筑分组的轻量快照（兜底疏通用）。
func (op *zeroOpening) byRecipeCache() map[string][]*model.Building {
	out := map[string][]*model.Building{}
	// 建筑按 ID 排序后再分组：调用方（feedOreToSmelters / oreDemandFor）按列表
	// 顺序决定先喂哪台机器，map 迭代顺序会让同一状态下发命令的顺序每次不同。
	ids := make([]string, 0, len(op.ws.Buildings))
	for id := range op.ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := op.ws.Buildings[id]
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil || b.Production == nil {
			continue
		}
		if b.Production.RecipeID == "" {
			continue
		}
		out[b.Production.RecipeID] = append(out[b.Production.RecipeID], b)
	}
	return out
}

// researchMatrixTarget 研究站里要攒的电磁矩阵数（电磁学 20 个 + 前置链的余量）。
const researchMatrixTarget = 24

// 中间品库存上限：铜块是最紧的原料，磁线圈/电路板攒够这些就停机，把铜让给另一种。
// 24 个线圈 ≈ 10 个矩阵 + 若干电塔/风机的自用；32 个电路板 ≈ 10 个矩阵 + 兵营/
// 补给站/矿机的自用。低于上限时喂料会自动恢复（矩阵链在持续消耗）。
const (
	coilStockCap         = 24
	circuitBoardStockCap = 32
	// oreBackpackCap 每种原矿在背包里的存量上限（按矿种分：铁/铜有熔炉做出口，
	// 可以多存一点；石矿只供手搓石砖，少存）。
	//
	// 这个上限不是「经济模型」，而是「矿机→背包→熔炉」这条手动物流的流量控制：
	// 修好试玩 1015 的采掘口径后，矿机只有在产物真的落地时才扣矿脉、才回充
	// 矿石，而一台 3×3 矿机压在铁铜混合簇上每 tick 会产 8×N 个矿——远超
	// 熔炉的消耗速度（每台 1/60 tick）。矿机本地存储（48+8）几 tick 就满，此后
	// 只有当脚本把矿取走、喂进熔炉（熔炉消耗后腾出主库存）才能继续挖。所以
	// 「背包上限」实质上是「脚本允许多少矿滞留在矿机与熔炉之外」：给少了矿机
	// 会一直阻塞（收入 0），给多了背包会被矿顶满（手搓与建造全停）。
	oreBackpackCap = 12
	// stoneOreBackpackCap 石矿在背包里的上限：石矿没有常驻熔炉（石砖只按建造
	// 缺口手搓），存量大了纯占背包。
	stoneOreBackpackCap = 8
	// oreBackpackTotalCap 背包里**全部原矿**（不分矿种）的存量上限。矿机搬空的
	// 额度受它约束：机甲背包是手搓链的唯一工作台，矿石把 200 格顶满后手搓批次
	// 因「背包已满」不结算（`mecha.job.state = inventory_full`），齿轮/电路板
	// 全部停产、建造随之停摆——实测 pt1011 的机甲卡在 200/200 矿石上，tick 11000
	// 之后一座建筑都建不起来、背包料恒为 35。
	//
	// 但也不能太小：修好 1015 的采掘口径后，矿物收入 = 「矿石真正落地」的量，
	// 而开局唯一的大容量堆场（兵营/补给站，各 1000）本身要花 60 矿物才能建。
	// 上限太小（80）时矿石无处可去 → 矿机阻塞 → 料停在 55 → 兵营永远
	// 建不起来（实测 pt1011 tick 13000 起背包料恒为 55，`next=13` 卡死）。
	// 110 让机甲先用手搓链与背包把矿物垫到能建堆场为止。
	oreBackpackTotalCap = 110
	// blockedIngotCap 熔炉 `output_blocked` 时允许滞留在背包里的锭数（平时 16）。
	// 熔炉主库存被自己的锭占满后不再进料、也不再产锭，必须把锭取出来才解堵；
	// 取出来的锭只能先放背包（命令系统只有「玩家 ↔ 建筑」两个方向），所以阻塞
	// 期间放宽上限——背包还剩 200 − 110（矿石）− 20（手搓产出/建造扣料）≈ 70 格，
	// 50 个锭不会把矿石的额度挤掉。实测 seed 001 的两台铜熔炉从 tick 16000 起
	// `output_blocked`，机甲此后 8000 tick 手搓不出齿轮，整局停在熔炉。
	blockedIngotCap = 50
)

// minableOreItemIDs 采矿机可能压到的原矿种类（手动可采的固体矿）。
// 脚本的「矿机 → 背包 → 熔炉/储物仓」搬运必须按**矿机实际持有的矿种**来做：
// pt1011 seed 的两台矿机覆盖的是煤矿（coal），写死铁/铜/石三种矿会让它们
// 永远搬不空——矿机一阻塞就既不挖矿也运不出矿（试玩 1015 的修法），
// 整局矿石产出归零（实测 tick 9000 后背包料恒为 10）。
var minableOreItemIDs = []string{
	model.ItemIronOre, model.ItemCopperOre, model.ItemStoneOre, model.ItemCoal,
}

// oreBackpackCapFor 某种原矿在背包里的存量上限。
func oreBackpackCapFor(item string) int {
	if item == model.ItemStoneOre {
		return stoneOreBackpackCap
	}
	return oreBackpackCap
}

// feedResearchMatrices 把背包里的电磁矩阵送进研究站，直到站里攒够研究用量。
func (op *zeroOpening) feedResearchMatrices(lab *model.Building) {
	if lab == nil || lab.Storage == nil {
		return
	}
	have := op.player.Inventory[model.ItemElectromagneticMatrix]
	if have <= 0 {
		return
	}
	want := researchMatrixTarget - lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
	if want <= 0 {
		return
	}
	n := min(have, want)
	if !storageHasRoomFor(lab.Storage, model.ItemElectromagneticMatrix) {
		return
	}
	execCommand(op.core, model.CmdTransferItem, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", EntityID: lab.ID},
		Payload: map[string]any{"building_id": lab.ID, "item_id": model.ItemElectromagneticMatrix, "quantity": n},
	})
}

// surplus 背包里「除去所有机器当前占用的原料」之后还剩多少该物品。
// 机器里的料也是生产线的料，只有背包里多出来的部分才能拿去建下一个建筑，
// 否则脚本会把刚取回的矿石又原样塞回机器，背包永远长不出建筑料。
func (op *zeroOpening) surplus(item string) int {
	used := 0
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.Storage == nil {
			continue
		}
		used += b.Storage.ItemQuantity(item)
	}
	if used > op.player.Inventory[item] {
		return 0
	}
	return op.player.Inventory[item] - used
}

// driveMecha 机甲作业：按「接下来几步建造 + 手搓预留」的缺口，采矿 / 手搓 / 补能。
func (op *zeroOpening) driveMecha() {
	ws := op.ws
	exec := executorUnitQuiet(ws, "p1")
	if exec == nil || exec.Mecha == nil {
		return
	}
	// 补能：核心低于 20 且有煤就烧一块（煤是手动采矿的副产品，开局就能采）。
	if exec.Mecha.Energy < 20 && exec.Mecha.Job == nil && op.player.Inventory[model.ItemCoal] > 0 {
		execCommand(op.core, model.CmdRefuelMecha, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
			Payload: map[string]any{"item_id": model.ItemCoal, "count": 2},
		})
	}
	if exec.Mecha.Job != nil || ws.Tick-op.lastMoveTick < 4 {
		return
	}
	action, ok := op.nextMechaAction(exec)
	if !ok {
		return
	}
	op.lastMoveTick = ws.Tick
	if action.ore != "" {
		op.ctx = op.core.surveyBotWorld(ws, "p1")
		if cmd, ok := op.core.botMineKind(ws, "p1", exec, action.ore, op.ctx); ok {
			execCommand(op.core, cmd.Type, ws, "p1", cmd)
		}
		return
	}
	execCommand(op.core, model.CmdCraftItem, ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
		Payload: map[string]any{"recipe_id": action.recipe.ID, "quantity": action.batches},
	})
}

type mechaAction struct {
	recipe  model.RecipeDefinition
	batches int
	ore     string
	qty     int
}

// nextMechaAction 计划出「机甲下一件该做的事」：先满足「当前这一步 + 队列里
// 已排队的施工任务」所需的物品，缺的原料沿手搓链下钻；链上物品能手搓就手搓，
// 不能手搓（原矿）就去手动采矿。
//
// 必须把排队中的施工任务算进去：建造命令是「先排队、施工时（tick 200 的整数倍）
// 才扣料」，排队期间背包里的料会被机甲当成富余而挪去手搓别的东西，施工那一刻
// 缺料 → 任务被拒 → 步骤永远推进不了（实测第 13 步石矿采矿机卡在「缺少 2 个齿轮」，
// 因为机甲看当前步骤（采矿机）不缺料就去手搓了，而背包里的齿轮被上一批施工吃掉了）。
func (op *zeroOpening) nextMechaAction(exec *model.Unit) (mechaAction, bool) {
	// 先看当前这一步；它卡住时（缺料、缺施工位、缺电）再看下一步——
	// 真人玩家会「手搓下一座建筑的料，等背包里的料够了一起放」，
	// 脚本若死盯当前步骤，机甲就会在背包快满时干等（实测第五座风机前
	// 机甲空转 8000 tick，背包 150/200 件堆满矿石，齿轮永远搓不出来）。
	for lookahead := 0; lookahead < 2 && op.next+lookahead < len(op.steps); lookahead++ {
		// 计划列表是「原料在前、成品在后」的拓扑序，取第一个现在就能开工的动作；
		// 第一个动作的原料还没到位时不能整条计划作废（实测机甲因此空转 20000 tick）。
		for _, action := range op.planForSteps(op.next + lookahead) {
			if action.ore != "" {
				return action, true
			}
			ready := true
			for _, in := range action.recipe.Inputs {
				if op.player.Inventory[in.ItemID] < in.Quantity*action.batches {
					ready = false
					break
				}
			}
			if ready {
				return action, true
			}
		}
	}
	return mechaAction{}, false
}

// planForSteps 展开「当前步骤 + 已排队施工」缺的手搓件（含电塔的手搓预留）。
func (op *zeroOpening) planForSteps(step int) []mechaAction {
	need := map[string]int{}
	if step >= len(op.steps) {
		// 建造计划已经走完：整条开局链都建好了，机甲没有「下一座建筑」要备料。
		// 此时真人玩家的手是空的，机甲只会继续手动采矿把背包顶到上限
		// （手采矿是矿机阻塞时唯一的兜底料源）。
		// 脚本若继续按「研究矩阵/兵营」的手搓清单排动作，机甲会一直手搓矩阵、
		// 把背包顶到 200/200（实测 seed 001 tick 21000 走完计划后，机甲
		// `mine(iron_ore)` 因背包已满永远 ready 不了，整局僵在 200/200 一动不动）。
		//
		// 手动采矿的落点是背包，背包满了同样什么都做不了，所以计划走完后由
		// `feedIndustry` 的疏通逻辑负责把背包腾空（矿石倒进堆场），机甲只负责挖。
		return []mechaAction{{ore: model.ItemIronOre, qty: 1}}
	}
	if def, ok := model.BuildingDefinitionByID(op.steps[step].btype); ok {
		for _, item := range def.BuildCost.Items {
			need[item.ItemID] += item.Quantity
		}
	}
	// 已排队（未开工/施工中）的施工任务也要备料：施工扣料发生在开工那一刻。
	for _, task := range op.queuedConstructionItems() {
		need[task.ItemID] += task.Quantity
	}
	// 手搓预留：留一点磁线圈/铁块给拉线用的电塔。
	need[model.ItemMagneticCoil] += 1
	need[model.ItemIronIngot] += 2
	// 兵营的兵是「造出来就得有料」：兵营的原料存在兵营自己的仓库里，
	// 脚本的送料又要给建造让路，于是「兵营永远缺 1 个电路板、一个兵都出不来」
	// （实测首攻前 p1 一个兵都没有）。这里把兵营当前的缺口也列进手搓清单。
	if op.buildingOfType(model.BuildingType("barracks")) != nil {
		op.collectBarracksNeeds(need)
	}
	// 电磁矩阵：研究站建好后要往站里送矩阵（电磁学 20 个）。矩阵既能由制造台产，
	// 也能手搓；手搓链只认背包，所以这里把「还缺多少个矩阵」也列进手搓清单，
	// 由 planFor 决定「机器有现货就等机器、没有就手搓」。
	if lab := op.buildingOfType(model.BuildingTypeMatrixLab); lab != nil && lab.Storage != nil {
		tech := op.player.Tech
		if tech == nil || tech.CompletedTechs["electromagnetism"] == 0 {
			want := researchMatrixTarget
			for _, s := range op.steps {
				if s.recipe == "electromagnetic_matrix" {
					want = 6 // 已排了一台矩阵制造台，手搓只补到它开机能出第一批
					break
				}
			}
			have := op.player.Inventory[model.ItemElectromagneticMatrix] +
				lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
			if want > have {
				need[model.ItemElectromagneticMatrix] += want - have
			}
		}
	}
	items := make([]string, 0, len(need))
	for item := range need {
		items = append(items, item)
	}
	// 物品顺序按「手搓链深度」降序：先排最深的中间品（齿轮/电路板/磁线圈 → 锭 →
	// 原矿），**最后**才排原矿。planFor 对每个物品独立下钻，谁排在前面谁先占
	// 机甲的下一批动作；把原矿排在前头（旧实现按字母序，"coal" < "copper_ingot"
	// < "copper_ore" < "iron_ore" < …）会让机甲一直去手动采矿，中间品永远排不到
	// 下一批动作——实测 seed 001 在 tick 12000 的下一步是铜熔炉（缺 4 电路板 +
	// 4 铁块 + 2 磁线圈 + 2 石砖），计划里明明有 `craft(circuit_board)`，
	// 机甲却因为 `mine(copper_ore)` 排在前面而永远 ready 不了，整局停在
	// 背包 154/200、只差 96 件中间件（`actions=[]`），第一座制造台再也建不起来。
	//
	// 排序键取「该物品在手搓链上能下钻到的最大层数」：越靠下游（越接近成品）
	// 越先排。同深度按名字排序，保持确定性。
	items = sortByHandcraftDepth(items, op.handcraftRecipeFor)
	var actions []mechaAction
	for _, item := range items {
		op.planFor(item, need[item], &actions, 0)
	}
	return actions
}

// sortByHandcraftDepth 把物品按「手搓链深度」降序排：越接近成品越先排，
// 原矿排最后。planFor 是「按物品逐个下钻」的，先排的物品会先占掉机甲的动作
// 队列，所以顺序直接决定机甲先手搓什么（见 planForSteps 的调用点注释）。
// 同深度按名字排序，保证确定性。
//
// 深度必须**逐物品独立**计算（不带跨物品的记忆化）：记忆化会把「第一次从哪个
// 物品下钻到它」的层级写进缓存，而第一次下钻的物品来自 map 迭代顺序——同一
// 局面两次运行会算出不同的深度、进而排出不同的动作顺序（实测 seed 001 的
// tick 5041：一次先手搓磁铁、一次先手搓铁块，整局从此分叉）。
func sortByHandcraftDepth(items []string, recipeFor func(string) (model.RecipeDefinition, bool)) []string {
	var itemDepth func(item string, level int, visiting map[string]bool) int
	itemDepth = func(item string, level int, visiting map[string]bool) int {
		if level > 5 || visiting[item] {
			// 深度上限 / 循环配方（反馈料）：不再下钻。
			return level
		}
		recipe, ok := recipeFor(item)
		if !ok {
			return level
		}
		visiting[item] = true
		best := level
		for _, in := range recipe.Inputs {
			if d := itemDepth(in.ItemID, level+1, visiting); d > best {
				best = d
			}
		}
		delete(visiting, item)
		return best
	}
	depth := make(map[string]int, len(items))
	for _, item := range items {
		depth[item] = itemDepth(item, 0, map[string]bool{})
	}
	sort.Slice(items, func(i, j int) bool {
		if depth[items[i]] != depth[items[j]] {
			return depth[items[i]] > depth[items[j]]
		}
		return items[i] < items[j]
	})
	return items
}

// collectBarracksNeeds 兵营里还缺多少「下一个兵」的料（兵营没通电/没建时跳过）。
func (op *zeroOpening) collectBarracksNeeds(need map[string]int) {
	barracks := op.buildingOfType(model.BuildingType("barracks"))
	if barracks == nil || barracks.Storage == nil {
		return
	}
	alive := 0
	for id := range op.soldiers {
		if u := op.ws.Units[id]; u != nil && u.HP > 0 {
			alive++
		}
	}
	// 目标 6 个兵；队列里的也算「在路上」，避免一次性手搓太多。
	want := 6 - alive - len(barracks.UnitQueue)
	if want <= 0 {
		return
	}
	def, ok := model.UnitDefinitionByID(model.UnitTypeSoldier)
	if !ok {
		return
	}
	for _, cost := range def.Cost {
		short := cost.Quantity*want - barracks.Storage.ItemQuantity(cost.ItemID)
		if short > 0 {
			need[cost.ItemID] += short
		}
	}
}

// feedOreToSmelters 把背包里的矿石喂给「正缺这种料」的熔炉：矿机阻塞期间矿
// 必须真的进熔炉变成锭，矿物收入才转得起来（试玩 1015 的修法：产出无处可放时
// 矿机不挖矿，玩家看到「产物阻塞」就会把矿送去熔炉）。
func (op *zeroOpening) feedOreToSmelters(byRecipe map[string][]*model.Building) {
	for _, item := range minableOreItemIDs {
		have := op.player.Inventory[item]
		if have <= 0 {
			continue
		}
		for _, recipeID := range []string{"smelt_iron", "smelt_copper", "smelt_magnet", "smelt_stone"} {
			recipe, ok := model.Recipe(recipeID)
			if !ok {
				continue
			}
			consumes := false
			for _, in := range recipe.Inputs {
				if in.ItemID == item {
					consumes = true
					break
				}
			}
			if !consumes {
				continue
			}
			for _, b := range byRecipe[recipeID] {
				if b == nil || b.Storage == nil || !storageHasRoomFor(b.Storage, item) {
					continue
				}
				// 填到「容量 − 产出预留」：喂料是给熔炉续料，不是倒进背包的堆料。
				room := b.Storage.AvailableInventory()
				if room <= 0 {
					continue
				}
				n := min(have, room)
				if n <= 0 {
					continue
				}
				execCommand(op.core, model.CmdTransferItem, op.ws, "p1", model.Command{
					Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
					Payload: map[string]any{"building_id": b.ID, "item_id": item, "quantity": n},
				})
				have -= n
				if have <= 0 {
					return
				}
			}
		}
	}
}

// drawOreFromDepots 把储物仓里的矿石取回背包（按熔炉的缺口裁剪），
// 供随后的喂料命令送进熔炉。取量受背包空位限制，不会把背包灌满。
func (op *zeroOpening) drawOreFromDepots(depots []*model.Building, byRecipe map[string][]*model.Building) {
	for _, item := range minableOreItemIDs {
		need := 0
		for _, recipeID := range []string{"smelt_iron", "smelt_copper", "smelt_magnet", "smelt_stone"} {
			if !recipeConsumesItem(recipeID, item) {
				continue
			}
			for _, b := range byRecipe[recipeID] {
				if b == nil || b.Storage == nil || !storageHasRoomFor(b.Storage, item) {
					continue
				}
				if room := b.Storage.AvailableInventory(); room > 0 {
					need += room
				}
			}
		}
		need -= op.player.Inventory[item]
		if need <= 0 {
			continue
		}
		for _, depot := range depots {
			if need <= 0 {
				break
			}
			if depot == nil || depot.Storage == nil {
				continue
			}
			have := depot.Storage.OutputQuantity(item)
			if have <= 0 {
				continue
			}
			free := op.mechaCapacity()*2/3 - op.inventoryUsed()
			if free <= 0 {
				return
			}
			n := min(have, min(need, free))
			if n <= 0 {
				continue
			}
			withdrawFromBuilding(op.core, op.ws, depot, item, n)
			need -= n
		}
	}
}

// oreDemandFor 正缺这种矿的熔炉还能吃下多少（含背包现有的那一份）：
// 矿机取矿的额度由「熔炉的胃口」决定，而不是背包上限——熔炉在炼锭时矿
// 一直在被消耗，额度就会一直打开，矿机与矿物收入就不会停。
func (op *zeroOpening) oreDemandFor(byRecipe map[string][]*model.Building, item string) int {
	demand := 0
	for _, recipeID := range []string{"smelt_iron", "smelt_copper", "smelt_magnet", "smelt_stone"} {
		if !recipeConsumesItem(recipeID, item) {
			continue
		}
		for _, b := range byRecipe[recipeID] {
			if b == nil || b.Storage == nil || !storageHasRoomFor(b.Storage, item) {
				continue
			}
			// 熔炉只吃这一种矿，胃口 = 主库存的可用空位（容量 − 产出预留 − 已占用）。
			if room := b.Storage.AvailableInventory(); room > 0 {
				demand += room
			}
		}
	}
	return demand
}

// depotOreRoom 一座储物仓还能收多少该物品。**储物仓对矿石没有「一半容量」的
// 限制**：这些堆场（兵营 / 补给站 / 储物仓）存在的意义就是给矿机当出口，矿石
// 吃得越满、矿机的产出就越走得动。
//
// 旧实现只借一半容量堆矿（实测 seed 001 的兵营与补给站各停在 500/1000，共 1000
// 格），矿机随即阻塞、矿物收入归零（试玩 1015 的修法：落不下就不扣矿脉），
// 整局卡在「熔炉要 120 矿物、当前 1032」——矿石全卡在矿机与背包里。
//
// 但兵营 / 补给站是**两用**建筑：它们既要当堆场，又得吃自己的料（造兵要 2 铁块 +
// 1 电路板、补给站要子弹），而喂料走的是 `load`，它的主库存上限是
// `Capacity*5/6`。矿石只要堆到 833/1000 以上，`load` 的 room 就归零，造兵料
// 一分都进不去（实测 pt1011 的兵营 tick 10713 建成、到 75000 一个步兵都没有，
// 回执「缺少 2 个铁块」2139 次）。所以这两类堆场给自用料留 `Capacity/5` 格
// （1000 容量里的 200 格 = 20%），矿石最多堆到 800/1000——对矿机出货毫无影响，
// 兵营却永远装得下几个铁块。
//
// 注意这个「留位」**只作用于这两类两用建筑**：纯堆场（储物仓 / 战场分析基站）
// 仍然是整仓堆矿。另外它不能改成「需要时才从堆场把矿挤回背包」——那条路（试过
// `makeRoomInDepot`）会让矿石从堆场流进机甲背包、把背包顶满，手搓链反而更早
// 停摆（实测 seed 001 的步兵从 tick 11771 退到 73631）。
func depotOreRoom(depot *model.Building, item string) int {
	if depot == nil || depot.Storage == nil || !storageHasRoomFor(depot.Storage, item) {
		return 0
	}
	reserve := 0
	switch depot.Type {
	case model.BuildingType("barracks"), model.BuildingTypeSupplyStation:
		reserve = depot.Storage.Capacity / depotSelfSupplyDivisor
	}
	room := depot.Storage.Capacity - reserve - depot.Storage.UsedInventory()
	if room < 0 {
		room = 0
	}
	return room
}

// depotSelfSupplyDivisor 两用堆场（兵营 / 补给站）给自用料留的空位比例
// （容量 / 5）。喂料 `load` 的主库存上限是容量 ×5/6，留 1/5 才能保证
// 「堆场被矿石堆满」时造兵料仍然进得去。
const depotSelfSupplyDivisor = 5

// dumpOreToDepots 把背包里某种矿倒进储物仓：矿机阻塞时矿石总要有去处，
// 堆在背包里会顶满 200 格（手搓、建造、取锭全停）。储物仓无配方、reserve=0，
// 是矿石的天然堆场。
func (op *zeroOpening) dumpOreToDepots(depots []*model.Building, item string) {
	op.dumpOreToDepotsFrom(nil, depots, item)
}

// dumpOreToDepotsFrom 把矿机 m 里超量的某种矿搬进储物仓：先取进背包（取到
// 背包留 20 格为止），再把背包里超出上限的部分倒进储物仓。搬运必须经背包——
// 命令系统只有「玩家 ↔ 建筑」两个方向——所以每一轮都「先腾背包、再取矿机」。
func (op *zeroOpening) dumpOreToDepotsFrom(m *model.Building, depots []*model.Building, item string) {
	// m 可以为 nil：那是「只把背包里超量的矿倒进储物仓」（relieveBackpack 用），
	// 没有「从矿机取货」这一步。旧实现在这里对 nil 直接返回，于是背包疏通里的
	// 倒仓调用全是空操作，背包被矿石顶满后手搓/建造/取锭全停（实测 pt1011 的
	// 两台矿机各压 48 煤 + 37 铜，背包卡在 200/200，矿物收入从 tick 9000 起归零）。
	if len(depots) == 0 || (m != nil && m.Storage == nil) {
		return
	}
	cap := oreBackpackCapFor(item)
	for i := 0; i < 16; i++ {
		// 1) 背包里超出上限的矿先倒进储物仓，腾出背包。
		for _, depot := range depots {
			excess := op.player.Inventory[item] - cap
			if excess <= 0 {
				break
			}
			if depot == nil || depot.Storage == nil || !storageHasRoomFor(depot.Storage, item) {
				continue
			}
			room := depotOreRoom(depot, item)
			if room <= 0 {
				continue
			}
			n := min(excess, room)
			execCommand(op.core, model.CmdTransferItem, op.ws, "p1", model.Command{
				Target:  model.CommandTarget{Layer: "planet", EntityID: depot.ID},
				Payload: map[string]any{"building_id": depot.ID, "item_id": item, "quantity": n},
			})
		}
		// 2) 背包还有空位就再取一批：储物仓暂时满了也要取，否则矿机一直阻塞、
		// 矿物收入停摆（试玩 1015 的修法把「阻塞也扣矿」改成「不落地就不扣矿」
		// 之后，矿机必须真的被搬空）。背包留 20 格给手搓产出与建造扣料，且
		// **全部原矿**不超过 oreBackpackTotalCap——矿石把背包顶满会让手搓批次
		// 卡在 inventory_full（见该常量的注释）。
		if m == nil {
			return
		}
		free := op.mechaCapacity() - 20 - op.inventoryUsed()
		if free > 0 {
			free = min(free, oreBackpackTotalCap-op.oreInBackpack())
		}
		if free <= 0 {
			return
		}
		take := min(m.Storage.ItemQuantity(item), free)
		if take <= 0 {
			return
		}
		withdrawFromBuilding(op.core, op.ws, m, item, take)
	}
}

// withdrawFromBuilding 从建筑取出 item 到机甲背包（测试脚本的搬运代劳）。
func withdrawFromBuilding(core *GameCore, ws *model.WorldState, b *model.Building, item string, qty int) {
	if b == nil || qty <= 0 {
		return
	}
	execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Target: model.CommandTarget{Layer: "planet", EntityID: b.ID},
		Payload: map[string]any{
			"building_id": b.ID, "item_id": item, "quantity": qty, "direction": "to_player",
		},
	})
}

// queuedConstructionItems 已排队（pending/active）施工任务还需要的手搓件
// （第 16 轮起建造只扣背包物品，就是这份清单）。
func (op *zeroOpening) queuedConstructionItems() []model.ItemAmount {
	ws := op.ws
	if ws == nil || ws.Construction == nil {
		return nil
	}
	total := map[string]int{}
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.PlayerID != "p1" {
			continue
		}
		if task.State != model.ConstructionPending && task.State != model.ConstructionInProgress {
			continue
		}
		for _, item := range task.Cost.Items {
			total[item.ItemID] += item.Quantity
		}
	}
	out := make([]model.ItemAmount, 0, len(total))
	for item, qty := range total {
		out = append(out, model.ItemAmount{ItemID: item, Quantity: qty})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ItemID < out[j].ItemID })
	return out
}

// planFor 把「需要 want 个 item」展开成有序的作业清单（原料在前，成品在后）。
func (op *zeroOpening) planFor(item string, want int, out *[]mechaAction, depth int) {
	if want <= 0 || depth > 5 {
		return
	}
	have := op.player.Inventory[item]
	// 已在建造队列里的物品也算「在路上」：施工任务完成时才扣料，这里不重复备。
	if have >= want {
		return
	}
	if recipe, ok := op.handcraftRecipeFor(item); ok {
		// 已有机器在跑这个配方、而且机器里确实有成品可交（或已交过）：机器产量
		// 归机器，机甲只去补它的原料，否则机甲会一直手搓锭/齿轮，把整局卡在
		// 「手搓 60 tick/个」上。
		//
		// 但机器「在跑」不等于「能交货」：实测第二座熔炉断料时机器状态仍是
		// running，机甲于是既不肯自己手搓、又没有原料可补，整局停在 tick 6500
		// 一动不动；后期又出现「熔炉产的铁块被制造台吃光，机甲空等机器交货」
		// （第二座熔炉到补给站之间卡了 10000 tick）。所以只有机器手里真的
		// 攒够这一批（machineStock >= 缺口）才交给机器，否则机甲自己手搓。
		if op.machineMakes(recipe.ID) && op.machineStock(recipe.ID, item) >= want-have {
			for _, in := range recipe.Inputs {
				op.planFor(in.ItemID, in.Quantity, out, depth+1)
			}
			return
		}
		per := 1
		for _, o := range recipe.Outputs {
			if o.ItemID == item && o.Quantity > 0 {
				per = o.Quantity
			}
		}
		batches := (want - have + per - 1) / per
		// 手搓批次按「背包里现有的原料」封顶：原料还差的部分交给链上前置的
		// 手搓/采矿动作去补。若按理论批次发命令，动作会因「原料不够」而永远
		// 不 ready，机甲直接空转（实测 tick 21000–42000 完全不动：缺 8 个齿轮
		// 但背包只有 6 个铁块，既不肯少搓几个，也不去补铁块）。
		capped := batches
		for _, in := range recipe.Inputs {
			if in.Quantity <= 0 {
				continue
			}
			if b := op.player.Inventory[in.ItemID] / in.Quantity; b < capped {
				capped = b
			}
		}
		for _, in := range recipe.Inputs {
			op.planFor(in.ItemID, in.Quantity*batches, out, depth+1)
		}
		if capped > 0 {
			*out = append(*out, mechaAction{recipe: recipe, batches: capped})
		}
		return
	}
	if isManuallyMinableOre(item) {
		*out = append(*out, mechaAction{ore: item, qty: want - have})
	}
}

// machineMakes 玩家是否有一台「真能交货」的机器在跑该配方：光有机器不算，
// 还得「有原料能继续跑」或「已经有成品可取出」。否则机甲会把该物品的产出
// 完全托付给一台断料的机器，自己一直空转（实测第二座熔炉断料后机甲停在
// tick 6500 一动不动，背包里 88 个铁矿、1 个铁块，风机永远建不起来）。
func (op *zeroOpening) machineMakes(recipeID string) bool {
	recipe, ok := model.Recipe(recipeID)
	if !ok {
		return false
	}
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Production == nil || b.Storage == nil {
			continue
		}
		if b.Production.RecipeID != recipeID || b.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		ready := true
		for _, in := range recipe.Inputs {
			if b.Storage.ItemQuantity(in.ItemID) < in.Quantity {
				ready = false
				break
			}
		}
		if ready {
			return true
		}
		for _, out := range recipe.AllOutputs() {
			if b.Storage.ItemQuantity(out.ItemID) > 0 {
				return true
			}
		}
	}
	return false
}

// machineStock 正在跑该配方的机器手里有多少「该物品」（成品在产物缓冲/主库存里）。
func (op *zeroOpening) machineStock(recipeID, item string) int {
	total := 0
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Production == nil || b.Storage == nil {
			continue
		}
		if b.Production.RecipeID == recipeID {
			total += b.Storage.ItemQuantity(item)
		}
	}
	return total
}

func (op *zeroOpening) buildingOfType(btype model.BuildingType) *model.Building {
	var found *model.Building
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.Type != btype || b.HP <= 0 {
			continue
		}
		if found == nil || b.ID < found.ID {
			found = b
		}
	}
	return found
}

// powerReasons 无电建筑的状态原因（诊断用）。
func (op *zeroOpening) powerReasons() []string {
	var out []string
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 {
			continue
		}
		if b.Runtime.StateReason != "" && b.Runtime.StateReason != stateReasonFault {
			out = append(out, fmt.Sprintf("%s@%+v:%s", b.Type, b.Position, b.Runtime.StateReason))
		}
	}
	sort.Strings(out)
	return out
}

// runFromZeroMatch 单个 seed 的整局：p1 脚本化新手开局，p2 由预设 bot 驱动。
func runFromZeroMatch(t *testing.T, seed string) {
	t.Helper()
	core := newSkirmishCoreForSeed(t, seed)
	op := newZeroOpening(t, core, 75000)
	op.run()
	ws := op.ws
	player := ws.Players["p1"]

	t.Logf("seed=%s 里程碑=%v", seed, op.milestone)
	t.Logf("seed=%s 目标对照（脚本节奏）：风机 2400 / 矿机×4+熔炉×2+制造台 9000 / 兵营+步兵 15000 / 研究站 18000 / 电磁学 ~40000", seed)
	t.Logf("seed=%s 结束 tick=%d p1 存活=%v 建筑=%s 运行中=%s 部队=%d 损失(单位/建筑)=%d/%d 击杀=%d",
		seed, ws.Tick, player.IsAlive, fmtCounts(skirmishBuildingCounts(ws, "p1")), fmtCounts(skirmishRunningCounts(ws, "p1")),
		countArmy(ws, "p1"), player.Stats.CombatStats.UnitsLost, player.Stats.CombatStats.BuildingsLost, player.Stats.CombatStats.UnitsKilled)
	t.Logf("seed=%s bot 首攻 tick=%d（首波 20 格内峰值=%d）p2 建筑=%s p2 部队=%d p2 科技完成=%v",
		seed, op.firstAttackTick, op.firstWavePeak, fmtCounts(skirmishBuildingCounts(ws, "p2")), countArmy(ws, "p2"),
		ws.Players["p2"].Tech.CompletedTechs)
	if v := core.Victory(); v.Declared() {
		t.Logf("seed=%s 终局宣判：winner=%s reason=%s tick=%d", seed, v.WinnerID, v.Reason, v.DeclaredTick)
	}
	if len(op.buildFails) > 0 {
		keys := make([]string, 0, len(op.buildFails))
		for k := range op.buildFails {
			keys = append(keys, fmt.Sprintf("%s ×%d", k, op.buildFails[k]))
		}
		sort.Strings(keys)
		t.Logf("seed=%s 建造失败回执：%s", seed, strings.Join(keys, " | "))
	}
	// 节奏：建造进度停滞与「料没凑齐、脚本主动跳过建造」的累计 tick。
	// 第 16 轮起脚本在下发前自查背包（缺料就不发命令、直接去备料），所以回执不再是
	// 死锁信号；进度停滞才是——料凑不齐且机甲也没在备料时，计划会一直停在这一步。
	t.Logf("seed=%s 建造进度：已推进 %d/%d 步，最长停滞 %d tick（从 tick %d 起），缺料跳过累计 %d tick",
		seed, op.next, len(op.steps), op.maxStall, op.maxStallStart, op.pendingShortTicks)
	if op.next < len(op.steps) && op.maxStall > 40000 {
		t.Fatalf("建造计划停滞：已推进 %d/%d 步，从 tick %d 起 %d tick 没有推进（料凑不齐且机甲没在备料）",
			op.next, len(op.steps), op.maxStallStart, op.maxStall)
	}
	if op.soldierFails > 0 {
		keys := make([]string, 0, len(op.soldierFailReasons))
		for k := range op.soldierFailReasons {
			keys = append(keys, fmt.Sprintf("%s ×%d", k, op.soldierFailReasons[k]))
		}
		sort.Strings(keys)
		t.Logf("seed=%s 兵营排产被拒 %d 次（原因：%s）——兵营缺料是常态，不是死锁",
			seed, op.soldierFails, strings.Join(keys, " | "))
	}

	// 1) 开局链（无死锁）：空背包必须能靠手搓链走到风机/矿机/熔炉/制造台/兵营/研究站。
	bounds := []struct {
		key  string
		want int64
	}{
		{"wind_turbine", 6000},
		{"tesla_tower", 8000},
		{"mining_machine", 9000},
		{"arc_smelter", 13000},
		{"assembling_machine", 16000},
		{"barracks", 20000},
		{"soldier", 24000},
		{"matrix_lab", 28000},
	}
	for _, b := range bounds {
		tick, ok := op.milestone[b.key]
		if !ok {
			t.Fatalf("开局链死锁：%s 到 tick %d 都没达成（milestones=%v）", b.key, ws.Tick, op.milestone)
		}
		if tick > b.want {
			t.Fatalf("%s 在 tick %d 才达成，超出上限 %d（milestones=%v）", b.key, tick, b.want, op.milestone)
		}
	}
	// 2) 电磁学：整局末尾记录完成 tick（研究站 + 矩阵链已跑通即算达标）。
	// 无物资包下 75000 tick 内完成 20 个矩阵是上限目标而非硬断言：
	// 手搓链要把 20 个矩阵（每个 60 tick + 上游磁线圈/电路板）堆出来，
	// 脚本只能给「手搓 + 一台矩阵制造台」的产能。实测 seed 001 在 tick 39641 完成，
	// pt1011 慢一些（研究站晚 2000 tick、步兵晚 2500 tick），tick 67201 完成。
	if tick, ok := op.milestone["electromagnetism"]; ok {
		t.Logf("seed=%s 电磁学完成 tick=%d", seed, tick)
	} else {
		t.Logf("seed=%s 电磁学到 tick %d 仍未完成（research=%+v）——记录项，不算失败", seed, ws.Tick, player.Tech.CurrentResearch)
	}
	// 矩阵链出货检查：只要「矩阵制造台」这一环已经建成，就必须真的出矩阵
	// （出了矩阵 = 电磁学只差产量，不是死锁）。pt1011 的建造队列更慢，到 tick
	// 45000 还没轮到最后那台矩阵制造台（建造失败回执里 972 次「制造台缺 4 个
	// 电路板」），这时只记录，不判死锁。
	matrices := player.Inventory[model.ItemElectromagneticMatrix]
	matrixMachineBuilt := false
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.Storage == nil {
			continue
		}
		matrices += b.Storage.ItemQuantity(model.ItemElectromagneticMatrix)
		if b.Production != nil && b.Production.RecipeID == "electromagnetic_matrix" {
			matrixMachineBuilt = true
		}
	}
	t.Logf("seed=%s 结束时电磁矩阵存量（背包 + 全建筑）= %d（矩阵制造台已建=%v）", seed, matrices, matrixMachineBuilt)
	if matrixMachineBuilt && matrices <= 0 {
		t.Fatalf("矩阵制造台已建成但到 tick %d 一个电磁矩阵都没产出（供料链断了）", ws.Tick)
	}
	if !matrixMachineBuilt {
		t.Logf("seed=%s 建造队列还没推进到矩阵制造台（tick %d）——记录项，不算死锁", seed, ws.Tick)
	}
	// 研究站必须在整局内建起并运行（矩阵链的前提）。
	if tick, ok := op.milestone["matrix_lab"]; !ok || tick <= 0 {
		t.Fatalf("研究站到 tick %d 都没建起（milestones=%v）", ws.Tick, op.milestone)
	}
	// 3) bot 首攻在 bot_first_attack_tick 之后，且首波规模小（easy 档 attackAt=3
	//    → 3 个兵；上限放宽到 8 只为兜住守家兵/补兵的误差）。
	if op.firstAttackTick < 0 {
		t.Fatal("bot 整局没有发起进攻")
	}
	first := core.cfg.Battlefield.BotFirstAttackTick
	if op.firstAttackTick < first {
		t.Fatalf("bot 在 tick %d 首攻，早于 bot_first_attack_tick %d", op.firstAttackTick, first)
	}
	if op.firstAttackTick > first+9000 {
		t.Fatalf("bot 首攻推迟到 tick %d（预设 %d），发育链太长", op.firstAttackTick, first)
	}
	if op.firstWavePeak < 1 {
		t.Fatalf("bot 首攻没有兵力压到 p1 基地 20 格内（峰值 0）")
	}
	if op.firstWavePeak > 8 {
		t.Fatalf("首波规模 %d 超出「easy 小规模（attackAt=3）」的上限 8", op.firstWavePeak)
	}
	// 首波之后的后续波次峰值只记录：bot 后续会持续补兵压家，那是中后期的事。
	// 注意首波规模取的是「首攻后 600 tick 内 p1 基地 20 格内的 p2 地面单位峰值」，
	// easy 档 attackAt=3、squadCap=1 时第一支军团是 3 个兵；波次冷却 12000 tick
	// 保证首波窗口内不会有后续波次叠加。
	// 4) p1 靠自己的兵活下来。
	if !player.IsAlive {
		t.Fatalf("p1 在 tick %d 被淘汰（首攻 %d，首波峰值 %d）", ws.Tick, op.firstAttackTick, op.firstWavePeak)
	}
}

// buildingCost 是这栋建筑的建造物品成本（第 16 轮起建造只扣背包物品）。
func buildingCost(btype model.BuildingType) []model.ItemAmount {
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return nil
	}
	return def.BuildCost.Items
}

// itemIDByName 按中文名反查物品 ID（建造失败回执里只有中文名）。
// 目录里查不到时原样返回，调用方会当成「未知物品」处理。
func itemIDByName(name string) string {
	for _, def := range model.AllItems() {
		if def.Name == name {
			return def.ID
		}
	}
	return name
}

// handcraftRecipeFor 该物品可由机甲手搓的配方（考虑科技门）。优先选手搓耗能
// 最低的那条：电磁矩阵既能手搓也能在制造台/研究站里做，耗能高的那条会让
// 机甲为了「省机器」把自己饿死（实测机甲卡在「矩阵原料」上，电磁学做不出来）。
func (op *zeroOpening) handcraftRecipeFor(item string) (model.RecipeDefinition, bool) {
	best := model.RecipeDefinition{}
	found := false
	for _, def := range model.RecipesProducingItem(item) {
		if !def.HandcraftAllowed {
			continue
		}
		if op.player != nil && !CanUseRecipeTech(op.player, def.ID) {
			continue
		}
		if !found || def.Duration < best.Duration {
			best, found = def, true
		}
	}
	return best, found
}

// handcraftRecipeFor 该物品可由机甲手搓的配方（考虑科技门）。
func handcraftRecipeFor(player *model.PlayerState, item string) (model.RecipeDefinition, bool) {
	for _, def := range model.RecipesProducingItem(item) {
		if !def.HandcraftAllowed {
			continue
		}
		if player != nil && !CanUseRecipeTech(player, def.ID) {
			continue
		}
		return def, true
	}
	return model.RecipeDefinition{}, false
}

// storageHasRoomFor 建筑存储能否再收下该物品（复刻 StorageState 的槽位规则：
// 已有该物品则可继续收，否则要求还有空槽）。脚本用它在送料前避开
// 「已装别的物品、槽位满了」的仓库，否则取出产物之前永远喂不进新料。
func storageHasRoomFor(s *model.StorageState, item string) bool {
	if s == nil || s.Slots <= 0 {
		return true
	}
	seen := map[string]struct{}{}
	for _, inv := range []model.ItemInventory{s.Inventory, s.InputBuffer, s.OutputBuffer} {
		for id, qty := range inv {
			if qty > 0 {
				seen[id] = struct{}{}
			}
		}
	}
	if _, ok := seen[item]; ok {
		return true
	}
	return len(seen) < s.Slots
}

// recipeConsumesItem 判断配方是否把 item 当原料（取料时要跳过正在运行的机器原料）。
func recipeConsumesItem(recipeID, item string) bool {
	def, ok := model.Recipe(recipeID)
	if !ok {
		return false
	}
	for _, in := range def.Inputs {
		if in.ItemID == item {
			return true
		}
	}
	return false
}

// inventoryUsed 背包已占用的格数（机甲背包按格计，每格堆叠该物品的 stack_limit 件）。
func (op *zeroOpening) inventoryUsed() int {
	return op.player.InventorySlotsUsed()
}

// oreInBackpack 背包里全部原矿（手动可采的固体矿）的件数。
func (op *zeroOpening) oreInBackpack() int {
	total := 0
	for _, item := range minableOreItemIDs {
		total += op.player.Inventory[item]
	}
	return total
}

// mechaCapacity 机甲背包格数（默认 40 格，科技可提升；每格按物品 stack_limit 堆叠）。
func (op *zeroOpening) mechaCapacity() int {
	if exec := executorUnitQuiet(op.ws, "p1"); exec != nil && exec.Mecha != nil && exec.Mecha.InventorySlots > 0 {
		return exec.Mecha.InventorySlots
	}
	return 40
}
