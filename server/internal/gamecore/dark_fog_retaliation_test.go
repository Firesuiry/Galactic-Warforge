package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// 试玩 1014 TC-07 回归：黑雾敌对计时只由玩家主动挑衅顺延 + 报复强度封顶。
//
// 复现的问题：玩家打爆 level 4 巢穴后撤兵停火，黑雾单位/波次继续扑向基地，
// 玩家单位与机甲的**自动还手**每 tick 都调用 provokeDarkFog，把
// hostile_until_tick 一直往后推（实测 71596→77596→78681），玩家永远回不到中立，
// 最终基地被拆光、p1 被淘汰。

// ---- A：敌对计时口径 ----

// 自卫还手不顺延：打一个正在攻击自己的黑雾单位不算挑衅。
func TestDarkFogRetaliationDoesNotExtendHostility(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.DarkFogCalmTicks = 500
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-a", 1, 200, model.Position{X: 40, Y: 40})
	provokeDarkFogFor(ws, "p1")
	until := ws.Players["p1"].DarkFog.HostileUntilTick

	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 10, Y: 10})
	fog := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 11, Y: 10})
	fog.MaxHP, fog.HP = 400, 400
	// 黑雾单位正锁定这个步兵：这就是"自卫还手"的判定条件。
	fog.AttackTarget = soldier.ID
	soldierHP := soldier.HP

	for i := 0; i < 30; i++ {
		ws.Tick++
		settleUnitCombat(ws, nil)
	}
	if soldier.HP == soldierHP {
		t.Fatal("soldier should have traded fire with the attacking dark fog unit")
	}
	if fog.HP == fog.MaxHP {
		t.Fatal("soldier should have fired back at the attacking dark fog unit")
	}
	if got := ws.Players["p1"].DarkFog.HostileUntilTick; got != until {
		t.Fatalf("retaliation must not extend hostility: until=%d want %d", got, until)
	}
}

// 主动攻击顺延：下令攻击一个当时没有在攻击该玩家的黑雾单位。
func TestDarkFogAggressiveAttackExtendsHostility(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.DarkFogCalmTicks = 500
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-b", 1, 200, model.Position{X: 40, Y: 40})
	provokeDarkFogFor(ws, "p1")
	until := ws.Players["p1"].DarkFog.HostileUntilTick

	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 10, Y: 10})
	fog := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 11, Y: 10})
	// 这个黑雾单位不还手、不索敌（AggroRange=0、Attack=0）：玩家打它纯属主动挑衅。
	fog.Attack, fog.AggroRange = 0, 0
	fog.MaxHP, fog.HP = 400, 400
	soldier.AttackTarget = fog.ID

	ws.Tick++
	settleUnitCombat(ws, nil)

	if fog.HP == fog.MaxHP {
		t.Fatal("soldier should have damaged the target")
	}
	want := ws.Tick + ws.DarkFogCalmTicks
	if got := ws.Players["p1"].DarkFog.HostileUntilTick; got != want {
		t.Fatalf("attacking a non-retaliating dark fog unit must extend hostility: until=%d want %d (was %d)", got, want, until)
	}
	if got := ws.Players["p1"].DarkFog.HostileUntilTick; got <= until {
		t.Fatalf("hostility timer must move forward, got %d (was %d)", got, until)
	}
}

// 黑雾建筑（巢穴）永远是主动挑衅：静态强度点不会主动攻击，打它一定是玩家挑的事。
func TestDarkFogStrikeOnNestIsAlwaysAggressive(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.DarkFogCalmTicks = 500
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-c", 1, 200, model.Position{X: 10, Y: 11})

	// 没有黑雾单位，只有一座巢穴：第一次打它就是挑衅。
	if darkFogForceIsStatic(&ws.EnemyForces.Forces[0]) != true {
		t.Fatal("hive must be classified as a static dark fog strength point")
	}
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 10, Y: 10})
	res, events := execCommand(core, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityID: soldier.ID},
		Payload: map[string]any{"target_entity_id": "nest-c"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("attack on a neutral nest must be accepted, got %s (%s)", res.Code, res.Message)
	}
	ws.Tick++
	events = append(events, settleUnitCombat(ws, nil)...)
	if len(eventsOfType(events, model.EvtDarkFogProvoked)) != 1 {
		t.Fatalf("attacking a nest must provoke the dark fog, events=%+v", eventsOfType(events, model.EvtDarkFogProvoked))
	}
	if !ws.Players["p1"].DarkFog.Hostile {
		t.Fatal("p1 must become hostile after striking the nest")
	}
}

