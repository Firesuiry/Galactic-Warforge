package gamecore

import (
	"fmt"
	"sort"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// newRealSkirmishCore 真实遭遇战预设（config-skirmish + map-skirmish），不额外预置。
func newRealSkirmishCore(t *testing.T) *GameCore {
	t.Helper()
	cfg, err := config.Load("../../config-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	mapCfg, err := mapconfig.Load("../../map-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed), queue.New(), NewEventBus(), nil)
}

// skirmishBotAttackingPlayer p2 是否有军团正以 p1 建筑附近为目标进攻。
func skirmishBotAttackingPlayer(ws *model.WorldState) bool {
	if ws.CombatRuntime == nil {
		return false
	}
	for _, squad := range ws.CombatRuntime.Squads {
		if squad == nil || squad.OwnerID != "p2" || squad.Order != model.SquadOrderAttack || squad.Target == nil {
			continue
		}
		for _, b := range ws.Buildings {
			if b.OwnerID == "p1" && ws.SurfaceDistance(*squad.Target, b.Position) <= 12 {
				return true
			}
		}
	}
	return false
}

func skirmishBuildingCounts(ws *model.WorldState, owner string) map[model.BuildingType]int {
	counts := map[model.BuildingType]int{}
	for _, b := range ws.Buildings {
		if b.OwnerID == owner {
			counts[b.Type]++
		}
	}
	return counts
}

func fmtCounts(counts map[model.BuildingType]int) string {
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, string(k))
	}
	sort.Strings(keys)
	out := ""
	for _, k := range keys {
		out += fmt.Sprintf("%s=%d ", k, counts[model.BuildingType(k)])
	}
	return out
}

// 遭遇战 bot 从默认开局物资包起步：建基地、出兵、编军团，并在 15000–25000 tick 对玩家首次进攻。
// 玩家 p1 不操作；黑雾是被动的，不应干扰双方。
func TestSkirmishBotOpensAndAttacksInWindow(t *testing.T) {
	if testing.Short() {
		t.Skip("long skirmish simulation")
	}
	core := newRealSkirmishCore(t)
	ws := core.World()
	firstAttack := int64(0)
	for ws.Tick < 25000 {
		core.processTick()
		if ws.Tick%2500 == 0 {
			units := 0
			for _, u := range ws.Units {
				if u.OwnerID == "p2" && u.Mecha == nil {
					units++
				}
			}
			squads := 0
			if ws.CombatRuntime != nil {
				for _, s := range ws.CombatRuntime.Squads {
					if s.OwnerID == "p2" {
						squads++
					}
				}
			}
			t.Logf("tick %d p2 units=%d squads=%d buildings: %s inv=%v", ws.Tick, units, squads, fmtCounts(skirmishBuildingCounts(ws, "p2")), ws.Players["p2"].Inventory)
		}
		if firstAttack == 0 && skirmishBotAttackingPlayer(ws) {
			firstAttack = ws.Tick
			break
		}
	}
	t.Logf("first attack tick=%d", firstAttack)
	if firstAttack < 15000 || firstAttack > 25000 {
		t.Fatalf("bot first attack at tick %d, want 15000–25000", firstAttack)
	}
	counts := skirmishBuildingCounts(ws, "p2")
	if counts[model.BuildingTypeWindTurbine] == 0 || counts[model.BuildingTypeMiningMachine] == 0 || counts["barracks"] == 0 {
		t.Fatalf("bot base incomplete: %s", fmtCounts(counts))
	}
	if counts[model.BuildingTypeTeslaTower] > botTeslaCap {
		t.Fatalf("bot built %d tesla towers, cap %d", counts[model.BuildingTypeTeslaTower], botTeslaCap)
	}
	army := 0
	for _, u := range ws.Units {
		if u.OwnerID == "p2" && u.Mecha == nil && u.SquadID != "" {
			army++
		}
	}
	if army == 0 {
		t.Fatal("bot attacked without a legion")
	}
	// 黑雾被动：没人招惹，双方都应保持中立。
	for _, pid := range []string{"p1", "p2"} {
		if ws.Players[pid].DarkFog.Hostile {
			t.Fatalf("dark fog became hostile to %s without provocation", pid)
		}
	}
	if !ws.Players["p1"].IsAlive {
		t.Fatal("idle player must survive the opening (dark fog is passive)")
	}
}

