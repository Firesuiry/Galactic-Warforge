package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 试玩反馈：缺料回执一次列出全部缺口，而不是只报第一项。
func TestMissingItemMessageListsEveryGap(t *testing.T) {
	inv := model.ItemInventory{model.ItemIronIngot: 7, model.ItemGear: 1}
	msg, short := missingItemMessage(inv, []model.ItemAmount{
		{ItemID: model.ItemIronIngot, Quantity: 10},
		{ItemID: model.ItemGear, Quantity: 3},
		{ItemID: model.ItemCircuitBoard, Quantity: 2},
	})
	if !short {
		t.Fatal("expected shortage")
	}
	want := "背包缺：铁块 3、齿轮 2、电路板 2"
	if msg != want {
		t.Fatalf("shortage message = %q, want %q", msg, want)
	}
	if _, short := missingItemMessage(inv, []model.ItemAmount{{ItemID: model.ItemIronIngot, Quantity: 7}}); short {
		t.Fatal("sufficient inventory must not report a shortage")
	}
}

// 连发 build：后面几条下单时背包还够，但前面的任务落成会扣走材料。
// 成功回执要如实提示将等料（语义不变：仍然允许排队等料）。
func TestBuildReceiptWarnsAboutQueuedMaterialCommitment(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	record := starterMecha(ws, "p1")
	// 每条太阳能板 5 电路板 / 10 铜锭 / 10 硅锭；只给一条半的料：
	// 第二条下单时背包本身够，但第一条任务落成会扣走大部分材料。
	record.Inventory = model.ItemInventory{
		model.ItemCircuitBoard: 7,
		model.ItemCopperIngot:  15,
		model.ItemSiliconIngot: 15,
	}
	pos1, pos2 := findTwoOpenTiles(ws)
	buildAt := func(pos model.Position) model.CommandResult {
		cmd := model.Command{
			Type:   model.CmdBuild,
			Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
			Payload: map[string]any{
				"building_type": "solar_panel",
			},
		}
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
		return res
	}

	first := buildAt(pos1)
	if first.Code != model.CodeOK {
		t.Fatalf("first build should succeed, got %s (%s)", first.Code, first.Message)
	}
	if strings.Contains(first.Message, "将等料") {
		t.Fatalf("first build has no queued commitment yet, got %q", first.Message)
	}

	second := buildAt(pos2)
	if second.Code != model.CodeOK {
		t.Fatalf("second build should still be accepted (queue and wait), got %s (%s)", second.Code, second.Message)
	}
	if !strings.Contains(second.Message, "本任务将等料") {
		t.Fatalf("second build should warn about waiting for materials, got %q", second.Message)
	}
	if !strings.Contains(second.Message, "电路板 3") ||
		!strings.Contains(second.Message, "铜块 5") ||
		!strings.Contains(second.Message, "高纯硅块 5") {
		t.Fatalf("warning should list every committed gap, got %q", second.Message)
	}
	// 两条任务都已入队；第二条会在第一条落成后停在缺料，而不是命令失败。
	if len(ws.Construction.Tasks) != 2 {
		t.Fatalf("expected both tasks queued, got %+v", ws.Construction.Tasks)
	}
}

// 背包本身就不够本任务时，回执仍是原来的「背包缺：…」，不叠加等料提示。
func TestBuildReceiptKeepsPlainShortageMessage(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	record := starterMecha(ws, "p1")
	record.Inventory = model.ItemInventory{model.ItemCircuitBoard: 1}
	pos, _ := findTwoOpenTiles(ws)
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd)
	if res.Code != model.CodeInsufficientResource {
		t.Fatalf("expected INSUFFICIENT_RESOURCE, got %s (%s)", res.Code, res.Message)
	}
	if strings.Contains(res.Message, "将等料") {
		t.Fatalf("plain shortage must not add the queued hint, got %q", res.Message)
	}
}

// 升级会立即扣料：背包被升级花掉后，前面排队的施工任务会缺料，回执要点明。
func TestUpgradeReceiptWarnsWhenQueuedConstructionLosesMaterials(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	record := starterMecha(ws, "p1")
	record.Inventory = model.ItemInventory{
		model.ItemCircuitBoard: 10,
		model.ItemCopperIngot:  20,
		model.ItemSiliconIngot: 20,
	}
	pos, _ := findTwoOpenTiles(ws)
	cmd := model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &model.Position{X: pos.X, Y: pos.Y}},
		Payload: map[string]any{
			"building_type": "solar_panel",
		},
	}
	if res, _ := execCommand(core, model.CmdBuild, ws, "p1", cmd); res.Code != model.CodeOK {
		t.Fatalf("build should succeed, got %s (%s)", res.Code, res.Message)
	}
	// 找一台可升级的己方建筑：用测试核心里玩家自带的基地。
	var buildingID string
	for id, building := range ws.Buildings {
		if building.OwnerID == "p1" && model.BuildingUpgradeRuleFor(building.Type).Allow {
			buildingID = id
			break
		}
	}
	if buildingID == "" {
		t.Skip("no upgradable own building in fixture")
	}
	upgradeCost := model.BuildingUpgradeCost(ws.Buildings[buildingID].Type, ws.Buildings[buildingID].Level)
	record.Inventory = model.ItemInventory{}
	for _, item := range upgradeCost.Items {
		record.Inventory[item.ItemID] = item.Quantity
	}
	// 只留升级的钱：排队的太阳能板（5 电路板 / 10 铜锭 / 10 硅锭）必然缺料。
	upgradeCmd := model.Command{Type: model.CmdUpgrade, Target: model.CommandTarget{EntityID: buildingID}}
	res, _ := execCommand(core, model.CmdUpgrade, ws, "p1", upgradeCmd)
	if res.Code != model.CodeOK {
		t.Fatalf("upgrade should succeed, got %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "前面排队的施工任务") {
		t.Fatalf("upgrade receipt should warn about starved queued tasks, got %q", res.Message)
	}
}
