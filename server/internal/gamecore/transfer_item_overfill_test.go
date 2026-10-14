package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// advanceProduction 推进建筑的生产/存储结算（不跑整条管线，测试只关心这两段）。
func advanceProduction(ws *model.WorldState, ticks int) {
	for i := 0; i < ticks; i++ {
		ws.Tick++
		settleProduction(ws)
		settleStorage(ws)
	}
}

// fillProductionOutputSpace 把建筑的落货位全部占满：输出缓冲用该配方真正的成品填满
// （用与配方无关的物品会被 settleStorage 的 sanitizeOutputBuffer 挪回主库存），输入
// 缓冲用与配方无关的石头矿填满（不会被当成原料消耗），主库存里「产出预留」以外的
// 空位也填满。调用后任何产出都无处可放（用于验证 output_blocked 的 runtime 原因与告警）。
func fillProductionOutputSpace(storage *model.StorageState, outputItemID string) {
	if storage == nil {
		return
	}
	if storage.OutputBufferCapacity() > 0 && outputItemID != "" {
		storage.EnsureOutputBuffer()[outputItemID] = storage.OutputBufferCapacity()
	}
	if storage.InputBufferCapacity() > 0 {
		storage.EnsureInputBuffer()[model.ItemStoneOre] = storage.InputBufferCapacity()
	}
	if beyond := storage.Capacity - storage.Reserve; beyond > 0 {
		storage.EnsureInventory()[model.ItemStoneOre] = beyond
	}
}

// fillProductLandingSpots 占满一台机器产出的全部落点，模拟「下游完全不出货」：
//   - 输出缓冲用该配方真正的成品填满（用与配方无关的物品会被 sanitizeOutputBuffer
//     挪回主库存，反而腾出输出缓冲）；
//   - 主库存的产出预留段也用成品占住（成品堆在预留区里等着被取走）；
//   - 主库存其余空位与输入缓冲用与配方无关的石头矿填满（不会被当成原料消耗）。
//
// 调用后 OutputBufferSpace() == 0 且 ReservedSpace() == 0，任何整批产出都落不下
// （落点语义见 model.StorageState.StoreProduct）。
func fillProductLandingSpots(storage *model.StorageState, product string) {
	if storage == nil {
		return
	}
	if storage.OutputBufferCapacity() > 0 && product != "" {
		storage.EnsureOutputBuffer()[product] = storage.OutputBufferCapacity()
	}
	if storage.InputBufferCapacity() > 0 {
		storage.EnsureInputBuffer()[model.ItemStoneOre] = storage.InputBufferCapacity()
	}
	if product != "" && storage.Reserve > 0 {
		storage.EnsureInventory()[product] += storage.Reserve
	}
	if room := storage.Capacity - storage.UsedInventory(); room > 0 {
		storage.EnsureInventory()[model.ItemStoneOre] += room
	}
}

// drainProductLandingSpots 腾空产出的全部落点：清掉输出缓冲、占位料（石头矿）与
// 用来占住预留段的成品。其它物料（例如还没加工的原料）保持原样。
func drainProductLandingSpots(storage *model.StorageState, products ...string) {
	if storage == nil {
		return
	}
	storage.OutputBuffer = nil
	delete(storage.Inventory, model.ItemStoneOre)
	delete(storage.InputBuffer, model.ItemStoneOre)
	for _, product := range products {
		delete(storage.Inventory, product)
	}
}

// 回归（试玩 1014 层 04 P1）：把 60 个铁矿「装入」容量 24 的熔炉，旧实现把主库存
// 塞到 24/24、输入缓冲 5/5，产出整批落不下，建筑表面 running 却永远不产出。
// 现在装入受「容量 − 产出预留」限制，超出的留在背包，且回执说清实际装入量与原因。
func TestTransferItemCannotOverfillProductionBuilding(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemIronOre: 60}

	smelter := newProductionTestBuilding("b-smelter", model.BuildingTypeArcSmelter, model.Position{X: 9, Y: 9}, "smelt_iron")
	attachBuilding(ws, smelter)
	// 建筑建成/切换配方后先跑一 tick：产出预留按当前配方写入（真实局里建造时即写好）。
	advanceProduction(ws, 1)

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": smelter.ID,
			"item_id":     model.ItemIronOre,
			"quantity":    float64(60),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("transfer rejected: %s (%s)", res.Code, res.Message)
	}

	storage := smelter.Storage
	if storage.Reserve <= 0 {
		t.Fatalf("smelter must reserve output room, got reserve %d", storage.Reserve)
	}
	// 产出预留线：主库存只能填到 容量 − 预留，否则整批产出会落不下。
	if got := storage.UsedInventory(); got > storage.Capacity-storage.Reserve {
		t.Fatalf("loading crossed the reserve line: inventory %d, capacity %d, reserve %d",
			got, storage.Capacity, storage.Reserve)
	}
	if got := storage.UsedInputBuffer(); got > storage.InputBufferCapacity() {
		t.Fatalf("input buffer overflowed: %d > %d", got, storage.InputBufferCapacity())
	}

	wantLoaded := (storage.Capacity - storage.Reserve) + storage.InputBufferCapacity()
	if got := storage.ItemQuantity(model.ItemIronOre); got != wantLoaded {
		t.Fatalf("expected %d ore loaded, got %d", wantLoaded, got)
	}
	if got := player.Inventory[model.ItemIronOre]; got != 60-wantLoaded {
		t.Fatalf("expected %d ore left in backpack, got %d", 60-wantLoaded, got)
	}
	if !strings.Contains(res.Message, "留在背包") || !strings.Contains(res.Message, "产出预留") {
		t.Fatalf("receipt must report the leftover and the output reserve, got %q", res.Message)
	}
	if strings.Contains(res.Message, "iron_ore") || strings.Contains(res.Message, "b-smelter") {
		t.Fatalf("receipt leaks ids: %q", res.Message)
	}
}

