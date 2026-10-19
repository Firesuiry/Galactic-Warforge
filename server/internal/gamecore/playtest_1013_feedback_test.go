package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 第 13 轮试玩（tmp/playtest-1013）报告 B/C 的服务端修复：
//   B. 研究站「有站但不能用」的两种原因（设了配方 / 断电）必须分别说清，
//      而不是一句「需要至少一台运行中的研究站」；
//   C. 取出物品的「建筑里没有」与「背包已满」必须分开报，并给出背包占用；
//   4. 研究模式的研究站不该默默收下非矩阵物品。

// 研究站设了生产配方：回执要点名建筑、坐标、当前配方，并说明要切回
// 「无配方（研究模式）」——试玩报告 B 的第 3 条（bug-1013-4）。
func TestStartResearchExplainsLabSwitchedToProduction(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-prod-mode", model.BuildingTypeMatrixLab, "p1", model.Position{X: 7, Y: 7})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	if res, _ := execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(lab.ID, model.ItemElectromagneticMatrix)); res.Code != model.CodeOK {
		t.Fatalf("set recipe on lab: %+v", res)
	}

	issues := core.ValidateStartResearchLocked("p1", "electromagnetism", ws)
	if len(issues) != 1 || issues[0].Code != "no_running_lab" {
		t.Fatalf("issues = %+v, want one no_running_lab", issues)
	}
	message := issues[0].Message
	for _, want := range []string{"矩阵研究站", "（7,7）", "电磁矩阵", "无配方（研究模式）"} {
		if !strings.Contains(message, want) {
			t.Fatalf("message %q must name %q", message, want)
		}
	}
	if strings.Contains(message, "需要至少一台运行中的研究站") {
		t.Fatalf("generic message hides the real cause: %q", message)
	}

	// tick 内执行路径（不经 gateway 预检）给出同一句可操作的回执。
	res, _ := execCommand(core, model.CmdStartResearch, ws, "p1", model.Command{
		Type:    model.CmdStartResearch,
		Payload: map[string]any{"tech_id": "electromagnetism"},
	})
	if res.Code != model.CodeValidationFailed || !strings.Contains(res.Message, "无配方（研究模式）") {
		t.Fatalf("execStartResearch message = %q (%s)", res.Message, res.Code)
	}
}

// 研究站断电：直接说断电与接电办法——试玩报告 L2 的第一版研究站
// （建在 (8,8)，电塔无线覆盖范围外，整局 no_power）就是这种情况。
func TestStartResearchExplainsUnpoweredLab(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	lab := newBuilding("lab-no-power", model.BuildingTypeMatrixLab, "p1", model.Position{X: 8, Y: 8})
	lab.Runtime.State = model.BuildingWorkNoPower
	lab.Runtime.StateReason = "power_out_of_range"
	placeBuilding(ws, lab)

	issues := core.ValidateStartResearchLocked("p1", "electromagnetism", ws)
	if len(issues) != 1 || issues[0].Code != "no_running_lab" {
		t.Fatalf("issues = %+v, want one no_running_lab", issues)
	}
	for _, want := range []string{"矩阵研究站", "（8,8）", "断电"} {
		if !strings.Contains(issues[0].Message, want) {
			t.Fatalf("message %q must mention %q", issues[0].Message, want)
		}
	}
}

// 一台研究类建筑都没有时保持通用文案（此时「先建一座研究站」才是对的）。
func TestStartResearchWithoutAnyLabKeepsGenericMessage(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	issues := core.ValidateStartResearchLocked("p1", "electromagnetism", ws)
	if len(issues) != 1 || issues[0].Code != "no_running_lab" {
		t.Fatalf("issues = %+v, want one no_running_lab", issues)
	}
	if !strings.Contains(issues[0].Message, "需要至少一台运行中的研究站") {
		t.Fatalf("message = %q", issues[0].Message)
	}
}

