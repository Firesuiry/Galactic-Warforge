package gamecore

import (
	"encoding/json"
	"reflect"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

func personalJobTestWorld() (*model.WorldState, *model.Unit) {
	ws, unit := mechaTestWorld()
	ws.Players["p1"].Tech = model.NewPlayerTechState("p1")
	return ws, unit
}

func handcraftCommand(id string, quantity any) model.Command {
	return model.Command{Target: model.CommandTarget{EntityID: "executor"}, Payload: map[string]any{"recipe_id": id, "quantity": quantity}}
}
func manualMineCommand(quantity any) model.Command {
	return model.Command{Target: model.CommandTarget{EntityID: "executor"}, Payload: map[string]any{"resource_id": "coal", "quantity": quantity}}
}

// setTestInventory 把背包设为 used 格（全部是煤，煤 100 件/格），并返回该行星
// 执行体的背包格数上限。机甲背包上限来自 units.yaml 的
// executor.mecha.inventory_slots（默认 40 格），这里统一通过 SyncMechaCapabilities
// 同步，避免测试写死数字。
func setTestInventory(ws *model.WorldState, unit *model.Unit, used int) int {
	player := ws.Players[unit.OwnerID]
	model.SyncMechaCapabilities(unit, player)
	slots := unit.Mecha.InventorySlots
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{}
	if used > 0 {
		starterMecha(ws, player.PlayerID).EnsureInventory()[model.ItemCoal] = used * model.ItemStackSize(model.ItemCoal)
	}
	return slots
}

// fillTestInventory 把背包塞满：煤占满全部格数（返回格数上限）。
func fillTestInventory(ws *model.WorldState, unit *model.Unit) int {
	player := ws.Players[unit.OwnerID]
	model.SyncMechaCapabilities(unit, player)
	slots := unit.Mecha.InventorySlots
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: slots * model.ItemStackSize(model.ItemCoal)}
	return slots
}

func addManualCoal(ws *model.WorldState, amount int) *model.ResourceNodeState {
	node := &model.ResourceNodeState{ID: "coal", PlanetID: ws.PlanetID, Kind: model.ItemCoal, Behavior: "finite", Position: model.Position{X: 2, Y: 1}, MaxAmount: amount, Remaining: amount}
	ws.Resources[node.ID] = node
	return node
}
func advancePersonalTicks(ws *model.WorldState, n int) {
	for i := 0; i < n; i++ {
		ws.Tick++
		settleMechas(ws)
	}
}

