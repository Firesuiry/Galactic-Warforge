package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1014 层 06/09/10/11/12：给兵营 / 补给站 / 研究模式研究站「装入建筑」装料后，
// 旧实现把料搬进 output_buffer，UI 建筑详情的「本地存储」只显示 inventory → 玩家看到
// 0 /「-」，以为装料失败（要展开「输出缓存」才看得到）。
//
// 现在只有采掘类建筑（Collect != nil）才把主库存搬进输出缓冲（它们的输出缓冲就是
// 出货口，也是满仓阻塞告警的口径）；其余「无配方且无输出准入清单」的建筑（兵营、
// 补给站、炮塔、储物仓 / 储液罐、物流站、研究模式研究站、战场分析基站等）没有产物
// 需要经输出缓冲出货，装入的物料留在主库存。

// 装入兵营后物料必须在主库存（output_buffer 为空），且能真的被单位生产扣掉。
func TestLoadIntoBarracksKeepsStockInInventoryAndStillProduces(t *testing.T) {
	core := unitStackTestCore(t)
	ws := core.World()
	home := botPlayerHome(t, ws, "p1")
	pos := botAdjacentFreeTile(ws, home, "")
	if pos == nil {
		t.Fatal("no tile for barracks")
	}
	barracks := testBarracks(ws, "barracks-load", *pos, "p1")
	// 清空夹具预置的料，走真实装入路径验证。
	barracks.Storage.Inventory = nil
	barracks.Storage.OutputBuffer = nil

	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronIngot: 20, model.ItemCircuitBoard: 20}
	for _, item := range []string{model.ItemIronIngot, model.ItemCircuitBoard} {
		res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
			Type: model.CmdTransferItem,
			Payload: map[string]any{
				"building_id": barracks.ID,
				"item_id":     item,
				"quantity":    float64(20),
			},
		})
		if res.Code != model.CodeOK {
			t.Fatalf("load %s: %s (%s)", item, res.Code, res.Message)
		}
	}
	// 装入之后（含 settleStorage）物料必须留在主库存。
	settleStorage(ws)
	if got := barracks.Storage.UsedOutputBuffer(); got != 0 {
		t.Fatalf("barracks must not move loaded stock into the output buffer, got %d (inventory=%v output=%v)",
			got, barracks.Storage.Inventory, barracks.Storage.OutputBuffer)
	}
	if got := barracks.Storage.Inventory[model.ItemIronIngot]; got != 20 {
		t.Fatalf("loaded iron ingot must stay in the main inventory, got %d", got)
	}
	if got := barracks.Storage.Inventory[model.ItemCircuitBoard]; got != 20 {
		t.Fatalf("loaded circuit board must stay in the main inventory, got %d", got)
	}

	// execProduce 用 Storage.ItemQuantity 判定与扣料，装入的料必须真的能出厂。
	queueUnit(t, core, ws, barracks, "p1", model.UnitTypeSoldier)
	runUnitProduction(ws, barracks, 200)
	if len(barracks.UnitQueue) != 0 {
		t.Fatalf("queue not drained: %d left (inventory=%v)", len(barracks.UnitQueue), barracks.Storage.Inventory)
	}
	spawned, _ := countOwnedGroundUnits(ws, "p1", model.UnitTypeSoldier)
	if spawned == 0 {
		t.Fatal("barracks produced no unit from the loaded stock")
	}
	if got := barracks.Storage.Inventory[model.ItemIronIngot]; got != 20-2 {
		t.Fatalf("produce must consume loaded ingots from the main inventory, got %d", got)
	}
}

