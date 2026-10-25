package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// transferCommand 构造一条 transfer_item 命令，direction 省略表示默认 to_building。
func transferCommand(buildingID, itemID string, quantity int, direction string) model.Command {
	payload := map[string]any{
		"building_id": buildingID,
		"item_id":     itemID,
		"quantity":    float64(quantity),
	}
	if direction != "" {
		payload["direction"] = direction
	}
	return model.Command{Type: model.CmdTransferItem, Payload: payload}
}

// 契约 1 用例 1：仓库装满 → STORAGE_FULL（带原因）；transfer --take 腾出空间后同一命令 → OK。
func TestTransferIntoFullDepotReportsStorageFull(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronIngot: 3}

	depot := newBuilding("b-depot-full", model.BuildingTypeDepotMk1, "p1", model.Position{X: 5, Y: 5})
	attachBuilding(ws, depot)
	// 主库存整仓填满同一种物品、输入缓冲也塞满，任何装入都无处可放。
	depot.Storage.EnsureInventory()[model.ItemIronIngot] = depot.Storage.Capacity
	depot.Storage.EnsureInputBuffer()[model.ItemIronIngot] = depot.Storage.InputBufferCapacity()

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(depot.ID, model.ItemIronIngot, 3, ""))
	if res.Code != model.CodeStorageFull {
		t.Fatalf("expected STORAGE_FULL, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "无法接收") || !strings.Contains(res.Message, "主库存已满") {
		t.Fatalf("STORAGE_FULL receipt must name the reason, got %q", res.Message)
	}
	if got := starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot]; got != 3 {
		t.Fatalf("nothing was accepted, backpack must stay 3, got %d", got)
	}

	// 取出 3 个腾出主库存空间（to_player 方向）。
	takeRes, _ := execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(depot.ID, model.ItemIronIngot, 3, "to_player"))
	if takeRes.Code != model.CodeOK {
		t.Fatalf("take out failed: %s (%s)", takeRes.Code, takeRes.Message)
	}

	res, _ = execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(depot.ID, model.ItemIronIngot, 3, ""))
	if res.Code != model.CodeOK {
		t.Fatalf("expected OK after freeing space, got %s (%s)", res.Code, res.Message)
	}
	if got := depot.Storage.ItemQuantity(model.ItemIronIngot); got != depot.Storage.Capacity+depot.Storage.InputBufferCapacity() {
		t.Fatalf("expected depot back to full, got %d", got)
	}
}

// 契约 1 用例 2：制造台输入窗口（输入缓冲 + 主库存预留线）满 → STORAGE_FULL；
// 推进 tick 让它消耗原料后同一命令 → OK。
func TestTransferIntoFullProductionInputReportsStorageFull(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronOre: 5}

	smelter := newProductionTestBuilding("b-smelter-full", model.BuildingTypeArcSmelter, model.Position{X: 9, Y: 9}, "smelt_iron")
	attachBuilding(ws, smelter)
	advanceProduction(ws, 1)
	storage := smelter.Storage
	if storage.Reserve <= 0 || storage.InputBufferCapacity() <= 0 {
		t.Fatalf("test premise broken: reserve %d, input buffer cap %d", storage.Reserve, storage.InputBufferCapacity())
	}
	// 主库存填到产出预留线，输入缓冲（真实口径 storage.buffer）也填满。
	storage.EnsureInventory()[model.ItemIronOre] = storage.Capacity - storage.Reserve
	storage.EnsureInputBuffer()[model.ItemIronOre] = storage.InputBufferCapacity()

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(smelter.ID, model.ItemIronOre, 5, ""))
	if res.Code != model.CodeStorageFull {
		t.Fatalf("expected STORAGE_FULL, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "无法接收") || !strings.Contains(res.Message, "预留") {
		t.Fatalf("STORAGE_FULL receipt must explain the reserve line, got %q", res.Message)
	}

	recipe, _ := model.Recipe("smelt_iron")
	advanceProduction(ws, recipe.Duration*2+4)

	res, _ = execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(smelter.ID, model.ItemIronOre, 5, ""))
	if res.Code != model.CodeOK {
		t.Fatalf("expected OK after the smelter consumed ore, got %s (%s)", res.Code, res.Message)
	}
}

