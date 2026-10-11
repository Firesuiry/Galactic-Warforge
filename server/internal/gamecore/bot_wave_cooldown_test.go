package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/model"
)

// 试玩 1014 P1/P2 的回归：bot 的波次节奏与弹尽回撤。
//
// P1：bot easy 首攻不是"一波打完就停"，而是每 300–600 tick 连推一波（首攻
// tick 60240 之后 60590、61326 各又来 4 个兵），玩家 8 个步兵被逐波耗光。
// 修复 = botTuning.waveCooldown（easy 12000 / normal 6000 / hard 2000）：
// 上一波军团出发后，冷却期内不再编新军团；锚点随存档持久化。
//
// P2：士兵打空后停在原地（no_ammunition + 无路径）僵持数百 tick，既不撤退
// 也不换目标。修复 = botLegionDecide 在"平均弹药低 **或任何一名成员弹尽**"
// 时整队回补给站/基地。

// botWaveScene 在 p2 基地旁放 attackAt 个散兵（够门槛编队），返回核心与世界。
func botWaveScene(t *testing.T, difficulty string) (*GameCore, *model.WorldState, botTuning) {
	t.Helper()
	core := newBotTestCore(t, difficulty)
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	tuning := botTuningFor(difficulty)
	botQuietExecutor(ws, "p2")
	spots := botFreeTiles(ws, home, 6, tuning.attackAt+2)
	if len(spots) < tuning.attackAt {
		t.Fatalf("need %d tiles, got %d", tuning.attackAt, len(spots))
	}
	for i := 0; i < tuning.attackAt; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", spots[i])
	}
	return core, ws, tuning
}

// formNextWave 计划并执行一条 form_squad（bot 编新军团的入口）。
func formNextWave(t *testing.T, core *GameCore, ws *model.WorldState, tuning botTuning) (model.Command, bool) {
	t.Helper()
	for _, cmd := range core.planBotCommands(ws, "p2", tuning) {
		if cmd.Type == model.CmdFormSquad {
			botExec(core, ws, cmd)
			return cmd, true
		}
	}
	return model.Command{}, false
}

// 波次冷却生效：第一波编队后，冷却窗口内散兵再次攒够门槛也不编新军团；
// 冷却一过立刻能编。
func TestBotWaveCooldownBlocksNextWave(t *testing.T) {
	core, ws, tuning := botWaveScene(t, "easy")
	if tuning.waveCooldown <= 0 {
		t.Fatal("easy 必须有波次冷却（否则首攻后连波压家）")
	}
	// 波次锚点用 tick 记（0 = 没发过波），所以测试从非零 tick 起步。
	ws.Tick = 1000
	if _, ok := formNextWave(t, core, ws, tuning); !ok {
		t.Fatal("第一波应该编得出来")
	}
	if len(ws.CombatRuntime.Squads) != 1 {
		t.Fatalf("want 1 squad, got %d", len(ws.CombatRuntime.Squads))
	}
	first := ws.Players["p2"].Bot
	if first == nil || first.LastWaveTick != ws.Tick {
		t.Fatalf("编队必须记下波次锚点：bot=%+v tick=%d", first, ws.Tick)
	}
	waveTick := first.LastWaveTick

	// 再补一批散兵（第一波已把原来的散兵带走），并把上一波军团打光（覆灭）。
	for _, squad := range ws.CombatRuntime.Squads {
		for _, id := range squad.MemberIDs {
			if u := ws.Units[id]; u != nil {
				u.HP = 0
			}
		}
	}
	home := botPlayerHome(t, ws, "p2")
	spots := botFreeTiles(ws, home, 6, tuning.attackAt)
	for i := 0; i < tuning.attackAt; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", spots[i])
	}
	core.processTick() // 结算掉被清空的军团

	// 冷却窗口内：散兵够门槛也不编队。
	ws.Tick = waveTick + tuning.waveCooldown - 1
	if cmd, ok := formNextWave(t, core, ws, tuning); ok {
		t.Fatalf("冷却未过（tick %d，锚点 %d，冷却 %d）不该编新军团：%+v",
			ws.Tick, waveTick, tuning.waveCooldown, cmd)
	}
	if ws.Players["p2"].Bot.LastWaveTick != waveTick {
		t.Fatalf("冷却期内不该改写锚点：%d", ws.Players["p2"].Bot.LastWaveTick)
	}
	// 冷却一过：能编。
	ws.Tick = waveTick + tuning.waveCooldown
	if _, ok := formNextWave(t, core, ws, tuning); !ok {
		t.Fatalf("冷却已过（tick %d）应该能编下一波", ws.Tick)
	}
	if ws.Players["p2"].Bot.LastWaveTick != ws.Tick {
		t.Fatalf("第二波应刷新锚点：%d want %d", ws.Players["p2"].Bot.LastWaveTick, ws.Tick)
	}
}

