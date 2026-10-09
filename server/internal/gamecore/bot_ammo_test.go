package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// A1 遭遇战 bot 弹药链验收（回归：科技树死锁让玩家/bot 永远拿不到弹药）。
// 覆盖三段真实链路：开局即可产子弹 → 有研究站就研究 → 把弹药喂进补给站。
func TestA1BotAmmoChain(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()
	player := ws.Players["p2"]
	home := botPlayerHome(t, ws, "p2")
	botQuietExecutor(ws, "p2")
	tuning := botTuningFor("normal")
	botFillIndustry(t, ws, "p2", home, tuning)
	player.Resources.Minerals = 20000
	player.Resources.Energy = 20000

	place := func(id string, btype model.BuildingType) *model.Building {
		pos := botBuildSpotNear(ws, home, 24, model.BuildingTypeWindTurbine)
		if pos == nil {
			t.Fatalf("no tile for %s", btype)
		}
		building := newBuilding(id, btype, "p2", *pos)
		building.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, building)
		return building
	}
	// 每座关键建筑自带一台风机，供电不依赖 bot 自己拉线。
	powerNextTo := func(b *model.Building) {
		pos := botBuildSpotNear(ws, b.Position, 2, model.BuildingTypeWindTurbine)
		if pos == nil {
			t.Fatalf("no power tile near %s", b.ID)
		}
		generator := newBuilding("gen-"+b.ID, model.BuildingTypeWindTurbine, "p2", *pos)
		generator.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, generator)
	}

	// 1) 子弹开局可用：科技树死锁时 botRecipeFor 找不到任何可产出的配方。
	if recipe, ok := botRecipeFor(player, model.ItemAmmoBullet); !ok || recipe.ID != "ammo_bullet" {
		t.Fatalf("bot cannot produce ammo_bullet from the start (recipe=%+v ok=%v)", recipe, ok)
	}
	if !CanUseRecipeTech(player, "ammo_bullet") {
		t.Fatal("ammo_bullet must be usable without research")
	}

	// 2) 有运行中的研究站 + 矩阵，bot 会开研究并完成。
	lab := place("bot-lab", model.BuildingTypeMatrixLab)
	powerNextTo(lab)
	lab.Storage.EnsureInventory()[model.ItemElectromagneticMatrix] = 200
	researchedAt := -1
	for i := 0; i < 900 && researchedAt < 0; i++ {
		core.processTick()
		if len(player.Tech.CompletedTechs) > 1 {
			researchedAt = i
		}
	}
	if researchedAt < 0 {
		t.Fatalf("bot never completed research with a funded lab, techs=%v research=%v", player.Tech.CompletedTechs, player.Tech.CurrentResearch)
	}

	// 3) 补给站缺弹、机甲背着弹药时，bot 会把弹药运进补给站。
	// botIndustry 的前置要求（电感应塔/兵营/补给站）必须先存在，否则它会先去补齐它们。
	powerNextTo(place("bot-tesla", model.BuildingTypeTeslaTower))
	barracks := place("bot-barracks", "barracks")
	powerNextTo(barracks)
	barracks.Storage.EnsureInventory()[model.ItemIronIngot] = 40
	barracks.Storage.EnsureInventory()[model.ItemCircuitBoard] = 40
	station := place("bot-supply", "supply_station")
	powerNextTo(station)
	player.EnsureInventory()[model.ItemAmmoBullet] = 60
	delivered := false
	for i := 0; i < 600 && !delivered; i++ {
		core.runBotBrain(ws, "p2", tuning)
		core.processTick()

		if station.Storage.ItemQuantity(model.ItemAmmoBullet) > 0 {
			delivered = true
		}
	}
	if !delivered {
		t.Fatalf("bot never fed ammo_bullet into the supply station, station=%d inventory=%v",
			station.Storage.ItemQuantity(model.ItemAmmoBullet), player.Inventory)
	}
}