// darkFogUnitIsRetaliating 的判定表：锁定玩家单位/建筑、或玩家单位记着它是攻击者 → 还手。
func TestDarkFogRetaliationPredicate(t *testing.T) {
	ws := newRTTWorld(false)
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 5, Y: 5})
	plant := newBuilding("plant-pred", model.BuildingTypeWindTurbine, "p1", model.Position{X: 6, Y: 6})
	placeBuilding(ws, plant)

	// 空闲黑雾单位：不算还手。
	idle := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 8, Y: 8})
	if darkFogUnitIsRetaliating(ws, idle) {
		t.Fatal("idle dark fog unit must not count as retaliating")
	}
	// 锁定玩家单位。
	idle.AttackTarget = soldier.ID
	if !darkFogUnitIsRetaliating(ws, idle) {
		t.Fatal("dark fog unit targeting a player unit is retaliating")
	}
	// 锁定玩家建筑（波次奔袭）。
	idle.AttackTarget = plant.ID
	if !darkFogUnitIsRetaliating(ws, idle) {
		t.Fatal("dark fog unit marching on a player building is retaliating")
	}
	// 玩家单位记着它是最近攻击者。
	idle.AttackTarget = ""
	soldier.LastAttackerID = idle.ID
	if !darkFogUnitIsRetaliating(ws, idle) {
		t.Fatal("dark fog unit recorded as a unit's last attacker is retaliating")
	}
}

// 袭击目标选择必须与 map 迭代顺序无关：等优先级等距离时按建筑 ID 定序。
// 否则同一存档在不同进程里会选出不同目标，回放/读档不再逐 tick 一致。
func TestBlackFogRaidTargetSelectionIsDeterministic(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	// 两座同类建筑到巢穴等距（rank 相同、距离相同）：只有 ID 兜底能定序。
	for _, spec := range []struct {
		id  string
		pos model.Position
	}{{"tie-b", model.Position{X: 30, Y: 30}}, {"tie-a", model.Position{X: 30, Y: 30}}} {
		b := newBuilding(spec.id, model.BuildingTypeWindTurbine, "p1", spec.pos)
		b.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, b)
	}
	provokeDarkFogFor(ws, "p1")
	for _, id := range []string{"tie-a", "tie-b"} {
		if ws.Buildings[id] == nil {
			t.Fatalf("fixture must place %s, got %d buildings", id, len(ws.Buildings))
		}
	}

	first := ""
	for i := 0; i < 64; i++ {
		target := selectBlackFogRaidTarget(ws, model.Position{X: 40, Y: 40})
		if target == nil {
			t.Fatal("expected a raid target")
		}
		if i == 0 {
			first = target.building.ID
			continue
		}
		if target.building.ID != first {
			t.Fatalf("raid target selection is not stable: got %s, first was %s", target.building.ID, first)
		}
	}
	if first != "tie-a" {
		t.Fatalf("tie must break by building id: got %s want tie-a", first)
	}
}

// ---- B：报复强度封顶 ----

