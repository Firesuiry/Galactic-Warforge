package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

// bot 科技链启动的定向回归（快）：整局回归 TestSkirmishFullMatchRegression 的
// 「bot 在 tick 90000 前启动科技链」断言拆出来的单 seed 版本，跑到 bot 应当
// 开始研究的时点即可判定（fail fast），用于定位/守住「矩阵备料链断掉」这类回归。
//
// 2026-10-14 回归：`fd8e18e`（生产落点分通道，成品只落输出缓冲 + 产出预留段）
// 之后 bot 的电磁矩阵再也进不了研究站——整局 6 seed 全部在 tick 90000 断言失败
// （completed=map[dyson_sphere_program:1] current=<nil> queue=0）。
//
// 判定口径与整局回归一致：电磁学完成、或正在研究、或已排队，即视为科技链已启动。
// 跑到 techDeadlineTicks（40000）仍未启动就失败，并打印矩阵链各环节的实况
// （研究站/矩阵专机/配方/备料/矩阵所在桶），便于直接看出是哪一环断了。
const techDeadlineTicks = 40000

func TestSkirmishBotTechChainStarts(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	ws := core.World()

	started := func() bool {
		tech := ws.Players["p2"].Tech
		if tech == nil {
			return false
		}
		return tech.CompletedTechs["electromagnetism"] > 0 ||
			tech.CurrentResearch != nil ||
			len(tech.ResearchQueue) > 0
	}

	var startedAt int64 = -1
	for ws.Tick < techDeadlineTicks {
		core.processTick()
		if started() {
			startedAt = ws.Tick
			break
		}
	}

	report := botTechChainReport(ws)
	t.Logf("tech chain started at tick %d; %s", startedAt, report)
	if startedAt < 0 {
		t.Fatalf("bot never started the tech chain by tick %d: %s", techDeadlineTicks, report)
	}
}

// botTechChainReport 打印矩阵链各环节的实况：研究站/矩阵专机是否建成、
// 配方是否设上、备料是否到位、矩阵当前落在哪个桶（输出缓冲 / 主库存 / 输入缓冲 /
// 机甲背包）——生产落点分通道之后，「矩阵是否出现在研究站能取到的桶里」是
// 判断链断在哪一环的关键。
func botTechChainReport(ws *model.WorldState) string {
	player := ws.Players["p2"]
	tech := player.Tech
	var labs, machines int
	var machineRecipe string
	var labMatrices, machineOut, machineInv, machineIn int
	var labCapacity int
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != "p2" || b.Storage == nil {
			continue
		}
		switch b.Type {
		case model.BuildingTypeMatrixLab:
			labs++
			labCapacity = b.Storage.Capacity
			labMatrices += b.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
		case model.BuildingTypeAssemblingMachineMk1:
			if b.Production != nil && b.Production.RecipeID == model.ItemElectromagneticMatrix {
				machines++
				machineRecipe = string(b.Production.RecipeID)
				machineOut += b.Storage.OutputBuffer[model.ItemElectromagneticMatrix]
				machineInv += b.Storage.Inventory[model.ItemElectromagneticMatrix]
				machineIn += b.Storage.InputBuffer[model.ItemElectromagneticMatrix]
			}
		}
	}
	return fmt.Sprintf(
		"tick=%d labs=%d(cap=%d matrices=%d) matrixMachines=%d(recipe=%q out=%d inv=%d in=%d) execMatrix=%d magCoil=%d circuit=%d completed=%v current=%v queue=%d",
		ws.Tick, labs, labCapacity, labMatrices, machines, machineRecipe,
		machineOut, machineInv, machineIn,
		player.Inventory[model.ItemElectromagneticMatrix],
		player.Inventory[model.ItemMagneticCoil],
		player.Inventory[model.ItemCircuitBoard],
		tech.CompletedTechs, tech.CurrentResearch, len(tech.ResearchQueue),
	)
}