// 装入补给站后，settleAmmunitionSupply 仍要给单位补弹：料留在主库存、
// available = Storage.ItemQuantity 的口径不变。
func TestLoadedSupplyStationStillResuppliesFromInventory(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	station := addSupplyStation(ws, "sup-load", "p1", model.Position{X: 2, Y: 4}, nil)
	// 清空夹具预置的料，走真实装入路径验证。
	station.Storage.Inventory = nil
	station.Storage.OutputBuffer = nil

	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemAmmoBullet: 200}
	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": station.ID,
			"item_id":     model.ItemAmmoBullet,
			"quantity":    float64(200),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("load ammo: %s (%s)", res.Code, res.Message)
	}
	settleStorage(ws)
	if got := station.Storage.UsedOutputBuffer(); got != 0 {
		t.Fatalf("supply station must not move loaded ammo into the output buffer, got %d", got)
	}
	if got := station.Storage.Inventory[model.ItemAmmoBullet]; got != 200 {
		t.Fatalf("loaded ammo must stay in the main inventory, got %d", got)
	}

	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 3, Y: 4})
	unit.Ammo = 0
	unit.AmmoItem = ""
	ws.Tick++
	settleAmmunitionSupply(ws)
	if unit.Ammo <= 0 {
		t.Fatalf("supply station must refill the unit from its main inventory, ammo=%d stock=%v",
			unit.Ammo, station.Storage.Inventory)
	}
	if got := station.Storage.Inventory[model.ItemAmmoBullet]; got >= 200 {
		t.Fatalf("station stock must be drawn down by resupply, got %d", got)
	}
}

// 研究模式的研究站装入矩阵后，研究进度照常推进（研究结算走 OutputQuantity）。
func TestLoadedResearchLabStillAdvancesResearch(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	lab := newBuilding("lab-load", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	lab.Runtime.Functions.Research = &model.ResearchModule{ResearchPerTick: 10}
	placeBuilding(ws, lab)

	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemElectromagneticMatrix: 10}
	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": lab.ID,
			"item_id":     model.ItemElectromagneticMatrix,
			"quantity":    float64(10),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("load matrix: %s (%s)", res.Code, res.Message)
	}
	settleStorage(ws)
	if got := lab.Storage.UsedOutputBuffer(); got != 0 {
		t.Fatalf("research-mode lab must not move loaded matrices into the output buffer, got %d", got)
	}
	if got := lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix); got != 10 {
		t.Fatalf("loaded matrices must be available via OutputQuantity, got %d", got)
	}

	setResearchLabPowerRatio(ws, lab, 4, 4, 1)
	result, _ := execCommand(core, model.CmdStartResearch, ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "mecha_core"},
	})
	if result.Code != model.CodeOK {
		t.Fatalf("start research: %s (%s)", result.Code, result.Message)
	}
	settleResearch(core.worlds, 1)
	if player.Tech.CurrentResearch == nil || player.Tech.CurrentResearch.Progress != 10 {
		t.Fatalf("research did not consume the loaded matrices: %+v", player.Tech.CurrentResearch)
	}
	if got := lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix); got != 0 {
		t.Fatalf("matrices should be consumed by research, got %d left", got)
	}
}

// 采掘类建筑（Collect != nil）保持现状：主库存照旧被搬进输出缓冲，
// 满仓阻塞告警依赖这个口径，防止以后误删 collector 分支。
func TestCollectorStillRefillsOutputBuffer(t *testing.T) {
	ws := newMiningTestWorld(4)
	addFiniteVein(ws, "r1", "iron_ore", "c1", 4, 4, 20, 100000)
	miner := newMiningTestBuilding("b1", model.BuildingTypeMiningMachine, model.Position{X: 4, Y: 4}, 8)
	ws.Buildings["b1"] = miner
	miner.Runtime.State = model.BuildingWorkRunning
	// 直接把料放进主库存，settleStorage 应把它搬进输出缓冲。
	miner.Storage.Inventory = model.ItemInventory{model.ItemIronOre: 5}
	settleStorage(ws)
	if got := miner.Storage.OutputBuffer[model.ItemIronOre]; got != 5 {
		t.Fatalf("collector must refill its output buffer from inventory, got %d (inventory=%v)", got, miner.Storage.Inventory)
	}
	if got := miner.Storage.UsedInventory(); got != 0 {
		t.Fatalf("collector inventory should be drained into the output buffer, got %d", got)
	}
}