func TestManualMiningConsumesRealNodeTimeEnergyAndCanRefuel(t *testing.T) {
	ws, unit := personalJobTestWorld()
	node := addManualCoal(ws, 2)
	core := &GameCore{}
	if result, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	if node.Remaining != 2 || starterMecha(ws, "p1").Inventory[model.ItemCoal] != 0 {
		t.Fatal("mining completed instantly")
	}
	// 首批开工扣 3 能（tick 20），期间跨了 24、28 两个回能 tick 各 +1：
	// 100 - 3 + 2 = 99。数量与回能节奏都由数据决定，这里钉住“确实扣了能”。
	advancePersonalTicks(ws, 9)
	if node.Remaining != 2 || unit.Mecha.Energy != 99 {
		t.Fatalf("mining ignored tick cost: energy=%d", unit.Mecha.Energy)
	}
	advancePersonalTicks(ws, 1)
	if node.Remaining != 1 || unit.Mecha.Job.CompletedBatches != 1 || starterMecha(ws, "p1").Inventory[model.ItemCoal] != 1 {
		t.Fatal("first mining batch incorrect")
	}
	// 第二批开工再扣 3 能，到 tick 40 时跨了 32、36、40 三个回能 tick：
	// 99 - 3 + 3 = 99。
	advancePersonalTicks(ws, 10)
	if node.Remaining != 0 || !node.Depleted || unit.Mecha.Job != nil || unit.Mecha.Energy != 99 {
		t.Fatalf("mining did not stop at requested/depleted amount: energy=%d", unit.Mecha.Energy)
	}
	result, _ := execCommand(core, model.CmdRefuelMecha, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": model.ItemCoal, "count": 1}})
	if result.Code != model.CodeOK || unit.Mecha.Energy != 100 || starterMecha(ws, "p1").Inventory[model.ItemCoal] != 1 {
		t.Fatalf("mined coal could not fuel executor: %+v", result)
	}
}

func TestManualMiningPausesOnDistanceEnergyAndConcurrentExhaustion(t *testing.T) {
	ws, unit := personalJobTestWorld()
	node := addManualCoal(ws, 3)
	core := &GameCore{}
	if result, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	unit.Position = model.Position{X: 7, Y: 7}
	advancePersonalTicks(ws, 5)
	if unit.Mecha.Job.State != "out_of_range" || unit.Mecha.Job.RemainingTicks != 10 || unit.Mecha.Energy != 100 {
		t.Fatal("out-of-range mining progressed")
	}
	// 能量不足：把 tick 对齐到非回能窗口（连续 3 tick 无回能），作业暂停不推进。
	unit.Position = model.Position{X: 1, Y: 1}
	unit.Mecha.Energy = 0
	ws.Tick = 1
	advancePersonalTicks(ws, 2)
	if unit.Mecha.Job.State != "no_energy" || node.Remaining != 3 {
		t.Fatal("empty core mined")
	}
	unit.Mecha.Energy = 10
	advancePersonalTicks(ws, 10)
	if node.Remaining != 2 || starterMecha(ws, "p1").Inventory[model.ItemCoal] != 1 {
		t.Fatal("mining failed to resume")
	}
	node.Remaining = 0
	energyBefore := unit.Mecha.Energy
	advancePersonalTicks(ws, 1)
	// 节点枯竭：作业结束、不再扣能（被动回能可能 +1，所以只断言不小于原值）。
	if unit.Mecha.Job != nil || unit.Mecha.Energy < energyBefore || starterMecha(ws, "p1").Inventory[model.ItemCoal] != 1 {
		t.Fatal("exhausted shared node consumed energy or duplicated resources")
	}
}

func TestHandcraftReservesMaterialsAndRefundsOnlyUncompletedBatches(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronIngot: 3}
	result, initialEvents := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 3))
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 0 || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 0 {
		t.Fatal("craft did not reserve exactly three inputs")
	}
	// 首批开工扣 3 能（tick 20），到 tick 40 完成首批；期间回能 tick 把核心补回上限。
	advancePersonalTicks(ws, 20)
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 || unit.Mecha.Energy != 100 || unit.Mecha.Job.ReservedInputs[0].Quantity != 2 {
		t.Fatalf("craft batch accounting incorrect: %+v", unit.Mecha)
	}
	advancePersonalTicks(ws, 5)
	// 5 tick 里至少跨一个回能 tick（20%4==0），核心补回满。
	if unit.Mecha.Energy != 100 {
		t.Fatalf("passive regen missing: %d", unit.Mecha.Energy)
	}
	initial := initialEvents[0].Payload["mecha"].(model.MechaState)
	if initial.Job.RemainingTicks != 20 || initial.Job.ReservedInputs[0].Quantity != 3 {
		t.Fatal("event history aliases live job")
	}
	result, _ = execCommand(core, model.CmdCancelMechaJob, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}})
	if result.Code != model.CodeOK || unit.Mecha.Job != nil || starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 2 || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 || unit.Mecha.Energy != 100 {
		t.Fatal("cancel duplicated or lost items / refunded consumed energy")
	}
	refundMechaJob(ws, unit)
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 2 {
		t.Fatal("refund not idempotent")
	}
}

