package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 脚本化开局的产线必须是「矿机 → 传送带 → 分拣器 → 熔炉」（第 16 轮契约 §3：
// 生产建筑不再与传送带直连，只有采集类 / 物流站 / 带上设备保留 direct_belt_io）。
//
// 这条用例盯三件事：
//  1. 脚本 20 条命令一条都不能被拒（落位/朝向算错时会被 POSITION_OCCUPIED 等拒掉）；
//  2. 两条产线各有一台分拣器（少了它矿机与熔炉之间就断了）；
//  3. 跑完后再等一会儿，两台熔炉真的从分拣器拿到矿并炼出了锭
//     （只有「矿石进了熔炉」才算这条链通了——分拣器朝向错、取货端没接到带子时，
//     熔炉会一直空转）。
func TestScriptedOpeningSorterLineDelivers(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	// 与 cp-root 的落点对齐：根层推到 tick 27 存档，脚本从同一 tick 起跑。
	for core.CurrentTick() < 27 {
		core.AdvanceTick()
	}
	run := core.RunScriptedOpeningDetailed("p1", 60000)
	for _, step := range run.Steps {
		if step.Result.Status != model.StatusExecuted {
			t.Fatalf("脚本第 %d 步被拒（角色 %s，命令 %s）：%s %s",
				step.Index, step.Role, step.Command.Type, step.Result.Code, step.Result.Message)
		}
	}
	// RunScriptedOpeningDetailed 在脚本走完时提前 break；没走完就会跑满 maxTicks。
	if run.EndTick >= 27+60000 {
		t.Fatalf("脚本在 60000 tick 内没走完（tick %d）", run.EndTick)
	}
	sorters := skirmishBuildingCounts(core.World(), "p1")[model.BuildingTypeSorterMk1]
	if sorters < 2 {
		t.Fatalf("两条产线各要一台分拣器，实际 %d 台", sorters)
	}

	// 熔炉的矿石全部来自「分拣器从带子上取货」：跑完再等 3000 tick，
	// 两台熔炉都该有锭（主库存 + 产物缓冲）。
	for core.CurrentTick() < run.EndTick+3000 {
		core.AdvanceTick()
	}
	ws := core.World()
	ingots := map[string]int{}
	smelters := 0
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Type != model.BuildingTypeArcSmelter || b.Storage == nil {
			continue
		}
		smelters++
		for _, item := range []string{model.ItemIronIngot, model.ItemCopperIngot} {
			ingots[item] += b.Storage.ItemQuantity(item)
		}
	}
	if smelters < 2 {
		t.Fatalf("铁铜两条产线各要一台熔炉，实际 %d 台", smelters)
	}
	t.Logf("tick %d 分拣器 %d 台、熔炉 %d 台、锭存量 %v", ws.Tick, sorters, smelters, ingots)
	if ingots[model.ItemIronIngot] <= 0 {
		t.Fatal("铁熔炉一个铁块都没炼出来：矿机 → 带子 → 分拣器 → 熔炉这条链没通")
	}
	if ingots[model.ItemCopperIngot] <= 0 {
		t.Fatal("铜熔炉一个铜块都没炼出来：矿机 → 带子 → 分拣器 → 熔炉这条链没通")
	}
}