// 报复波次规模有上限：单波进攻队 ≤ raidWaveCap，全场在途进攻队 ≤ raidUnitCap；
// 守军补员不受上限约束（被激怒的巢穴仍然补防）。
func TestDarkFogRaidWaveSizeIsCapped(t *testing.T) {
	core := newBlackFogTestCore(t, "easy")
	ws := core.World()
	tuning := blackFogTuningFor("easy")
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatMeter: 100000}
	// 五座高等级巢穴同时到孵化时刻：无上限时每座会派出 waveSize 个进攻单位。
	for i := 0; i < 5; i++ {
		spawnE4Nest(ws, "nest-cap-"+string(rune('a'+i)), 6, 400, model.Position{X: 40 + i, Y: 40})
	}
	plant := newBuilding("plant-cap", model.BuildingTypeWindTurbine, "p1", model.Position{X: 20, Y: 20})
	placeBuilding(ws, plant)
	provokeDarkFogFor(ws, "p1")
	for i := range ws.EnemyForces.Forces {
		ws.EnemyForces.Forces[i].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	}

	events := driveBlackFogTicks(core, ws, 1)
	waves := eventsOfType(events, model.EvtEnemyWaveIncoming)
	if len(waves) == 0 {
		t.Fatal("expected at least one raid wave")
	}
	totalRaiders := 0
	for _, wave := range waves {
		raiders, _ := wave.Payload["raiders"].(int)
		guards, _ := wave.Payload["guards"].(int)
		if raiders > tuning.raidWaveCap {
			t.Fatalf("single wave dispatched %d raiders, cap is %d", raiders, tuning.raidWaveCap)
		}
		if raiders < 1 {
			t.Fatalf("a wave event must carry at least one raider, got %+v", wave.Payload)
		}
		// 守军补员不受报复上限影响。
		if wantGuards := blackFogGuardCap(6, tuning); guards != wantGuards {
			t.Fatalf("guards must be topped up regardless of the raid cap: got %d want %d", guards, wantGuards)
		}
		totalRaiders += raiders
	}
	if totalRaiders > tuning.raidUnitCap {
		t.Fatalf("total raiders across nests %d exceeds raid unit cap %d", totalRaiders, tuning.raidUnitCap)
	}
	if got := blackFogRaidUnitCount(ws); got != totalRaiders || got > tuning.raidUnitCap {
		t.Fatalf("in-flight raiders %d must equal spawned %d and stay within cap %d", got, totalRaiders, tuning.raidUnitCap)
	}

	// 继续推进：在途进攻队到上限后不再增兵。
	for i := range ws.EnemyForces.Forces {
		ws.EnemyForces.Forces[i].LastWaveTick = ws.Tick - blackFogWaveInterval(6)
	}
	driveBlackFogTicks(core, ws, 5)
	if got := blackFogRaidUnitCount(ws); got > tuning.raidUnitCap {
		t.Fatalf("in-flight raiders grew past the cap: %d > %d", got, tuning.raidUnitCap)
	}
}

// 恢复中立后立即停发新波次，已在途的进攻队撤回巢穴。
func TestDarkFogStopsWavesAfterCalm(t *testing.T) {
	core := newBlackFogTestCore(t, "easy")
	ws := core.World()
	ws.DarkFogCalmTicks = 200
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatMeter: 500}
	for i := 0; i < 3; i++ {
		spawnE4Nest(ws, "nest-stop-"+string(rune('a'+i)), 3, 200, model.Position{X: 30 + i*4, Y: 30})
	}
	plant := newBuilding("plant-stop", model.BuildingTypeWindTurbine, "p1", model.Position{X: 20, Y: 20})
	placeBuilding(ws, plant)
	provokeDarkFogFor(ws, "p1")
	// 让三座巢穴立刻到孵化时刻：否则 200 tick 的冷静期窗口短于 3 级巢穴的孵化间隔（533 tick）。
	for i := range ws.EnemyForces.Forces {
		ws.EnemyForces.Forces[i].LastWaveTick = ws.Tick - blackFogWaveInterval(3)
	}

	var events []*model.GameEvent
	for i := 0; i < int(ws.DarkFogCalmTicks)+1; i++ {
		ws.Tick++
		events = append(events, driveBlackFogTicks(core, ws, 1)...)
		events = append(events, settleDarkFogCalm(ws.Players, ws.Tick)...)
	}
	if ws.Players["p1"].DarkFog.Hostile {
		t.Fatalf("dark fog must calm down after the calm window: %+v", ws.Players["p1"].DarkFog)
	}
	if len(eventsOfType(events, model.EvtEnemyWaveIncoming)) == 0 {
		t.Fatal("expected raids while hostile")
	}

	// 中立后再跑一段：不再有新波次，在途进攻队撤销奔袭。
	post := eventsOfType(driveBlackFogTicks(core, ws, blackFogRaidReassignTicks*3), model.EvtEnemyWaveIncoming)
	if len(post) != 0 {
		t.Fatalf("neutral dark fog must not send new raids, got %d", len(post))
	}
	for _, unit := range ws.Units {
		if unit == nil || unit.OwnerID != model.DarkFogOwnerID || unit.HP <= 0 {
			continue
		}
		if unit.Stance == model.UnitStanceGuard {
			continue
		}
		if unit.Stance == model.UnitStanceAttackMove || unit.AttackTarget != "" {
			t.Fatalf("calmed dark fog unit %s still raiding: stance=%s target=%s", unit.ID, unit.Stance, unit.AttackTarget)
		}
	}
}

// ---- 场景复现：试玩 1014 TC-07 ----