// 真人开局节奏：用开局物资包以 UI 正常速度（约 3 秒一条命令）铺出 风机/电塔/矿机/熔炉/制造台，
// 10 tps 下 tick 1500 内供电、采矿、冶炼都要跑起来。
func TestSkirmishPlayerKitRunsPowerMiningSmeltingBy1500(t *testing.T) {
	core := newRealSkirmishCore(t)
	ws := core.World()
	ctx := core.surveyBotWorld(ws, "p1")
	home := *ctx.home
	radius := botConstructRadius(ws, "p1", ctx)

	// 基地建造半径内最近的矿点：先保证一座铁矿，其余取最近的铁/铜/煤/石矿，共 4 座矿机。
	var nodes []*model.ResourceNodeState
	for _, node := range ws.Resources {
		switch node.Kind {
		case model.ItemIronOre, model.ItemCopperOre, model.ItemCoal, model.ItemStoneOre:
		default:
			continue
		}
		if ws.SurfaceDistance(home, node.Position) <= radius && ws.Grid[node.Position.Y][node.Position.X].BuildingID == "" {
			nodes = append(nodes, node)
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		di, dj := ws.SurfaceDistance(home, nodes[i].Position), ws.SurfaceDistance(home, nodes[j].Position)
		if (nodes[i].Kind == model.ItemIronOre) != (nodes[j].Kind == model.ItemIronOre) {
			return nodes[i].Kind == model.ItemIronOre
		}
		if di != dj {
			return di < dj
		}
		return nodes[i].ID < nodes[j].ID
	})
	if len(nodes) < 4 || nodes[0].Kind != model.ItemIronOre {
		t.Fatalf("not enough ore nodes near base: %d", len(nodes))
	}
	var mines []model.Position
	for _, n := range nodes[:4] {
		mines = append(mines, n.Position)
	}

	type step struct {
		btype  model.BuildingType
		pos    *model.Position
		recipe string
	}
	var plan []step
	for i := 0; i < 3; i++ {
		plan = append(plan, step{btype: model.BuildingTypeWindTurbine})
	}
	for i := range mines {
		p := mines[i]
		plan = append(plan, step{btype: model.BuildingTypeMiningMachine, pos: &p})
		plan = append(plan, step{btype: model.BuildingTypeTeslaTower, pos: &p}) // 每座矿机旁一座电塔
	}
	plan = append(plan,
		step{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		step{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		step{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "gear"},
	)

	const commandEvery = 30 // UI 正常速度：约 3 秒一条命令
	next := 0
	var smelters []string
	for ws.Tick < 1500 {
		if next < len(plan) && ws.Tick > 0 && ws.Tick%commandEvery == 0 {
			s := plan[next]
			var pos *model.Position
			switch {
			case s.btype == model.BuildingTypeMiningMachine:
				pos = s.pos
			case s.pos != nil:
				pos = botTowerStep(ws, *s.pos, home, 2)
			default:
				pos = botBuildSpotNear(ws, home, radius, s.btype)
			}
			if pos == nil {
				t.Fatalf("no spot for %s", s.btype)
			}
			payload := map[string]any{"building_type": string(s.btype)}
			if s.recipe != "" {
				payload["recipe_id"] = s.recipe
			}
			res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{Target: model.CommandTarget{Layer: "planet", Position: pos}, Payload: payload})
			if res.Code != model.CodeOK {
				t.Fatalf("tick %d build %s at %v: %+v", ws.Tick, s.btype, *pos, res)
			}
			next++
		}
		// 冶炼原料：玩家从矿机取矿、送进熔炉（与 UI 的 transfer 相同命令）。
		if ws.Tick%100 == 0 {
			smelters = smelters[:0]
			for _, b := range ws.Buildings {
				if b.OwnerID == "p1" && b.Type == model.BuildingTypeArcSmelter {
					smelters = append(smelters, b.ID)
				}
			}
			sort.Strings(smelters)
			for _, b := range ws.Buildings {
				if b.OwnerID == "p1" && isMinerBuilding(b) && b.Storage != nil {
					if n := b.Storage.OutputQuantity(model.ItemIronOre); n > 0 {
						execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{Target: model.CommandTarget{Layer: "planet", EntityID: b.ID}, Payload: map[string]any{"building_id": b.ID, "item_id": model.ItemIronOre, "quantity": n, "direction": "to_player"}})
					}
				}
			}
			for _, id := range smelters {
				if ore := ws.Players["p1"].Inventory[model.ItemIronOre]; ore > 0 {
					execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{Target: model.CommandTarget{Layer: "planet", EntityID: id}, Payload: map[string]any{"building_id": id, "item_id": model.ItemIronOre, "quantity": min(ore, 10)}})
				}
			}
		}
		core.processTick()
	}

	counts := map[model.BuildingType]int{}
	running := map[model.BuildingType]int{}
	ingots := 0
	for _, b := range ws.Buildings {
		if b.OwnerID != "p1" {
			continue
		}
		counts[b.Type]++
		if b.Runtime.State == model.BuildingWorkRunning {
			running[b.Type]++
		}
		if b.Type == model.BuildingTypeArcSmelter && b.Storage != nil {
			ingots += b.Storage.OutputQuantity(model.ItemIronIngot)
		}
	}
	t.Logf("tick %d built=%s running=%s smelter ingots=%d", ws.Tick, fmtCounts(counts), fmtCounts(running), ingots)
	if running[model.BuildingTypeWindTurbine] < 3 || running[model.BuildingTypeMiningMachine] < 4 || counts[model.BuildingTypeArcSmelter] < 2 || counts[model.BuildingTypeAssemblingMachineMk1] < 1 {
		t.Fatalf("opening kit not up by tick 1500: built=%s running=%s", fmtCounts(counts), fmtCounts(running))
	}
	if ingots == 0 {
		t.Fatal("no iron ingot smelted by tick 1500")
	}
}