// 契约 1 用例 3/4/6：参数错误保持 VALIDATION_FAILED，不能被映射成 STORAGE_FULL。
func TestTransferParamErrorsStayValidationFailed(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{
		model.ItemIronIngot: 6,
		model.ItemIronOre:   6,
	}

	lab := newProductionTestBuilding("b-lab-research", model.BuildingTypeMatrixLab, model.Position{X: 4, Y: 4}, "")
	attachBuilding(ws, lab)
	if !isResearchLab(lab) {
		t.Fatalf("test premise broken: matrix lab without recipe must be in research mode")
	}

	coater := newBuilding("b-coater", model.BuildingTypeSprayCoater, "p1", model.Position{X: 6, Y: 6})
	attachBuilding(ws, coater)

	belt := newBuilding("b-belt", model.BuildingTypeConveyorBeltMk1, "p1", model.Position{X: 8, Y: 8})
	attachBuilding(ws, belt)
	if belt.Storage != nil {
		t.Fatalf("test premise broken: conveyor must have no storage")
	}

	cases := []struct {
		name       string
		buildingID string
		itemID     string
	}{
		{"research lab rejects non-matrix", lab.ID, model.ItemIronIngot},
		{"spray coater rejects non-proliferator", coater.ID, model.ItemIronOre},
		{"no storage target", belt.ID, model.ItemIronOre},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(tc.buildingID, tc.itemID, 1, ""))
			if res.Code != model.CodeValidationFailed {
				t.Fatalf("expected VALIDATION_FAILED, got %s (%s)", res.Code, res.Message)
			}
		})
	}
}

// 契约 1 用例 5：物流站未配置槽位 → VALIDATION_FAILED；配置后装到单项容量上限 → STORAGE_FULL。
func TestTransferIntoLogisticsStationStorageFull(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronOre: 2}

	station := newLogisticsStationBuilding("station-storage-full", model.Position{X: 7, Y: 7})
	attachBuilding(ws, station)

	// 未配置槽位：属于参数错误，保持 VALIDATION_FAILED。
	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(station.ID, model.ItemIronOre, 1, ""))
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("unconfigured slot must stay VALIDATION_FAILED, got %s (%s)", res.Code, res.Message)
	}

	cfgRes, _ := execCommand(core, model.CmdConfigureLogisticsSlot, ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: station.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          "supply",
			"local_storage": 24,
		},
	})
	if cfgRes.Code != model.CodeOK {
		t.Fatalf("configure slot failed: %s (%s)", cfgRes.Code, cfgRes.Message)
	}
	state := station.LogisticsStation
	state.Inventory = model.ItemInventory{model.ItemIronOre: state.ItemCapacity}

	res, _ = execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(station.ID, model.ItemIronOre, 2, ""))
	if res.Code != model.CodeStorageFull {
		t.Fatalf("expected STORAGE_FULL for a full station slot, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "无法接收") || !strings.Contains(res.Message, "物流站缓存已满") {
		t.Fatalf("STORAGE_FULL receipt must name the station cache, got %q", res.Message)
	}
}

// 契约 1 用例 7：to_player 背包满仍走 INSUFFICIENT_RESOURCE（不变成 STORAGE_FULL）。
func TestTransferOutIntoFullBackpackStaysInsufficientResource(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	player := ws.Players["p1"]
	mecha := starterMecha(ws, player.PlayerID)

	depot := newBuilding("b-depot-take", model.BuildingTypeDepotMk1, "p1", model.Position{X: 5, Y: 9})
	attachBuilding(ws, depot)
	depot.Storage.EnsureInventory()[model.ItemIronIngot] = 10

	// 背包按格计：把机甲所有格子都用铁矿堆满，FreeSlotsFor 归零。
	item, ok := model.Item(model.ItemIronIngot)
	if !ok {
		t.Fatalf("iron ingot definition missing")
	}
	slots := mechaInventorySlots(player)
	mecha.Inventory = model.ItemInventory{model.ItemIronIngot: item.StackLimit * slots}
	if mechaInventoryFree(mecha, slots, model.ItemIronIngot, 1) != 0 {
		t.Fatalf("test premise broken: backpack should have 0 free slots for iron ingot")
	}

	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", transferCommand(depot.ID, model.ItemIronIngot, 1, "to_player"))
	if res.Code != model.CodeInsufficientResource {
		t.Fatalf("expected INSUFFICIENT_RESOURCE, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "背包已满") {
		t.Fatalf("receipt must say the backpack is full, got %q", res.Message)
	}
	if got := depot.Storage.ItemQuantity(model.ItemIronIngot); got != 10 {
		t.Fatalf("nothing must leave the depot, got %d", got)
	}
}
