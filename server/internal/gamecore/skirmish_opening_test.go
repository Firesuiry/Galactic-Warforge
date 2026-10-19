package gamecore

import (
	"fmt"
	"sort"
	"strings"
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
		// 细分网格：军团目标与建筑的距离都 ×3，判定半径同步放大到 36
		// （军团停在离基地 ~10–30 cell 的交火位，12 已判不到首攻）。
		for _, b := range ws.Buildings {
			if b.OwnerID == "p1" && ws.SurfaceDistance(*squad.Target, b.Position) <= 36 {
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

// 遭遇战 bot 从零（无物资包）起步：建基地、出兵、编军团，并在
// bot_first_attack_tick（60000）之后对玩家首次进攻。玩家 p1 不操作；
// 黑雾是被动的，不应干扰双方。
func TestSkirmishBotOpensAndAttacksInWindow(t *testing.T) {
	if testing.Short() {
		t.Skip("long skirmish simulation")
	}
	core := newRealSkirmishCore(t)
	ws := core.World()
	gate := core.cfg.Battlefield.BotFirstAttackTick
	firstAttack := int64(0)
	for ws.Tick < gate+15000 {
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
			t.Logf("tick %d p2 units=%d squads=%d buildings: %s inv=%v", ws.Tick, units, squads, fmtCounts(skirmishBuildingCounts(ws, "p2")), starterMecha(ws, "p2").Inventory)
		}
		if firstAttack == 0 && skirmishBotAttackingPlayer(ws) {
			firstAttack = ws.Tick
			break
		}
	}
	t.Logf("first attack tick=%d（门槛 %d）", firstAttack, gate)
	if firstAttack < gate || firstAttack > gate+9000 {
		t.Fatalf("bot first attack at tick %d, want %d–%d", firstAttack, gate, gate+9000)
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

// 真人开局节奏（无物资包）：从空背包手搓起步，以 UI 正常速度（约 3 秒一条命令）
// 铺出 风机/电塔/矿机/熔炉，10 tps 下 tick 7000 内供电、采矿、冶炼都要跑起来。
// （实测第一座熔炉在 tick 6123——手搓链要先走完 齿轮/磁线圈/电路板，再攒熔炉的
// 4 电路板 + 4 铁块 + 2 磁线圈 + 2 石砖，所以窗口给到 7000。）
func TestSkirmishPlayerOpensPowerMiningSmeltingBy7000(t *testing.T) {
	t.Parallel()
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, 7000)
	op.run()
	ws := op.ws
	counts := skirmishBuildingCounts(ws, "p1")
	running := skirmishRunningCounts(ws, "p1")
	// 已炼出的铁块 = 熔炉里剩的 + 已经被 feedIndustry 取进背包的。
	// 只看熔炉存储会在「取料恰好在 tick 7000 结算」时误判（细分网格下开局链
	// 慢了几百 tick，第一炉铁块正好落在取料节拍上）。
	ingots := starterMecha(ws, "p1").Inventory[model.ItemIronIngot]
	for _, b := range ws.Buildings {
		if b.OwnerID == "p1" && b.Type == model.BuildingTypeArcSmelter && b.Storage != nil {
			ingots += b.Storage.OutputQuantity(model.ItemIronIngot)
		}
	}
	t.Logf("tick %d built=%s running=%s smelter ingots=%d milestones=%v", ws.Tick, fmtCounts(counts), fmtCounts(running), ingots, op.milestone)
	if running[model.BuildingTypeWindTurbine] < 1 || running[model.BuildingTypeMiningMachine] < 1 {
		t.Fatalf("无物资包开局没通电/没采矿：built=%s running=%s", fmtCounts(counts), fmtCounts(running))
	}
	if counts[model.BuildingTypeArcSmelter] < 1 {
		t.Fatalf("tick 7000 还没建起熔炉：built=%s", fmtCounts(counts))
	}
	if ingots == 0 {
		t.Fatal("no iron ingot smelted by tick 7000")
	}
}

// 无物资包的开局链：空背包下，仅靠「手动采矿 + 手搓」必须能一路走到
// 风机/电塔/矿机/熔炉/制造台/兵营/补给站/研究站，每一环都不能死锁
// （试玩报告 1007 的「玻璃/石砖」死锁就是这条链上的缺口）。
// 这是「开局链可走通」的最小断言集，与 TestSkirmishFromZeroFullMatch 共用同一套脚本。
func TestSkirmishFromZeroChainIsWalkable(t *testing.T) {
	if testing.Short() {
		t.Skip("从零开局整链模拟（跑到 tick 30000，单跑约 76 秒）；用 -run 单跑")
	}
	t.Parallel()
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, 30000)
	op.includeBarracks = true
	op.run()
	ws := op.ws
	for _, key := range []string{
		"wind_turbine", "tesla_tower", "mining_machine", "arc_smelter",
		"assembling_machine", "barracks", "soldier", "matrix_lab",
	} {
		tick, ok := op.milestone[key]
		if !ok || tick <= 0 {
			t.Fatalf("开局链死锁：%s 到 tick %d 都没达成（milestones=%v）", key, ws.Tick, op.milestone)
		}
		t.Logf("milestone %s = %d", key, tick)
	}
	// 死锁判据：某个建筑长期（≥200 次）建不起来。第 16 轮起建造门槛是背包物品
	// （脚本在下发前自查背包，缺料时先去备料，见 buildNext），所以回执只剩两类：
	//   - 缺料类（「缺少 N 个「X」（背包现有 M）」）：缺的物品必须能手搓或是原矿，
	//     否则开局链就断在这一环上；缺齿轮/电路板/磁线圈这类「能手搓但产能不够」
	//     只记日志——无物资包下机甲 20 tick 搓 1 个齿轮，脚本排的制造台越多、
	//     缺口越大，这是节奏问题不是死锁；
	//   - 其他类（落位/施工冲突）：真人不会反复点同一个放不下的位置，判死锁。
	for msg, n := range op.buildFails {
		if n < 200 {
			continue
		}
		t.Logf("建造长期失败（%d 次）：%s", n, msg)
		if !strings.Contains(msg, "缺少") {
			t.Fatalf("建造长期失败且原因不是缺料（%d 次）：%s", n, msg)
		}
		for _, item := range strings.Split(msg, "「")[1:] {
			name := strings.SplitN(item, "」", 2)[0]
			id := itemIDByName(name)
			if _, ok := op.handcraftRecipeFor(id); !ok && !isManuallyMinableOre(id) {
				t.Fatalf("死锁：长期缺「%s」且它既不能手搓也不是原矿（%d 次）：%s", name, n, msg)
			}
		}
	}
}
