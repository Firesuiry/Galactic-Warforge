package gamecore

import (
	"fmt"
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
	slots := unit.Mecha.InventorySlots
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{}
	if used > 0 {
		starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] = used * model.ItemStackSize(model.ItemCoal)
	}
	return gc, ws, depot, player, slots
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
// 装满后再取出报「背包已满（已用 N/总 M 格）」而不是继续加。
// 第 17 轮（U5）：容量按格计，每格堆叠该物品的 stack_limit 件。
func TestTransferItemToPlayerNeverExceedsInventoryCapacity(t *testing.T) {
	gc, ws, depot, player, slots := transferWithdrawWorld(t, 0)
	perSlot := model.ItemStackSize(model.ItemCoal)
	if _, _, err := depot.Storage.Load(model.ItemIronIngot, 50); err != nil {
		t.Fatal(err)
	}
	// 背包离满还差 3 格：请求 10 个（铁块 100 件/格，不到 1 格）只能取出 10 个。
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: (slots - 3) * perSlot}
	res, _ := execCommand(gc, model.CmdTransferItem, ws, "p1", withdrawCommand(depot.ID, model.ItemIronIngot, 10))
	if res.Code != model.CodeOK {
		t.Fatalf("partial withdraw: %s (%s)", res.Code, res.Message)
	}
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 10 || starterMecha(ws, player.PlayerID).Inventory.SlotsUsed() != slots-2 {
		t.Fatalf("withdraw must fill exactly the free slots: %v", starterMecha(ws, player.PlayerID).Inventory)
	}
	if !strings.Contains(res.Message, "已取出 10 个") {
		t.Fatalf("receipt must report the accepted amount: %q", res.Message)
	}

	// 背包已满格：拒绝并报占用，绝不超上限。
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: slots * perSlot}
	res, _ = execCommand(gc, model.CmdTransferItem, ws, "p1", withdrawCommand(depot.ID, model.ItemIronIngot, 5))
	if res.Code != model.CodeInsufficientResource || !strings.Contains(res.Message, "背包已满（已用") {
		t.Fatalf("full bag must be reported separately: %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, fmt.Sprintf("%d/%d 格", slots, slots)) {
		t.Fatalf("full-bag message must show slot occupancy, got %q", res.Message)
	}
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got > slots {
		t.Fatalf("withdraw pushed the bag over capacity: %d/%d", got, slots)
	}
	if got := depot.Storage.OutputQuantity(model.ItemIronIngot); got != 40 {
		t.Fatalf("failed withdraw must not drain the building, got %d", got)
	}
}

// 回归（试玩 1014 问题 1）：手搓产出把背包顶满之后，取出全部报
// 「背包已满」——先修产出侧，这里锁住「取出永远不会让背包超过上限」。
func TestTransferItemToPlayerClampsAfterCraftFilledTheBag(t *testing.T) {
	gc, ws, depot, player, slots := transferWithdrawWorld(t, 0)
	unit := ws.Units["u-1"]
	player.Tech = model.NewPlayerTechState("p1")
	perSlot := model.ItemStackSize(model.ItemCoal)
	// 背包满格启动 1 批 gear 手搓：预留 1 个铁块占 1 格，腾出的是铁块那格；
	// 产出齿轮（200 件/格，1 个也占 1 格）后正好回到满格。
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: (slots - 1) * perSlot, model.ItemIronIngot: 1}
	craft := model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"recipe_id": "gear", "quantity": 1}}
	if res, _ := execCommand(gc, model.CmdCraftItem, ws, "p1", craft); res.Code != model.CodeOK {
		t.Fatalf("craft start: %+v", res)
	}
	advancePersonalTicks(ws, 20)
	if starterMecha(ws, player.PlayerID).Inventory.SlotsUsed() != slots || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 {
		t.Fatalf("craft should fill the bag exactly: %v", starterMecha(ws, player.PlayerID).Inventory)
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
	if starterMecha(ws, player.PlayerID).Inventory.SlotsUsed() != slots {
		t.Fatalf("bag must stay exactly at capacity, got %d/%d", starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(), slots)
	}
}