func TestHandcraftNoEnergyResumesFromRefuelWithoutConsumingInputsTwice(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronIngot: 1, model.ItemCoal: 2}
	// 被动回能是「每 4 tick +1」且只在 tick%4==0 时结算：把 tick 对齐到 1（模 4）后，
	// 连续 3 tick 都不会回能，可以干净地断言「能量不足就不推进」。
	unit.Mecha.Energy = 0
	ws.Tick = 1
	if result, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 1)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 2)
	if unit.Mecha.Job.State != "no_energy" || unit.Mecha.Job.RemainingTicks != 20 || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 0 {
		t.Fatal("craft advanced without enough energy")
	}
	result, _ := execCommand(core, model.CmdRefuelMecha, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": model.ItemCoal, "count": 1}})
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 20)
	if unit.Mecha.Job != nil || starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 0 || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 || starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 1 {
		t.Fatal("resume changed material accounting")
	}
}

func TestMechaJobValidationIsAtomic(t *testing.T) {
	for _, tc := range []struct {
		name     string
		recipe   string
		quantity any
		owner    string
		code     model.ResultCode
	}{
		{"zero", "gear", 0, "p1", model.CodeValidationFailed},
		{"fraction", "gear", 1.5, "p1", model.CodeValidationFailed},
		{"negative", "gear", -1, "p1", model.CodeValidationFailed},
		// 第 21 轮：craft 忽略 target.entity_id、按发令者解析机甲；p2 不存在
		// → EXECUTOR_UNAVAILABLE（不再从目标机甲判 NOT_OWNER）。
		{"owner", "gear", 1, "p2", model.CodeExecutorUnavailable},
		{"advanced", "quantum_chip", 1, "p1", model.CodeInvalidTarget},
		{"chemistry", "oil_fractionation", 1, "p1", model.CodeInvalidTarget},
		{"matrix", "electromagnetic_matrix", 1, "p1", model.CodeInvalidTarget},
		{"missing", "not-a-recipe", 1, "p1", model.CodeInvalidTarget},
		{"materials", "gear", 10, "p1", model.CodeInsufficientResource},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ws, unit := personalJobTestWorld()
			starterMecha(ws, "p1").Inventory = model.ItemInventory{model.ItemIronIngot: 2}
			result, _ := execCommand(&GameCore{}, model.CmdCraftItem, ws, tc.owner, handcraftCommand(tc.recipe, tc.quantity))
			if result.Code != tc.code || unit.Mecha.Job != nil || unit.Mecha.Energy != 100 || starterMecha(ws, "p1").Inventory[model.ItemIronIngot] != 2 {
				t.Fatalf("rejected job mutated state: %+v", result)
			}
		})
	}
	ws, unit := personalJobTestWorld()
	node := addManualCoal(ws, 2)
	core := &GameCore{}
	node.Kind = model.ItemCrudeOil
	if result, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(1)); result.Code != model.CodeInvalidTarget {
		t.Fatal(result)
	}
	node.Kind = model.ItemCoal
	if result, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(3)); result.Code != model.CodeInsufficientResource {
		t.Fatal(result)
	}
	if result, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(1)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	job := unit.Mecha.Job.Clone()
	if result, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 1)); result.Code != model.CodeInvalidTarget || !reflect.DeepEqual(job, unit.Mecha.Job) {
		t.Fatal("busy mecha replaced its job")
	}
}

func TestMechaCraftJobSnapshotCloneRestoreAndDeathRefund(t *testing.T) {
	ws, unit := personalJobTestWorld()
	core := &GameCore{}
	player := ws.Players["p1"]
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronIngot: 2}
	if result, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 23)
	saved := snapshot.CaptureWorld(ws)
	saved.Units[unit.ID].Mecha.Job.ReservedInputs[0].Quantity = 9
	if unit.Mecha.Job.ReservedInputs[0].Quantity != 1 {
		t.Fatal("snapshot aliases reserved ingredients")
	}
	saved = snapshot.CaptureWorld(ws)
	restored, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	advancePersonalTicks(restored, 17)
	if starterMecha(restored, "p1").Inventory[model.ItemGear] != 2 || restored.Units[unit.ID].Mecha.Job != nil {
		t.Fatal("restored job failed to complete exactly once")
	}
	if saved.Units[unit.ID].Mecha.Job.RemainingTicks != 17 || unit.Mecha.Job.RemainingTicks != 17 {
		t.Fatal("restore aliases snapshot or live job")
	}
	data, err := json.Marshal(unit)
	if err != nil {
		t.Fatal(err)
	}
	var decoded model.Unit
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded.Mecha, unit.Mecha) {
		t.Fatal("JSON omitted active job")
	}
	unit.HP = 0
	advancePersonalTicks(ws, 1)
	if unit.Mecha.Job != nil || starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 1 || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 {
		t.Fatal("death refund lost or duplicated materials")
	}
}

