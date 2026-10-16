package checkpointbuild

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/model"
)

// 前期主干层（cp-root → cp-power → cp-mining → cp-base）的**脚本化生成**。
//
// 这一节回答的问题是「没有试玩记录时，构建记录从哪来」。答案是：让引擎自己把
// 开局链跑一遍（internal/gamecore 的脚本化开局），把它下过的命令原样记成
// cmd 步骤 + advance_to_tick。于是：
//
//   - 构建记录仍然是「有序步骤数组」，格式与「真实 UI 试玩审计日志导出」完全一致；
//   - 重建 = 回放这批命令，逐条命令走 POST /commands 的同一条队列路径；
//   - 命令被拒或契约不过，重建工具会点名「第几步、哪条命令、拒绝原因」。
//
// 一旦某轮有了真人 UI 试玩（从 cp-root 起跑），用
// `checkpointbuild -export -layer <name> -player p1 -from-tick … -to-tick … -write`
// 覆盖同一份 JSON 即可，脚本化生成只是兜底。

// ScriptLayer 描述一层由脚本开局的哪几段组成。
type ScriptLayer struct {
	Name string
	// Roles 是这一层包含的脚本步骤角色名（顺序即建造顺序）。
	Roles []string
	// Note 写进构建记录的说明。
	Note string
	// Contract 是这一层必须成立的条件。
	Contract checkpoint.Contract
}

// EarlyScriptLayers 是 cp-root 之后的主干层划分。
//
// 划分口径（对应 docs/guide/存档点回归测试.md 的层定义）：
//   - cp-power：第一座风机 + 第一座电塔，玩家第一次拿到电；
//   - cp-mining：铁矿机 + 带子 + 铁熔炉，第一次拿到自产铁块；
//   - cp-base-a：第二座电塔 + 铜矿机 + 带子 + 铜熔炉 + 第二座风机，铜也通了；
//   - cp-base：制造台 Mk.I 落地（齿轮产线起点），基地成型。
func EarlyScriptLayers() []ScriptLayer {
	return []ScriptLayer{
		{
			Name:  "cp-power",
			Roles: []string{"wind1", "tesla1"},
			Note: "L1 cp-power（脚本化重建）：从 cp-root 读档，建第一座风力涡轮机 + 第一座电力感应塔，玩家第一次拿到电。构建记录由引擎脚本化开局导出（无试玩记录时的兜底），重建即回放这批命令。",
			Contract: checkpoint.Contract{Checks: []checkpoint.ContractCheck{
				{Kind: "game_not_finished"},
				{Kind: "player_alive", Player: "p1"},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 1},
				{Kind: "building_count_gte", Player: "p1", Type: string(model.BuildingTypeTeslaTower), N: 1},
				{Kind: "enemy_attack_seen", Player: "p1", Boolean: false},
			}},
		},
		{
			Name:  "cp-mining",
			Roles: []string{"ironMiner", "ironBelt", "ironSorter", "ironSmelter"},
			Note: "L2 cp-mining（脚本化重建）：从 cp-power 读档，把采矿机落在纯铁矿脉上、用「传送带 + 分拣器」把矿石送进电弧熔炉（第 16 轮契约 §3：生产建筑不再与传送带直连，矿机出矿到带子、分拣器从带子取货投进熔炉），矿机通电出矿、熔炉出铁块。矿机一律配出口，否则几 tick 就被自己的产出堵死（试玩 1015 口径）。",
			Contract: checkpoint.Contract{Checks: []checkpoint.ContractCheck{
				{Kind: "game_not_finished"},
				{Kind: "player_alive", Player: "p1"},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeWindTurbine), N: 1},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeMiningMachine), N: 1},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeSorterMk1), N: 1},
				{Kind: "enemy_attack_seen", Player: "p1", Boolean: false},
			}},
		},
		{
			Name:  "cp-base-a",
			Roles: []string{"tesla2", "copperMiner", "copperBelt", "copperSorter", "copperSmelter", "wind2"},
			Note: "L3 cp-base-a（脚本化重建）：从 cp-mining 读档，补第二座电塔与第二座风机，把铜矿机 + 带子 + 分拣器 + 铜熔炉照铁线同款建好，基地有铁铜两条产线。契约卡 2 台采矿机 + 1 座熔炉必须 running。",
			Contract: checkpoint.Contract{Checks: []checkpoint.ContractCheck{
				{Kind: "game_not_finished"},
				{Kind: "player_alive", Player: "p1"},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeMiningMachine), N: 2},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeArcSmelter), N: 1},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeSorterMk1), N: 2},
				{Kind: "enemy_attack_seen", Player: "p1", Boolean: false},
			}},
		},
		{
			Name:  "cp-base",
			Roles: []string{"assembler"},
			Note: "L4 cp-base（脚本化重建）：从 cp-base-a 读档，落地制造台 Mk.I（配方 gear），齿轮产线起点，基地成型。契约沿用旧 cp-base 的口径（熔炉与制造台必须 running）。",
			Contract: checkpoint.Contract{Checks: []checkpoint.ContractCheck{
				{Kind: "game_not_finished"},
				{Kind: "player_alive", Player: "p1"},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeMiningMachine), N: 2},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeArcSmelter), N: 2},
				{Kind: "building_running_gte", Player: "p1", Type: string(model.BuildingTypeAssemblingMachineMk1), N: 1},
				{Kind: "enemy_attack_seen", Player: "p1", Boolean: false},
			}},
		},
	}
}

