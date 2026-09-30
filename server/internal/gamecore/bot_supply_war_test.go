package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 3.6：bot 的补给战——带补给车出击、袭扰敌方补给站、三档难度差异。

// botRaidScene：p2(bot) 有足量部队并带一辆补给车；p1 没有单位，
// 基地靠近 p2，另有一座远处的补给站和一座弹药厂。
func botRaidScene(t *testing.T, difficulty string) (*GameCore, *model.WorldState, botTuning, *model.Unit, model.Position, model.Position) {
	t.Helper()
	core := newBotTestCore(t, difficulty)
	ws := core.World()
	tuning := botTuningFor(difficulty)
	home := botPlayerHome(t, ws, "p2")
	hq := botPlayerHQ(t, ws, "p1")
	adj := botAdjacentFreeTile(ws, home, hq.ID)
	if adj == nil {
		t.Fatal("no tile next to the bot base")
	}
	botRelocateBuilding(ws, hq, *adj)
	for _, u := range ws.Units {
		if u != nil && u.OwnerID == "p1" {
			u.HP = 0
		}
	}
	spots := botFreeTiles(ws, home, 6, tuning.attackAt+2)
	if len(spots) < tuning.attackAt+1 {
		t.Fatalf("need %d tiles, got %d", tuning.attackAt+1, len(spots))
	}
	for i := 0; i < tuning.attackAt-1; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", spots[i])
	}
	truck := spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p2", spots[tuning.attackAt-1])

	for _, u := range ws.Units {
		if u != nil && u.OwnerID == "p2" {
			u.Ammo = u.AmmoCapacity // 出厂满弹
		}
	}
	supplyPos := botTileAtDistance(t, ws, home, 12)
	station := newBuilding("enemy-supply", btSupply, "p1", supplyPos)
	station.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, station)
	return core, ws, tuning, truck, supplyPos, hq.Position
}

// planAttackOrder 先让 bot 编队（form_squad 经真实接口执行），再取其 attack 军令；
// 返回军令与军团成员 ID。
func planAttackOrder(t *testing.T, core *GameCore, ws *model.WorldState, tuning botTuning) (model.Command, []string) {
	t.Helper()
	botQuietExecutor(ws, "p2")
	for round := 0; round < 3; round++ {
		for _, c := range core.planBotCommands(ws, "p2", tuning) {
			switch c.Type {
			case model.CmdSquadOrder:
				if c.Payload["order"] == "attack" {
					return c, ws.CombatRuntime.Squads[c.Payload["squad_id"].(string)].MemberIDs
				}
			case model.CmdFormSquad:
				botExec(core, ws, c)
			}
		}
	}
	t.Fatal("bot did not launch an attack")
	return model.Command{}, nil
}

func TestBotSortiesWithSupplyTruckAndRaidsSupplyStation(t *testing.T) {
	for _, difficulty := range []string{"normal", "hard"} {
		t.Run(difficulty, func(t *testing.T) {
			core, ws, tuning, truck, supplyPos, _ := botRaidScene(t, difficulty)
			cmd, members := planAttackOrder(t, core, ws, tuning)
			hasTruck := false
			for _, id := range members {
				if id == truck.ID {
					hasTruck = true
				}
			}
			if !hasTruck {
				t.Fatal("the supply truck must sortie with the army")
			}
			if cmd.Target.Position == nil || ws.SurfaceDistance(*cmd.Target.Position, supplyPos) > 1 {
				t.Fatalf("raid must aim at the enemy supply station %+v, got %+v", supplyPos, cmd.Target.Position)
			}
		})
	}
}

func TestBotEasyGoesForTheBaseNotTheSupplyChain(t *testing.T) {
	core, ws, tuning, _, supplyPos, hqPos := botRaidScene(t, "easy")
	cmd, _ := planAttackOrder(t, core, ws, tuning)
	if cmd.Target.Position == nil {
		t.Fatal("no attack target")
	}
	if ws.SurfaceDistance(*cmd.Target.Position, supplyPos) <= 1 {
		t.Fatal("easy bot must not raid supply lines")
	}
	if ws.SurfaceDistance(*cmd.Target.Position, hqPos) > 12 {
		t.Fatalf("easy bot heads for the enemy base area, got %+v (hq %+v)", cmd.Target.Position, hqPos)
	}
}