func TestNormalNewGameMinesCoalAndRefuelsWithoutBootstrapInventory(t *testing.T) {
	t.Parallel()
	cfg, err := config.Load("../../config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	mapCfg, err := mapconfig.Load("../../map.yaml")
	if err != nil {
		t.Fatal(err)
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	ws := core.World()
	player := ws.Players["p1"]
	unit := ws.Units[starterMecha(ws, player.PlayerID).UnitID]
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 0 {
		t.Fatal("test unexpectedly has bootstrap coal")
	}
	var coal *model.ResourceNodeState
	for _, node := range ws.Resources {
		if node.Kind == model.ItemCoal && node.Remaining > 0 && (coal == nil || ws.SurfaceDistance(unit.Position, node.Position) < ws.SurfaceDistance(unit.Position, coal.Position)) {
			coal = node
		}
	}
	if coal == nil {
		t.Fatal("ordinary start lacks coal")
	}
	// Use the real movement command to a reachable tile within mining distance.
	moved := ws.SurfaceDistance(unit.Position, coal.Position) <= 2
	if !moved {
		for _, tile := range ws.SurfaceDisc(coal.Position, 2) {
			result, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID, Position: &tile}})
			if result.Code == model.CodeOK {
				moved = true
				break
			}
		}
	}
	if !moved {
		t.Fatalf("cannot reach starting coal: executor=%+v coal=%+v", unit.Position, coal.Position)
	}
	before := coal.Remaining
	result, _ := execCommand(core, model.CmdMineResource, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"resource_id": coal.ID, "quantity": 1}})
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 10)
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 1 || coal.Remaining != before-1 {
		t.Fatal("ordinary new game did not mine real coal")
	}
	energy := unit.Mecha.Energy
	result, _ = execCommand(core, model.CmdRefuelMecha, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"item_id": model.ItemCoal, "count": 1}})
	if result.Code != model.CodeOK || unit.Mecha.Energy <= energy || starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 0 {
		t.Fatalf("ordinary start cannot refuel with mined coal: %+v", result)
	}
	t.Logf("new game coal %s at %+v: remaining %d->%d; energy %d->%d", coal.ID, coal.Position, before, coal.Remaining, energy, unit.Mecha.Energy)
}

func TestMechaJobDeathThroughAttackRefundsRemainingReservation(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronIngot: 2}
	if result, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 2)); result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 22)
	unit.HP = 1
	attacker := model.UnitStats(model.UnitTypeSoldier)
	attacker.ID, attacker.OwnerID, attacker.Type = "enemy", "p2", model.UnitTypeSoldier
	attacker.Position = model.Position{X: 2, Y: 1}
	ws.Units[attacker.ID] = &attacker
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	result, _ := execCommand(core, model.CmdAttack, ws, "p2", model.Command{Target: model.CommandTarget{EntityID: attacker.ID}, Payload: map[string]any{"target_entity_id": unit.ID}})
	if result.Code != model.CodeOK {
		t.Fatalf("attack order failed: %+v", result)
	}
	for i := 0; i < 40 && ws.Units[unit.ID] != nil; i++ {
		ws.Tick++
		settleUnitCombat(ws, nil)
	}
	if ws.Units[unit.ID] != nil || starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 1 || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 {
		t.Fatalf("combat deletion lost/duplicated reservation: %+v inventory=%v unit=%+v", result, starterMecha(ws, player.PlayerID).Inventory, ws.Units[unit.ID])
	}
}

