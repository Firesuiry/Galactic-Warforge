package gamecore

import (
	"encoding/json"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// 读档回归（命名存档点验收 7a/7b/7c）：存档点读档必须保住 bot 首攻时刻、
// 机甲手搓作业与黑雾敌对关系——三者都是"看起来在跑、读档后却悄悄丢"的高危状态。

// restoreCore 走一次真实 JSON 序列化再装配：只依赖真正持久化的字段。
func restoreCore(t *testing.T, cfg *config.Config, mapCfg *mapconfig.Config, save *gamedir.SaveFile) *GameCore {
	t.Helper()
	raw, err := json.Marshal(save)
	if err != nil {
		t.Fatalf("marshal save: %v", err)
	}
	var decoded gamedir.SaveFile
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal save: %v", err)
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core, err := NewFromSave(cfg, maps, queue.New(), NewEventBus(), nil, &decoded)
	if err != nil {
		t.Fatalf("restore from save: %v", err)
	}
	return core
}

// 7a：bot 首攻前存档 → 读档 → bot 仍按 bot_first_attack_tick 发起进攻，
// 且读档后的首攻时刻与不读档的连续模拟完全一致。
func TestCheckpointKeepsBotFirstAttackSchedule(t *testing.T) {
	cfg, err := config.Load("../../config-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	// 把首攻门槛压到 2000 tick，测试才跑得动（实测首攻落在门槛后约 350 tick）。
	cfg.Battlefield.MapSeed = "skirmish-seed-001"
	cfg.Battlefield.BotFirstAttackTick = 2000
	cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	mapCfg, err := mapconfig.Load("../../map-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}

	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	ws := core.World()
	for ws.Tick < cfg.Battlefield.BotFirstAttackTick {
		core.processTick()
	}
	if skirmishBotAttackingPlayer(ws) {
		t.Fatalf("bot already attacking at gate tick %d: 存档点不再是「首攻前」", ws.Tick)
	}
	savedTick := ws.Tick
	save, err := core.ExportSaveFile("checkpoint:test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}

	// 对照组：不读档，继续跑到首攻。
	origFirst := int64(-1)
	for ws.Tick < 4000 {
		core.processTick()
		if origFirst < 0 && skirmishBotAttackingPlayer(ws) {
			origFirst = ws.Tick
		}
	}
	if origFirst < 0 {
		t.Fatal("baseline run never attacked: 测试夹具失效")
	}

	// 读档组：从存档点恢复后继续跑。
	restored := restoreCore(t, cfg, mapCfg, save)
	rws := restored.World()
	if rws.Tick != savedTick {
		t.Fatalf("读档 tick 不一致: got %d want %d", rws.Tick, savedTick)
	}
	if skirmishBotAttackingPlayer(rws) {
		t.Fatalf("读档瞬间 bot 已在进攻（存档时并未进攻）")
	}
	loadedFirst := int64(-1)
	for rws.Tick < 4000 {
		restored.processTick()
		if loadedFirst < 0 && skirmishBotAttackingPlayer(rws) {
			loadedFirst = rws.Tick
		}
	}
	if loadedFirst < 0 {
		t.Fatalf("读档后 bot 再未进攻（存档 tick=%d，首攻门槛=%d）：军团/调查状态丢失",
			savedTick, cfg.Battlefield.BotFirstAttackTick)
	}
	if loadedFirst < cfg.Battlefield.BotFirstAttackTick {
		t.Fatalf("读档后 bot 在 %d 就进攻，早于 bot_first_attack_tick %d", loadedFirst, cfg.Battlefield.BotFirstAttackTick)
	}
	if loadedFirst != origFirst {
		t.Fatalf("读档改变了首攻时刻：不读档=%d 读档=%d（存档 tick=%d）", origFirst, loadedFirst, savedTick)
	}
	t.Logf("bot 首攻: 不读档=%d 读档=%d（存档 tick=%d）", origFirst, loadedFirst, savedTick)
}

// 7b：机甲手搓作业存档 → 读档 → 作业进度、预留原料与最终产出都不丢。
func TestCheckpointKeepsMechaHandcraftJob(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	core := New(cfg, maps, q, bus, store)
	ws := core.World()
	player := ws.Players["p1"]
	unit := executorForPlayer(t, ws, "p1")
	if unit.Mecha == nil {
		t.Fatal("执行体没有机甲状态")
	}
	// gear 无科技门槛、可手搓（duration 20，每批耗能 1）。
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 2}
	craft := model.Command{Target: model.CommandTarget{EntityID: unit.ID}, Payload: map[string]any{"recipe_id": "gear", "quantity": 2}}
	if result, _ := execCommand(core, model.CmdCraftItem, ws, "p1", craft); result.Code != model.CodeOK {
		t.Fatalf("start handcraft: %+v", result)
	}
	for i := 0; i < 5; i++ {
		core.processTick()
	}
	if unit.Mecha.Job == nil {
		t.Fatal("手搓作业未建立")
	}
	jobBefore := *unit.Mecha.Job
	save, err := core.ExportSaveFile("checkpoint:test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}

	restored := restoreCore(t, cfg, &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 16, ResourceDensity: 8},
	}, save)
	rws := restored.World()
	runit := executorForPlayer(t, rws, "p1")
	if runit.Mecha == nil || runit.Mecha.Job == nil {
		t.Fatalf("读档后机甲作业丢失：mecha=%+v", runit.Mecha)
	}
	jobAfter := *runit.Mecha.Job
	if jobAfter.Kind != jobBefore.Kind || jobAfter.RecipeID != jobBefore.RecipeID ||
		jobAfter.RemainingTicks != jobBefore.RemainingTicks ||
		jobAfter.RemainingBatches != jobBefore.RemainingBatches ||
		jobAfter.CompletedBatches != jobBefore.CompletedBatches ||
		jobAfter.State != jobBefore.State ||
		len(jobAfter.ReservedInputs) != len(jobBefore.ReservedInputs) {
		t.Fatalf("读档后作业进度不一致:\n before=%+v\n after =%+v", jobBefore, jobAfter)
	}
	for i, reserved := range jobBefore.ReservedInputs {
		if jobAfter.ReservedInputs[i] != reserved {
			t.Fatalf("预留原料丢失: before=%+v after=%+v", jobBefore.ReservedInputs, jobAfter.ReservedInputs)
		}
	}

	// 继续跑到作业完成：两批齿轮都要落到背包。
	for i := 0; i < 200 && runit.Mecha.Job != nil; i++ {
		restored.processTick()
	}
	if runit.Mecha.Job != nil {
		t.Fatalf("读档后作业未跑完：%+v", runit.Mecha.Job)
	}
	if got := rws.Players["p1"].Inventory[model.ItemGear]; got != 2 {
		t.Fatalf("手搓产出丢失：gear=%d want 2", got)
	}
}

// 7c：黑雾被激怒 → 存档 → 读档 → 敌对关系与截止 tick 都在，到点恢复中立。
func TestCheckpointKeepsDarkFogHostilityUntilCalm(t *testing.T) {
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "blackfog-checkpoint", MaxTickRate: 20, DarkFogCalmTicks: 500},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		Server:      config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 64, ResourceDensity: 12},
	}
	core := New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
	ws := core.World()
	provokeDarkFogFor(ws, "p1")
	relBefore := ws.Players["p1"].DarkFog
	if !relBefore.Hostile || relBefore.HostileUntilTick <= ws.Tick {
		t.Fatalf("激怒未生效：%+v", relBefore)
	}
	save, err := core.ExportSaveFile("checkpoint:test")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}

	restored := restoreCore(t, cfg, mapCfg, save)
	rws := restored.World()
	relAfter := rws.Players["p1"].DarkFog
	if relAfter != relBefore {
		t.Fatalf("读档后黑雾敌对关系丢失：before=%+v after=%+v", relBefore, relAfter)
	}
	// 到期恢复中立（沿用管线的冷静结算入口）。
	rws.Tick = relAfter.HostileUntilTick
	events := settleDarkFogCalm(rws.Players, rws.Tick)
	if len(events) != 1 || events[0].EventType != model.EvtDarkFogCalmed {
		t.Fatalf("读档后到 HostileUntilTick 未恢复中立：events=%+v", events)
	}
	if rws.Players["p1"].DarkFog != (model.DarkFogRelation{}) {
		t.Fatalf("冷静后关系未清空：%+v", rws.Players["p1"].DarkFog)
	}
}
