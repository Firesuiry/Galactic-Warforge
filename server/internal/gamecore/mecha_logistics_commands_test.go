package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// transferWithdrawWorld 建一个带存储的仓库 + 玩家执行体，并把背包设成 used 件煤。
func transferWithdrawWorld(t *testing.T, used int) (*GameCore, *model.WorldState, *model.Building, *model.PlayerState, int) {
	t.Helper()
	ws, gc, depot := newTestWorldWithBuilding(model.BuildingTypeDepotMk1, 1)
	depot.Runtime.State = model.BuildingWorkRunning
	// 世界工厂里的执行体（"u-1"）就是命令目标。
	unit := ws.Units["u-1"]
	unit.HP = 100
	unit.Mecha = model.NewMechaState()
	player := ws.Players["p1"]
	model.SyncMechaCapabilities(unit, player)
	capacity := unit.Mecha.InventoryCapacity
	player.Inventory = model.ItemInventory{}
	if used > 0 {
		player.Inventory[model.ItemCoal] = used
	}
	return gc, ws, depot, player, capacity
}

func withdrawCommand(buildingID, itemID string, quantity int) model.Command {
	return model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": buildingID,
			"item_id":     itemID,
			"quantity":    quantity,
			"direction":   "to_player",
		},
	}
}

// 回归（试玩 1014 问题 1）：取出只能填满背包剩余空间，永远不能把背包顶过上限；
// 装满后再取出报「背包已满（N/容量）」而不是继续加。
func TestTransferItemToPlayerNeverExceedsInventoryCapacity(t *testing.T) {
	gc, ws, depot, player, capacity := transferWithdrawWorld(t, 0)
	if _, _, err := depot.Storage.Load(model.ItemIronIngot, 10); err != nil {
		t.Fatal(err)
	}
	// 背包离满还差 3 格：请求 10 个只能取出 3 个，背包正好到上限。
	player.Inventory = model.ItemInventory{model.ItemCoal: capacity - 3}
	res, _ := execCommand(gc, model.CmdTransferItem, ws, "p1", withdrawCommand(depot.ID, model.ItemIronIngot, 10))
	if res.Code != model.CodeOK {
		t.Fatalf("partial withdraw: %s (%s)", res.Code, res.Message)
	}
	if player.Inventory[model.ItemIronIngot] != 3 || player.InventoryCount() != capacity {
		t.Fatalf("withdraw must fill exactly the free slots: %v", player.Inventory)
	}
	if !strings.Contains(res.Message, "已取出 3 个") {
		t.Fatalf("receipt must report the accepted amount: %q", res.Message)
	}
	if got := depot.Storage.OutputQuantity(model.ItemIronIngot); got != 7 {
		t.Fatalf("building must keep the untaken items, got %d", got)
	}

	// 背包已满：拒绝并报占用，绝不超上限。
	res, _ = execCommand(gc, model.CmdTransferItem, ws, "p1", withdrawCommand(depot.ID, model.ItemIronIngot, 5))
	if res.Code != model.CodeInsufficientResource || !strings.Contains(res.Message, "背包已满（") {
		t.Fatalf("full bag must be reported separately: %s (%s)", res.Code, res.Message)
	}
	if got := player.InventoryCount(); got > capacity {
		t.Fatalf("withdraw pushed the bag over capacity: %d/%d", got, capacity)
	}
	if got := depot.Storage.OutputQuantity(model.ItemIronIngot); got != 7 {
		t.Fatalf("failed withdraw must not drain the building, got %d", got)
	}
}

// 回归（试玩 1014 问题 1）：手搓产出把背包顶到 201/200 之后，取出全部报
// 「背包已满（201/200）」——先修产出侧，这里锁住「取出永远不会让背包超过上限」。
func TestTransferItemToPlayerClampsAfterCraftFilledTheBag(t *testing.T) {
	gc, ws, depot, player, capacity := transferWithdrawWorld(t, 0)
	unit := ws.Units["u-1"]
	player.Tech = model.NewPlayerTechState("p1")
	// 背包满格启动 1 批 gear 手搓：预留 1 个铁块腾出 1 格，产出齿轮后正好 200/200。
	player.Inventory = model.ItemInventory{model.ItemCoal: capacity - 1, model.ItemIronIngot: 1}
	craft := model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"recipe_id": "gear", "quantity": 1}}
	if res, _ := execCommand(gc, model.CmdCraftItem, ws, "p1", craft); res.Code != model.CodeOK {
		t.Fatalf("craft start: %+v", res)
	}
	advancePersonalTicks(ws, 20)
	if player.InventoryCount() != capacity || player.Inventory[model.ItemGear] != 1 {
		t.Fatalf("craft should fill the bag exactly: %v", player.Inventory)
	}
	if unit.Mecha.Job != nil {
		t.Fatalf("single batch job should be done: %+v", unit.Mecha.Job)
	}
	if _, _, err := depot.Storage.Load(model.ItemIronIngot, 5); err != nil {
		t.Fatal(err)
	}
	res, _ := execCommand(gc, model.CmdTransferItem, ws, "p1", withdrawCommand(depot.ID, model.ItemIronIngot, 5))
	if res.Code != model.CodeInsufficientResource {
		t.Fatalf("full bag withdraw: %s (%s)", res.Code, res.Message)
	}
	if player.InventoryCount() != capacity {
		t.Fatalf("bag must stay exactly at capacity, got %d/%d", player.InventoryCount(), capacity)
	}
}