func TestHandcraftRequiresRecipeResearchAndDoesNotReserveOnFailure(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: 2}
	result, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("coal_to_graphite", 1))
	if result.Code != model.CodeValidationFailed || unit.Mecha.Job != nil || starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 2 {
		t.Fatalf("locked recipe bypass: %+v", result)
	}
	player.Tech.CompletedTechs["smelting_purification"] = 1
	result, _ = execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("coal_to_graphite", 1))
	if result.Code != model.CodeOK {
		t.Fatal(result)
	}
	advancePersonalTicks(ws, 30)
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemEnergeticGraphite] != 1 || starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 0 {
		t.Fatal("unlocked handcraft fuel recipe failed")
	}
}

// 回归（试玩 1014 问题 1）：背包任何路径都不能超过机甲格数上限。
// 根因是手搓产出直接 starterMecha(ws, player.PlayerID).AddItems(output) 不看容量：
// 背包正好满格时搓出一批磁铁就超了，此后「取出」全部报「背包已满」。
// 第 17 轮（U5）起容量按格计：每格堆叠该物品的 stack_limit 件。
func TestMechaCraftOutputNeverExceedsInventoryCapacity(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	slots := setTestInventory(ws, unit, 0)
	coalPerSlot := model.ItemStackSize(model.ItemCoal)
	// 背包顶满：启动 2 批 gear 时一次性预留 2 个铁块（1 格），背包先腾出 1 格。
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: (slots - 1) * coalPerSlot, model.ItemIronIngot: 2}
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got != slots {
		t.Fatalf("setup inventory = %d slots, want %d", got, slots)
	}
	if res, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 2)); res.Code != model.CodeOK {
		t.Fatalf("craft start: %+v", res)
	}
	// gear 一批 20 tick：产出 1 个齿轮（1 格）。预留的 2 个铁块只占 1 格，
	// 第一批吃掉 1 个后剩下 1 个仍留在作业预留里（不在背包），齿轮占回那 1 格。
	advancePersonalTicks(ws, 20)
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got != slots || starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 || starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 0 {
		t.Fatalf("first batch must keep the bag full: %v", starterMecha(ws, player.PlayerID).Inventory)
	}
	// 把齿轮那格换成煤（背包仍然满格、且没有齿轮可叠加）：下一批没有空位，
	// 不得产出、不得超上限，作业停在 inventory_full 等腾空。
	delete(starterMecha(ws, player.PlayerID).Inventory, model.ItemGear)
	starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] += coalPerSlot
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got != slots {
		t.Fatalf("setup inventory = %d slots, want %d", got, slots)
	}
	advancePersonalTicks(ws, 20)
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got > slots {
		t.Fatalf("craft output pushed the bag over capacity: %d/%d", got, slots)
	}
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got != slots {
		t.Fatalf("blocked batch must leave the bag untouched, got %d/%d", got, slots)
	}
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 0 || starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 0 {
		t.Fatalf("blocked batch consumed or duplicated items: %v", starterMecha(ws, player.PlayerID).Inventory)
	}
	if unit.Mecha.Job == nil || unit.Mecha.Job.State != "inventory_full" || unit.Mecha.Job.CompletedBatches != 1 {
		t.Fatalf("job must stall as inventory_full with progress kept: %+v", unit.Mecha.Job)
	}
	// 满背包时不推进、不白扣能量（否则每 tick 白烧一份核心能量却毫无产出）。
	energyBefore := unit.Mecha.Energy
	ticksBefore := unit.Mecha.Job.RemainingTicks
	advancePersonalTicks(ws, 10)
	if unit.Mecha.Energy != energyBefore || unit.Mecha.Job.RemainingTicks != ticksBefore {
		t.Fatalf("full bag must not burn energy or advance the batch: energy %d->%d ticks %d->%d",
			energyBefore, unit.Mecha.Energy, ticksBefore, unit.Mecha.Job.RemainingTicks)
	}
	// 腾出 1 个空位（取走一格煤）：第二批自动继续，仍然不超上限。
	starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] -= coalPerSlot
	advancePersonalTicks(ws, 20)
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got > slots {
		t.Fatalf("resumed craft pushed the bag over capacity: %d/%d", got, slots)
	}
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemGear] != 1 {
		t.Fatalf("resumed batch did not produce: %v", starterMecha(ws, player.PlayerID).Inventory)
	}
	if unit.Mecha.Job != nil {
		t.Fatalf("job should be finished after the second batch: %+v", unit.Mecha.Job)
	}

}