// 冷却跨存档读档延续：存档点记的是"上一波出发 tick"，读档后继续倒计时，
// 不会因为读档把冷却清零而立刻再推一波。
func TestBotWaveCooldownSurvivesCheckpoint(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	// newSaveHarnessDeps 的玩家没有 bot 难度；这里直接给 p2 挂上 bot 状态。
	cfg.Players[1].Bot = "easy"
	core := New(cfg, maps, q, bus, store)
	ws := core.World()
	tuning := botTuningFor("easy")
	home := botPlayerHome(t, ws, "p2")
	botQuietExecutor(ws, "p2")
	ws.Tick = 1000 // 锚点用 tick 记，0 表示"没发过波"
	spots := botFreeTiles(ws, home, 6, tuning.attackAt)
	for i := 0; i < tuning.attackAt; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", spots[i])
	}
	if _, ok := formNextWave(t, core, ws, tuning); !ok {
		t.Fatal("第一波应该编得出来")
	}
	waveTick := ws.Players["p2"].Bot.LastWaveTick
	save, err := core.ExportSaveFile("checkpoint:test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	raw, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal save: %v", err)
	}
	var decoded gamedir.SaveFile
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal save: %v", err)
	}
	restored, err := NewFromSave(cfg, maps, q, bus, nil, &decoded)
	if err != nil {
		t.Fatalf("restore from save: %v", err)
	}
	rws := restored.World()
	bot := rws.Players["p2"].Bot
	if bot == nil || bot.LastWaveTick != waveTick {
		t.Fatalf("读档后波次锚点丢失：bot=%+v want last_wave_tick=%d", bot, waveTick)
	}

	// 读档后把上一波打光、补散兵，冷却窗口内仍不该编队。
	for _, squad := range rws.CombatRuntime.Squads {
		for _, id := range squad.MemberIDs {
			if u := rws.Units[id]; u != nil {
				u.HP = 0
			}
		}
	}
	rspots := botFreeTiles(rws, botPlayerHome(t, rws, "p2"), 6, tuning.attackAt)
	for i := 0; i < tuning.attackAt; i++ {
		spawnWorldTestUnit(rws, model.UnitTypeSoldier, "p2", rspots[i])
	}
	restored.processTick()
	rws.Tick = waveTick + tuning.waveCooldown - 1
	if cmd, ok := formNextWave(t, restored, rws, tuning); ok {
		t.Fatalf("读档后冷却未过仍不该编队（tick %d，锚点 %d）：%+v", rws.Tick, waveTick, cmd)
	}
	rws.Tick = waveTick + tuning.waveCooldown
	if _, ok := formNextWave(t, restored, rws, tuning); !ok {
		t.Fatalf("读档后冷却到期（tick %d）应该能编下一波", rws.Tick)
	}
}

// 弹尽单位回撤：军团里**任何一名**作战单位打空（哪怕平均弹药还很高），
// 整队回补给站/基地，不再原地僵持。
func TestBotLegionFallsBackWhenAnyMemberDry(t *testing.T) {
	core, ws, tuning, squad := botLegionScene(t, "easy")
	home := botPlayerHome(t, ws, "p2")
	// 只有一名兵打空，其余满弹：平均弹药仍高于 resupplyBelowAmmo。
	dry := 0
	for _, id := range squad.MemberIDs {
		u := ws.Units[id]
		if u.AmmoCapacity == 0 {
			continue
		}
		if dry == 0 {
			u.Ammo, u.CombatState = 0, "no_ammunition"
			dry++
			continue
		}
		u.Ammo = u.AmmoCapacity
	}
	if dry == 0 {
		t.Fatal("测试夹具里没有耗弹单位")
	}
	if _, avg, minAmmo, _ := botLegionStats(ws, squad); minAmmo != 0 || avg < tuning.resupplyBelowAmmo {
		t.Fatalf("夹具应造成「平均不低、有人打空」：avg=%.2f min=%.2f", avg, minAmmo)
	}

	// 没有己方补给站：回基地。
	cmd, ok := botSquadCmd(core.planBotCommands(ws, "p2", tuning))
	if !ok || cmd.Payload["order"] != "retreat" || cmd.Target.Position == nil || *cmd.Target.Position != home {
		t.Fatalf("有人弹尽必须撤回基地：%+v (ok=%v)", cmd, ok)
	}
	// 有己方补给站：去补给站（服务端选站，target 由 resupply 自行决定）。
	addSupplyStation(ws, "own-supply", "p2", botTileAtDistance(t, ws, home, 4), model.ItemInventory{model.ItemAmmoBullet: 500})
	cmd, ok = botSquadCmd(core.planBotCommands(ws, "p2", tuning))
	if !ok || cmd.Payload["order"] != "resupply" {
		t.Fatalf("有人弹尽且有补给站时必须去补给：%+v (ok=%v)", cmd, ok)
	}
}

// 难度梯度：波次冷却随难度递减（hard 仍然凶）。
func TestBotWaveCooldownScalesWithDifficulty(t *testing.T) {
	easy, normal, hard := botTuningFor("easy"), botTuningFor("normal"), botTuningFor("hard")
	if !(easy.waveCooldown > normal.waveCooldown && normal.waveCooldown > hard.waveCooldown) {
		t.Fatalf("波次冷却必须随难度递减：easy=%d normal=%d hard=%d",
			easy.waveCooldown, normal.waveCooldown, hard.waveCooldown)
	}
	if hard.waveCooldown <= 0 {
		t.Fatal("hard 也要有冷却，只是很短（保持凶）")
	}
	// 人类玩家（Bot 状态为 nil）不受冷却限制。
	if !botWaveReady(nil, easy, 100) {
		t.Fatal("没有 bot 状态时不该受冷却限制")
	}
	if !botWaveReady(&model.PlayerState{}, easy, 100) {
		t.Fatal("零值 bot 状态（旧存档）视为没发过波，不该受冷却限制")
	}
}