// RootLayerName 是根层名（无父档，按配置开新局）。
const RootLayerName = "cp-root"

// RootLayer 返回根层的构建记录：开新局后推进到开局稳定 tick 就存档。
func RootLayer() checkpoint.BuildSpec {
	rootAnchor := model.Command{
		Type:   model.CmdSwitchActivePlanet,
		Target: model.CommandTarget{Layer: "planet", PlanetID: "planet-1-1"},
	}
	return checkpoint.BuildSpec{
		Note:  "1014 遭遇战从零开局（无物资包：背包空、矿物 400、能量 100；bot easy，首攻 60000，时限 180000）。根层不读父档：按 server/config-skirmish.yaml + map-skirmish.yaml 开新局（seed skirmish-seed-001），推进到 tick 27 存档。",
		Steps: []checkpoint.BuildStep{{Cmd: &rootAnchor, Note: "开局锚点：一条不会改局面的查询型命令（sync_active_planet 只改视图焦点）。根层的重建方式是按配置开新局，这条命令只是让「构建记录必须有步骤」这条约束成立。"}},
		// 落点与脚本化生成对齐：生成时也是先推进到 tick 27 再跑开局脚本，
		// 这样 cp-power 读 cp-root 的档就停在同一 tick。
		EndTick: 27,
		Contract: checkpoint.Contract{Checks: []checkpoint.ContractCheck{
			{Kind: "game_not_finished"},
			{Kind: "tick_lt", Tick: 1000},
		}},
	}
}

// GenerateEarlySpecs 跑一遍脚本化开局，把命令按层切开，产出各层的可执行构建记录。
//
// 返回值里同时带上每一层结束时脚本的 tick（写进报告用）。
func (r *Runner) GenerateEarlySpecs() (map[string]*checkpoint.BuildSpec, error) {
	sess := r.rt.Current()
	if sess == nil || sess.Core == nil {
		return nil, fmt.Errorf("没有活动对局")
	}
	if err := r.rt.ResetToConfiguredNewGameFromFile(r.opts.ConfigPath); err != nil {
		return nil, err
	}
	sess = r.rt.Current()
	core := sess.Core
	// 与 cp-root 存的 tick 对齐：根层推到 tick 27 存档，这里从同一 tick 起跑脚本。
	for core.CurrentTick() < 27 {
		core.AdvanceTick()
	}
	maxTicks := r.opts.MaxTicks
	if maxTicks <= 0 {
		maxTicks = 60000
	}
	run := core.RunScriptedOpeningDetailed("p1", maxTicks)

	roles := gamecore.ScriptedOpeningRoles()
	roleIndex := map[string]int{}
	for i, role := range roles {
		roleIndex[role] = i
	}
	// 每一层覆盖到「该层最后一个角色的最后一条命令」为止（含）；层的起点是上一层
	// 的终点 +1。父层读档后局面已经包含上一层做的一切，只有这段增量属于本层。
	layers := EarlyScriptLayers()
	specs := map[string]*checkpoint.BuildSpec{}
	cursor := 1
	for _, layer := range layers {
		lastRole := ""
		for _, role := range layer.Roles {
			if _, ok := roleIndex[role]; !ok {
				return nil, fmt.Errorf("层 %s 引用了不存在的脚本角色 %s", layer.Name, role)
			}
			lastRole = role
		}
		lastIndex := run.RoleLastIndex[lastRole]
		if lastIndex == 0 {
			return nil, fmt.Errorf("层 %s 的收尾角色 %s 没有产出任何命令（脚本没跑到？）", layer.Name, lastRole)
		}
		if lastIndex < cursor {
			// 该层没有任何新命令：留一条「推进到脚本当前 tick」的空步骤也不行，
			// 因为契约要在读档后立刻成立。到这里说明层划分与脚本角色对不上。
			return nil, fmt.Errorf("层 %s 的收尾角色 %s 下标 %d 早于上一层终点 %d：层划分与脚本顺序不一致", layer.Name, lastRole, lastIndex, cursor-1)
		}
		steps := stepsFromScript(run.Steps, cursor, lastIndex)
		// 落点：把 tick 推进到「脚本下一条命令的下发 tick」。最后一条建造命令只是
		// 把施工任务排进队列，建筑要等若干 tick 才落成；脚本是靠后续 tick 等出来的，
		// 所以这段等待必须写进构建记录，否则存档时契约里的 running/存在建筑数还是 0。
		//
		// 终点取的是下一条命令的下发 tick（不是它减一）：脚本是在那一 tick 的
		// Plan 里「看见」上一层的建筑已经落成才往下走的，所以那一 tick 才是这一层
		// 状态真正成立的第一 tick。少推一 tick 就会出现「建筑已排队但还没落地」，
		// 契约里的 building_count_gte 会判 0。
		endTick := run.EndTick
		if next := stepAt(run.Steps, lastIndex+1); next != nil && next.IssueTick > 0 {
			endTick = next.IssueTick
		}
		specs[layer.Name] = &checkpoint.BuildSpec{
			Note:     layer.Note,
			Steps:    steps,
			EndTick:  endTick,
			Contract: layer.Contract,
		}
		cursor = lastIndex + 1
	}
	// parent 链：cp-power ← cp-root，其余依次串起来。
	parent := RootLayerName
	for _, layer := range layers {
		specs[layer.Name].Parent = parent
		parent = layer.Name
	}
	return specs, nil
}