// 回归（试玩 1014 层 04 P1）：装料塞不满熔炉之后，熔炉必须真的产出——
// 成品落到产出预留的空位，且不报阻塞。
func TestLoadedSmelterStillProduces(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemIronOre: 60}

	smelter := newProductionTestBuilding("b-smelter", model.BuildingTypeArcSmelter, model.Position{X: 9, Y: 9}, "smelt_iron")
	attachBuilding(ws, smelter)
	advanceProduction(ws, 1)

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": smelter.ID,
			"item_id":     model.ItemIronOre,
			"quantity":    float64(60),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("transfer rejected: %s (%s)", res.Code, res.Message)
	}

	recipe, _ := model.Recipe("smelt_iron")
	advanceProduction(ws, recipe.Duration*3+6)

	if got := smelter.Storage.ItemQuantity(model.ItemIronIngot); got < 3 {
		t.Fatalf("loaded smelter produced %d ingots in 3 cycles: outbuf=%v inventory=%v pending=%v",
			got, smelter.Storage.OutputBuffer, smelter.Storage.Inventory, smelter.Production.PendingOutputs)
	}
	if smelter.Runtime.StateReason == stateReasonOutputBlocked {
		t.Fatalf("a loaded smelter with free output room must not report output_blocked")
	}
}

// 回归（试玩 1014 层 04 P1 要求 b）：产出真的无处可放（输出缓冲 + 产出预留都满）时，
// runtime 必须报 output_blocked（而不是继续显示「运行中」），并给出产物阻塞告警。
func TestFullOutputReportsBlockedReason(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemIronOre: 60}

	smelter := newProductionTestBuilding("b-smelter", model.BuildingTypeArcSmelter, model.Position{X: 9, Y: 9}, "smelt_iron")
	attachBuilding(ws, smelter)
	advanceProduction(ws, 1)

	execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": smelter.ID,
			"item_id":     model.ItemIronOre,
			"quantity":    float64(60),
		},
	})

	recipe, _ := model.Recipe("smelt_iron")
	// 塞满产出的全部落点（输出缓冲 + 产出预留段 + 主库存其余空位），产出无处可放。
	fillProductLandingSpots(smelter.Storage, model.ItemIronIngot)
	advanceProduction(ws, recipe.Duration*8)

	storage := smelter.Storage
	if storage.OutputBufferSpace() > 0 || storage.ReservedSpace() > 0 {
		t.Fatalf("test premise broken: output room %d + reserve room %d should be exhausted",
			storage.OutputBufferSpace(), storage.ReservedSpace())
	}
	if smelter.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("production cycle itself is fine, state must stay running, got %s", smelter.Runtime.State)
	}
	if smelter.Runtime.StateReason != stateReasonOutputBlocked {
		t.Fatalf("expected state_reason %q, got %q", stateReasonOutputBlocked, smelter.Runtime.StateReason)
	}

	// 监控采样（同一 tick 值）也必须报产物阻塞告警。
	pm := newProductionMonitor(newTestMonitorConfig())
	if _, alerts := pm.settleProductionMonitoring(ws, 0); len(alerts) == 0 {
		t.Fatalf("expected an output_blocked production alert")
	} else {
		found := false
		for _, alert := range alerts {
			if alert.AlertType == model.AlertTypeOutputBlocked {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected AlertTypeOutputBlocked, got %v", alerts)
		}
	}
}

// 回归：装入回执说清「实际装入 + 差额留在背包」，不能只回一句「已受理」。
func TestTransferItemReceiptReportsShortfall(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 40}

	depot := newBuilding("b-depot", model.BuildingTypeDepotMk1, "p1", model.Position{X: 5, Y: 5})
	attachBuilding(ws, depot)

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": depot.ID,
			"item_id":     model.ItemIronIngot,
			"quantity":    float64(40),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("transfer rejected: %s (%s)", res.Code, res.Message)
	}
	// 储物仓没有配方 → 没有产出预留，40 个应当全收，回执保持旧格式（既有测试锁定）。
	if res.Message != "已传输 40 个「铁块」至小型储物仓" && res.Message != "已传输 40 个「铁块」至仓库" {
		t.Fatalf("full-accept receipt changed: %q", res.Message)
	}
	if depot.Storage.Reserve != 0 {
		t.Fatalf("storage-only buildings must not reserve output room, got %d", depot.Storage.Reserve)
	}
}