// 复现 TC-07：tick ~70000，玩家用步兵打 level 4 巢穴激怒黑雾 → 撤兵停火 →
// 黑雾三处巢穴报复基地、玩家单位自动还手。断言：
//   - 玩家（HQ + 建筑 + 单位）存活到恢复中立；
//   - 最后一次主动挑衅后正好 dark_fog_calm_ticks 恢复中立（dark_fog_calmed），
//     自动还手没有把 hostile_until_tick 顺延；
//   - 中立后不再有新波次。
func TestDarkFogRaidScenarioPlayerSurvivesAndCalms(t *testing.T) {
	if testing.Short() {
		t.Skip("整局黑雾报复场景复现（6000 tick 敌对窗口 + 2000 tick 观察，单跑约 145 秒）；用 -run 单跑")
	}
	t.Parallel()
	core := newBlackFogTestCore(t, "easy")
	ws := core.World()
	ws.Tick = 70000
	ws.DarkFogCalmTicks = 6000
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatMeter: 300} // level 4

	home := model.Position{X: 20, Y: 20}
	hq := newBuilding("hq-tc07", model.BuildingTypeBattlefieldAnalysisBase, "p1", home)
	hq.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, hq)
	// 基地：两座风机（袭击优先级最高）+ 一座仓库，外加弹药补给站。
	// 细分网格：HQ 占 5×5（x20..24,y20..24），附属建筑必须摆到占地之外，
	// 否则会压在 HQ 上（IndexBuilding 失败退化成锚点登记）。
	for i, pos := range []model.Position{{X: 27, Y: 22}, {X: 14, Y: 22}, {X: 22, Y: 27}} {
		b := newBuilding("base-"+string(rune('a'+i)), model.BuildingTypeWindTurbine, "p1", pos)
		b.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, b)
	}
	supply := newBuilding("supply-tc07", model.BuildingTypeSupplyStation, "p1", model.Position{X: 22, Y: 14})
	supply.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, supply)
	if _, _, err := supply.Storage.Load(model.ItemAmmoBullet, 4000); err != nil {
		t.Fatalf("load supply station ammo: %v", err)
	}

	// 10 个步兵守家。细分网格：步兵射程 6、aggro 15，守军按 3 格一圈摆开
	// （紧贴 HQ 的 5×5 占地会落在建筑里，摆不进单位）。
	for _, d := range []model.Position{{X: 3, Y: 0}, {X: -3, Y: 0}, {X: 0, Y: 3}, {X: 3, Y: 3}, {X: -3, Y: -3},
		{X: 6, Y: 0}, {X: -6, Y: 0}, {X: 0, Y: 6}, {X: 6, Y: 6}, {X: -6, Y: -6}} {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: home.X + d.X, Y: home.Y + d.Y})
	}
	mecha := findExecutorUnit(t, ws)

	// 三处 level 4 巢穴（含被打的那座），距基地 128 cell——细分网格后距离类数值 ×3，
	// 原来的「40+ 格」在 cell 坐标下就是 120+，巢穴太近会让蜂群在玩家还手前就压到基地。
	nests := []model.Position{{X: 143, Y: 15}, {X: 163, Y: 35}, {X: 128, Y: 40}}
	for i, pos := range nests {
		spawnE4Nest(ws, "nest-tc07-"+string(rune('a'+i)), 4, 220, pos)
	}

	// 突击队：一个步兵走到第一座巢穴旁边下令攻击（= TC-07 的「打巢穴」），
	// 打出一次伤害触发 dark_fog_provoked，然后停止并撤回基地。
	raider := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", freeTileNear(t, ws, nests[0], 1, 3))
	res, _ := execCommand(core, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityID: raider.ID},
		Payload: map[string]any{"target_entity_id": "nest-tc07-a"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("attack order on the nest must be accepted, got %s (%s)", res.Code, res.Message)
	}
	var provokedAt int64 = -1
	for i := 0; i < 60 && provokedAt < 0; i++ {
		ws.Tick++
		settleUnitMovement(ws)
		settleUnitCombat(ws, nil)
		if ws.Players["p1"].DarkFog.Hostile {
			provokedAt = ws.Tick
		}
	}
	if provokedAt < 0 {
		t.Fatal("striking the nest must provoke the dark fog")
	}
	until := ws.Players["p1"].DarkFog.HostileUntilTick
	if until != provokedAt+ws.DarkFogCalmTicks {
		t.Fatalf("hostility window wrong: until=%d provokedAt=%d", until, provokedAt)
	}
	// 撤兵停火：突击队停止并回基地（此后玩家不再主动打黑雾）。
	if res, _ := execCommand(core, model.CmdUnitOrder, ws, "p1", model.Command{
		Type:   model.CmdUnitOrder,
		Target: model.CommandTarget{EntityID: raider.ID},
		Payload: map[string]any{
			"order": "stop",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("stop order failed: %s (%s)", res.Code, res.Message)
	}
	teleportUnitForTest(ws, raider, model.Position{X: 21, Y: 21})
	teleportUnitForTest(ws, mecha, model.Position{X: 19, Y: 19})

	// 跑到恢复中立之后 2000 tick。
	var events []*model.GameEvent
	calmTick := int64(-1)
	for ws.Tick < until+2000 {
		ws.Tick++
		events = append(events, settleUnitMovement(ws)...)
		events = append(events, settleUnitCombat(ws, nil)...)
		settleAmmunitionSupply(ws)
		events = append(events, core.settleEnemyForces(ws)...)
		calmEvents := settleDarkFogCalm(ws.Players, ws.Tick)
		if len(calmEvents) > 0 {
			calmTick = ws.Tick
		}
		events = append(events, calmEvents...)
	}

	// 最后一次主动挑衅（打巢穴）之后玩家只有自卫还手，敌对计时不再顺延：
	// 恰好 calm_ticks 后恢复中立。
	if calmTick != until {
		t.Fatalf("dark fog must calm exactly at the last provocation + calm ticks: calmTick=%d want %d", calmTick, until)
	}
	if ws.Players["p1"].DarkFog.Hostile {
		t.Fatalf("p1 must be neutral again, got %+v", ws.Players["p1"].DarkFog)
	}
	calmed := eventsOfType(events, model.EvtDarkFogCalmed)
	if len(calmed) != 1 || calmed[0].Payload["player_id"] != "p1" {
		t.Fatalf("expected exactly one dark_fog_calmed for p1, got %+v", calmed)
	}

	// 玩家存活：p1 未被淘汰、HQ 与基地建筑仍在（试玩 1014 里同一场景是 buildings_lost=19、
	// tick 72307 就被淘汰），并且至少还有守军活着。
	if ws.Players["p1"] == nil || !ws.Players["p1"].IsAlive {
		t.Fatal("p1 must survive the retaliation")
	}
	if ws.Buildings[hq.ID] == nil || ws.Buildings[hq.ID].HP <= 0 {
		t.Fatal("p1 HQ must survive the retaliation")
	}
	if got := ws.Players["p1"].Stats.CombatStats.BuildingsLost; got > 3 {
		t.Fatalf("retaliation should not level the base: buildings_lost=%d", got)
	}
	alive := 0
	for _, unit := range ws.Units {
		if unit != nil && unit.OwnerID == "p1" && unit.HP > 0 {
			alive++
		}
	}
	if alive == 0 {
		t.Fatal("the base must still have defenders after the retaliation")
	}
	// 报复强度封顶：整场在途进攻队从未超过 raidUnitCap（守军不计）。
	if got := blackFogRaidUnitCount(ws); got > blackFogTuningFor("easy").raidUnitCap {
		t.Fatalf("in-flight raiders %d exceeded the cap %d", got, blackFogTuningFor("easy").raidUnitCap)
	}

	// 中立后不再发新波次。
	post := eventsOfType(driveBlackFogTicks(core, ws, 2000), model.EvtEnemyWaveIncoming)
	if len(post) != 0 {
		t.Fatalf("neutral dark fog must not send new raids, got %d", len(post))
	}
}

// freeTileNear 在 center 的 [minD,maxD] 环带里找一个空的可进入格。
func freeTileNear(t *testing.T, ws *model.WorldState, center model.Position, minD, maxD int) model.Position {
	t.Helper()
	for d := minD; d <= maxD; d++ {
		for _, candidate := range ws.SurfaceDisc(center, d) {
			if ws.SurfaceDistance(center, candidate) != d {
				continue
			}
			if !ws.InBounds(candidate.X, candidate.Y) || !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
				continue
			}
			if len(ws.TileUnits[model.TileKey(candidate.X, candidate.Y)]) > 0 {
				continue
			}
			return candidate
		}
	}
	t.Fatalf("no free tile at distance %d-%d from %+v", minD, maxD, center)
	return model.Position{}
}