// 取出物品：建筑里没有 vs 背包已满，两种原因分开报（试玩报告 C）。
func TestTransferItemToPlayerSeparatesEmptyBuildingFromFullBag(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{}

	depot := newBuilding("depot-withdraw", model.BuildingTypeDepotMk1, "p1", model.Position{X: 3, Y: 1})
	depot.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, depot)

	withdraw := func() model.CommandResult {
		res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
			Type: model.CmdTransferItem,
			Payload: map[string]any{
				"building_id": depot.ID,
				"item_id":     model.ItemIronIngot,
				"quantity":    5,
				"direction":   "to_player",
			},
		})
		return res
	}

	// 1) 建筑里没有该物品。
	res := withdraw()
	if res.Code != model.CodeInsufficientResource || !strings.Contains(res.Message, "里没有可取出的「铁块」") {
		t.Fatalf("empty-building message = %q (%s)", res.Message, res.Code)
	}

	// 2) 建筑里有货，但执行体背包装不下：报占用 N/容量。
	if _, _, err := depot.Storage.Load(model.ItemIronIngot, 5); err != nil {
		t.Fatal(err)
	}
	slots := ws.Units[starterMecha(ws, player.PlayerID).UnitID].Mecha.InventorySlots
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: slots * model.ItemStackSize(model.ItemCoal)}
	res = withdraw()
	if res.Code != model.CodeInsufficientResource {
		t.Fatalf("full-bag code = %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "背包已满（") || !strings.Contains(res.Message, "/") {
		t.Fatalf("full-bag message must show occupancy, got %q", res.Message)
	}
	if !strings.Contains(res.Message, model.ItemIronIngot) && !strings.Contains(res.Message, "铁块") {
		t.Fatalf("full-bag message must name the item, got %q", res.Message)
	}
	if got := depot.Storage.OutputQuantity(model.ItemIronIngot); got != 5 {
		t.Fatalf("failed withdraw must not drain the building, got %d", got)
	}
}

// 研究模式的研究站只收矩阵：装入非矩阵物品当场拒绝并说清原因，
// 而不是收下后永远不消耗（试玩报告 B 的第 2 条：电路板/磁线圈直接进站）。
func TestTransferItemRejectsNonMatrixIntoResearchModeLab(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]

	lab := newBuilding("lab-intake", model.BuildingTypeMatrixLab, "p1", model.Position{X: 6, Y: 6})
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)

	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCircuitBoard: 4}
	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": lab.ID,
			"item_id":     model.ItemCircuitBoard,
			"quantity":    4,
		},
	})
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("non-matrix into research-mode lab must be rejected, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "研究模式") || !strings.Contains(res.Message, "只接受矩阵") {
		t.Fatalf("rejection message = %q", res.Message)
	}
	if got := lab.Storage.OutputQuantity(model.ItemCircuitBoard); got != 0 {
		t.Fatalf("rejected transfer must not load the lab, got %d", got)
	}
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemCircuitBoard] != 4 {
		t.Fatalf("rejected transfer must not consume inventory, got %d", starterMecha(ws, player.PlayerID).Inventory[model.ItemCircuitBoard])
	}

	// 矩阵照常装入：研究站的库存就是研究耗材。
	starterMecha(ws, player.PlayerID).Inventory[model.ItemElectromagneticMatrix] = 3
	res, _ = execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": lab.ID,
			"item_id":     model.ItemElectromagneticMatrix,
			"quantity":    3,
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("matrix into research-mode lab: %s (%s)", res.Code, res.Message)
	}
	if got := lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix); got != 3 {
		t.Fatalf("lab matrix storage = %d, want 3", got)
	}

	// 切成生产模式后，研究站按普通制造建筑对待，原料可以装入。
	starterMecha(ws, player.PlayerID).Inventory[model.ItemCircuitBoard] = 4
	if r, _ := execCommand(core, model.CmdSetRecipe, ws, "p1", setRecipeCmd(lab.ID, model.ItemElectromagneticMatrix)); r.Code != model.CodeOK {
		t.Fatalf("switch lab to production: %+v", r)
	}
	res, _ = execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type: model.CmdTransferItem,
		Payload: map[string]any{
			"building_id": lab.ID,
			"item_id":     model.ItemCircuitBoard,
			"quantity":    4,
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("production-mode lab must accept inputs: %s (%s)", res.Code, res.Message)
	}
}