func TestBotRaidTargetsAmmoFactoryToo(t *testing.T) {
	core, ws, tuning, _, _, _ := botRaidScene(t, "hard")
	// 拆掉补给站，只剩弹药厂。
	old := ws.Buildings["enemy-supply"]
	delete(ws.Buildings, old.ID)
	ws.UnindexBuilding(old)
	home := botPlayerHome(t, ws, "p2")
	facPos := botTileAtDistance(t, ws, home, 10)
	fac := newBuilding("enemy-ammo", model.BuildingType("assembling_machine_mk1"), "p1", facPos)
	fac.Production = &model.ProductionState{RecipeID: model.ItemAmmoBullet}
	fac.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, fac)
	cmd, _ := planAttackOrder(t, core, ws, tuning)
	if cmd.Target.Position == nil || ws.SurfaceDistance(*cmd.Target.Position, facPos) > 1 {
		t.Fatalf("raid must aim at the ammo factory %+v, got %+v", facPos, cmd.Target.Position)
	}
}

func TestBotDifficultyShapesArmyComposition(t *testing.T) {
	army := func(n int) *botSurvey {
		ctx := &botSurvey{}
		for i := 0; i < n; i++ {
			ctx.soldiers = append(ctx.soldiers, &model.Unit{Type: model.UnitTypeSoldier})
		}
		ctx.soldierCount = n
		return ctx
	}
	has := func(types []model.UnitType, want model.UnitType) bool {
		for _, typ := range types {
			if typ == want {
				return true
			}
		}
		return false
	}
	easy, normal, hard := botTuningFor("easy"), botTuningFor("normal"), botTuningFor("hard")
	if !(easy.supportAt > normal.supportAt && normal.supportAt > hard.supportAt) {
		t.Fatalf("supportAt must shrink with difficulty: %d %d %d", easy.supportAt, normal.supportAt, hard.supportAt)
	}
	if !(easy.heavyAt > normal.heavyAt && normal.heavyAt > hard.heavyAt) {
		t.Fatalf("heavyAt must shrink with difficulty: %d %d %d", easy.heavyAt, normal.heavyAt, hard.heavyAt)
	}
	if easy.raidSupply || !normal.raidSupply || !hard.raidSupply {
		t.Fatal("only easy skips supply raids")
	}
	for name, tuning := range map[string]botTuning{"easy": easy, "normal": normal, "hard": hard} {
		below := botArmyPreference(army(tuning.supportAt-1), tuning)
		if has(below, model.UnitTypeSupplyTruck) {
			t.Errorf("%s: supply truck before %d troops", name, tuning.supportAt)
		}
		if !has(botArmyPreference(army(tuning.supportAt), tuning), model.UnitTypeSupplyTruck) {
			t.Errorf("%s: no supply truck at %d troops", name, tuning.supportAt)
		}
		if has(botArmyPreference(army(tuning.heavyAt-1), tuning), model.UnitTypeArtillery) {
			t.Errorf("%s: artillery before %d troops", name, tuning.heavyAt)
		}
		if !has(botArmyPreference(army(tuning.heavyAt), tuning), model.UnitTypeArtillery) {
			t.Errorf("%s: no artillery at %d troops", name, tuning.heavyAt)
		}
	}
	// 已有补给车（含排队中）就不再重复要。
	ctx := army(hard.supportAt)
	ctx.soldiers = append(ctx.soldiers, &model.Unit{Type: model.UnitTypeSupplyTruck})
	if has(botArmyPreference(ctx, hard), model.UnitTypeSupplyTruck) {
		t.Fatal("bot must not stack supply trucks")
	}
}