// 手动采集同样受上限约束：背包满格时采集不产出（矿点不消耗、进度保留）。
func TestManualMiningNeverExceedsInventoryCapacity(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	slots := setTestInventory(ws, unit, 0)
	perSlot := model.ItemStackSize(model.ItemIronOre)
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemIronOre: slots * perSlot}
	node := addManualCoal(ws, 3)
	if res, _ := execCommand(core, model.CmdMineResource, ws, "p1", manualMineCommand(3)); res.Code != model.CodeOK {
		t.Fatalf("mine start: %+v", res)
	}
	advancePersonalTicks(ws, 10)
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got != slots {
		t.Fatalf("full bag must not gain mined items: %d/%d", got, slots)
	}
	if node.Remaining != 3 {
		t.Fatalf("blocked mining must not drain the node, remaining=%d", node.Remaining)
	}
	if unit.Mecha.Job == nil || unit.Mecha.Job.State != "inventory_full" {
		t.Fatalf("mining job must stall as inventory_full: %+v", unit.Mecha.Job)
	}
	// 腾出一格（拿走一整摞铁矿）：采矿自动继续。
	delete(starterMecha(ws, player.PlayerID).Inventory, model.ItemIronOre)
	advancePersonalTicks(ws, 10)
	if node.Remaining != 2 || starterMecha(ws, player.PlayerID).Inventory[model.ItemCoal] != 1 {
		t.Fatalf("mining did not resume after freeing space: node=%d inv=%v", node.Remaining, starterMecha(ws, player.PlayerID).Inventory)
	}
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got > slots {
		t.Fatalf("resumed mining pushed the bag over capacity: %d/%d", got, slots)
	}
}

// 取消作业的退款同样受上限约束（背包已满格时退款丢弃，不超上限）。
func TestMechaJobRefundNeverExceedsInventoryCapacity(t *testing.T) {
	ws, unit := personalJobTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}
	slots := setTestInventory(ws, unit, 0)
	perSlot := model.ItemStackSize(model.ItemCoal)
	// 启动时扣留 3 批 gear 的原料（3 铁块，1 格），背包里再放满煤占位。
	starterMecha(ws, player.PlayerID).Inventory = model.ItemInventory{model.ItemCoal: (slots - 1) * perSlot, model.ItemIronIngot: 3}
	if res, _ := execCommand(core, model.CmdCraftItem, ws, "p1", handcraftCommand("gear", 3)); res.Code != model.CodeOK {
		t.Fatalf("craft start: %+v", res)
	}
	// 铁矿变成预留原料，背包空出 1 格，用别的物品占满。
	starterMecha(ws, player.PlayerID).EnsureInventory()[model.ItemStoneOre] = 1
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got != slots {
		t.Fatalf("setup inventory = %d slots, want %d", got, slots)
	}
	if res, _ := execCommand(core, model.CmdCancelMechaJob, ws, "p1", model.Command{Target: model.CommandTarget{EntityID: unit.ID}}); res.Code != model.CodeOK {
		t.Fatalf("cancel: %+v", res)
	}
	if got := starterMecha(ws, player.PlayerID).Inventory.SlotsUsed(); got > slots {
		t.Fatalf("refund pushed the bag over capacity: %d/%d", got, slots)
	}
	if starterMecha(ws, player.PlayerID).Inventory[model.ItemIronIngot] != 0 {
		t.Fatalf("full bag should have discarded the refund, got %v", starterMecha(ws, player.PlayerID).Inventory)
	}
	if unit.Mecha.Job != nil {
		t.Fatalf("job not cleared: %+v", unit.Mecha.Job)
	}
}