// stepsFromScript 把脚本命令区间 [firstIndex, lastIndex] 变成构建步骤：
// 每条命令前补 advance_to_tick 到它下发的 tick，保证回放节奏与脚本一致。
func stepsFromScript(steps []gamecore.ScriptedStepResult, firstIndex, lastIndex int) []checkpoint.BuildStep {
	var out []checkpoint.BuildStep
	for _, step := range steps {
		if step.Index < firstIndex || step.Index > lastIndex {
			continue
		}
		if step.IssueTick > 0 {
			tick := step.IssueTick
			out = append(out, checkpoint.BuildStep{AdvanceToTick: &tick})
		}
		cmd := step.Command
		out = append(out, checkpoint.BuildStep{Cmd: &cmd})
	}
	return out
}

// stepAt 返回下标为 index 的脚本步骤（1 起，找不到返回 nil）。
func stepAt(steps []gamecore.ScriptedStepResult, index int) *gamecore.ScriptedStepResult {
	for i := range steps {
		if steps[i].Index == index {
			return &steps[i]
		}
	}
	return nil
}

// SortedSpecNames 返回各层名字的稳定顺序（按构建链顺序，根在前）。
func SortedSpecNames(specs map[string]*checkpoint.BuildSpec) []string {
	names := make([]string, 0, len(specs))
	for name := range specs {
		names = append(names, name)
	}
	sort.Strings(names)
	// 根层排最前，其余按链上深度（父层在前面）。
	depth := func(name string) int {
		d, seen := 0, map[string]bool{}
		for cur := name; cur != ""; {
			if seen[cur] {
				break
			}
			seen[cur] = true
			spec := specs[cur]
			if spec == nil || spec.Parent == "" {
				break
			}
			d++
			cur = spec.Parent
		}
		return d
	}
	sort.SliceStable(names, func(i, j int) bool { return depth(names[i]) < depth(names[j]) })
	return names
}

// WriteSpecs 把生成的构建记录写进 specDir（覆盖同名文件的 steps/parent/note/contract，
// 保留文件里手写的说明）。
func WriteSpecs(specDir string, specs map[string]*checkpoint.BuildSpec) error {
	if err := os.MkdirAll(specDir, 0o755); err != nil {
		return err
	}
	names := make([]string, 0, len(specs))
	for name := range specs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		spec := specs[name]
		if err := spec.Validate(); err != nil {
			return fmt.Errorf("层 %s 的构建记录不自洽: %w", name, err)
		}
		raw, err := json.MarshalIndent(spec, "", "  ")
		if err != nil {
			return err
		}
		path := filepath.Join(specDir, name+".json")
		if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
			return err
		}
	}
	return nil
}
