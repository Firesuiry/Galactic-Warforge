// Package checkpointbuild 是「可执行的存档点重建」工具：从父存档点读档，按
// docs/guide/checkpoints/<名字>.json 里的构建步骤高速推进（不走墙钟时钟），
// 校验契约，然后用 --replace 覆盖写入存档点。
//
// 与 docs/guide/存档点回归测试.md 第 3/4 节对应：一层存档点 = 父层 + 构建记录 + 契约。
// 构建记录的首选来源是「真实 UI 试玩的审计日志导出」（见 ExportFromAudit），
// 重建即回放玩家实际下过的命令；手写步骤是没有试玩记录时的兜底。
package checkpointbuild

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/model"
	"siliconworld/internal/startup"
)

// Options 控制一次重建。
type Options struct {
	// ConfigPath / MapConfigPath 是服务端配置与地图配置（遭遇战预设）。
	ConfigPath    string
	MapConfigPath string
	// SpecDir 是构建记录目录（docs/guide/checkpoints）。
	SpecDir string
	// CheckpointDir 是存档点根目录（.run/checkpoints）。
	CheckpointDir string
	// DataDir 是重建期间的活动存档目录（留空则用临时目录）。
	DataDir string
	// Replace 允许覆盖同名存档点（重建恒为 true 才算「重建」）。
	Replace bool
	// MaxTicks 是单层最多推进的 tick（防失控），<=0 时取 400000。
	MaxTicks int64
	// Log 进度回调（可为 nil）。
	Log func(format string, args ...any)
}

// LayerResult 是一层的重建结果。
type LayerResult struct {
	Name        string
	Parent      string
	StartTick   int64
	EndTick     int64
	Commands    int
	Rejected    int
	Elapsed     time.Duration
	Contract    checkpoint.ContractReport
	Saved       bool
	SaveError   string
	StepFailure string
}

// Failed 报告这一层是否需要人工介入（步骤失败、没存上、契约没过）。
func (r LayerResult) Failed() bool {
	return r.StepFailure != "" || r.SaveError != "" || !r.Saved
}

func (r LayerResult) String() string {
	status := "OK"
	switch {
	case r.StepFailure != "":
		status = "失败：" + r.StepFailure
	case r.SaveError != "":
		status = "存档失败：" + r.SaveError
	case !r.Saved:
		status = "未存档"
	}
	return fmt.Sprintf("%-20s parent=%-14s tick %d→%d 命令 %d 被拒 %d 契约 %v 用时 %s [%s]",
		r.Name, orDash(r.Parent), r.StartTick, r.EndTick, r.Commands, r.Rejected, r.Contract.Passed,
		r.Elapsed.Round(time.Millisecond), status)
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// Tree 是一份构建记录集合：名字 → 记录（nil 表示该层还没改写成可执行步骤）。
type Tree map[string]*checkpoint.BuildSpec

// LoadTree 读取 SpecDir 下全部构建记录。旧版文字 build 的层以 nil 呈现，
// 由调用方在报告里列为待办。
func LoadTree(specDir string) (Tree, error) {
	entries, err := os.ReadDir(specDir)
	if err != nil {
		return nil, err
	}
	out := Tree{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		spec, err := checkpoint.LoadBuildSpec(filepath.Join(specDir, entry.Name()))
		if err != nil {
			out[name] = nil
			continue
		}
		out[name] = spec
	}
	return out, nil
}

// RebuildOrder 返回重建 target 需要的层顺序（父在前）。
func RebuildOrder(tree Tree, target string) ([]string, error) {
	if tree[target] == nil {
		return nil, fmt.Errorf("存档点 %s 没有可执行的构建记录（还是旧版文字 build？）", target)
	}
	var chain []string
	seen := map[string]bool{}
	for name := target; name != ""; name = tree[name].Parent {
		if seen[name] {
			return nil, fmt.Errorf("构建记录的 parent 链有环：%s", name)
		}
		seen[name] = true
		if tree[name] == nil {
			return nil, fmt.Errorf("父层 %s 没有可执行的构建记录", name)
		}
		chain = append([]string{name}, chain...)
	}
	return chain, nil
}

// Subtree 返回以 root 为根的子树（含 root），父在子前，同级按名字排序。
func Subtree(tree Tree, root string) []string {
	children := map[string][]string{}
	for name, spec := range tree {
		if spec == nil || spec.Parent == "" {
			continue
		}
		children[spec.Parent] = append(children[spec.Parent], name)
	}
	for parent := range children {
		sort.Strings(children[parent])
	}
	var out []string
	var walk func(string)
	walk = func(name string) {
		if tree[name] == nil {
			return
		}
		out = append(out, name)
		for _, child := range children[name] {
			walk(child)
		}
	}
	walk(root)
	return out
}

// Runner 持有一套可复用的重建运行环境（不走墙钟时钟，手动推 tick）。
type Runner struct {
	opts Options
	rt   *startup.Runtime
}

// NewRunner 装配重建环境：临时 data_dir + 共享存档点目录 + 遭遇战配置。
func NewRunner(opts Options) (*Runner, error) {
	if opts.ConfigPath == "" || opts.MapConfigPath == "" {
		return nil, fmt.Errorf("必须给出 config 与 map-config 路径")
	}
	if opts.SpecDir == "" || opts.CheckpointDir == "" {
		return nil, fmt.Errorf("必须给出构建记录目录与存档点目录")
	}
	if opts.DataDir == "" {
		dir, err := os.MkdirTemp("", "sw-rebuild-")
		if err != nil {
			return nil, err
		}
		opts.DataDir = dir
	}
	rt, err := startup.NewRebuildRuntime(opts.ConfigPath, opts.MapConfigPath, opts.DataDir, opts.CheckpointDir)
	if err != nil {
		return nil, err
	}
	return &Runner{opts: opts, rt: rt}, nil
}

// Close 停止运行时并清理临时存档目录。
func (r *Runner) Close() {
	if r == nil {
		return
	}
	if r.rt != nil {
		r.rt.Stop()
	}
	if strings.Contains(r.opts.DataDir, "sw-rebuild-") {
		_ = os.RemoveAll(r.opts.DataDir)
	}
}

func (r *Runner) logf(format string, args ...any) {
	if r.opts.Log != nil {
		r.opts.Log(format, args...)
	}
}

// RebuildLayer 重建单层：父层为空的层（cp-root）先开新局，否则先读父档。
//
// 返回的 LayerResult 里带「第几步、哪条命令、被拒原因」——命令被拒或契约不过
// 本身就是回归信号，不要静默跳过。
func (r *Runner) RebuildLayer(spec *checkpoint.BuildSpec, name string) (result LayerResult) {
	result = LayerResult{Name: name, Parent: spec.Parent}
	started := time.Now()
	// 具名返回值：Elapsed 要在 return 之后才写得上（不然 defer 改的是副本，
	// 报告里每层都显示 0s）。
	defer func() { result.Elapsed = time.Since(started) }()

	// 检查点目录里有没有这一层的父档。存档点本身不被 git 跟踪（.run/ 在
	// .gitignore 里），换台机器/新克隆时树是空的——这时直接说清楚「先重建
	// 父层」，而不是让 LoadCheckpoint 报一句不好懂的错误。
	if spec.Parent != "" {
		if _, err := os.Stat(filepath.Join(r.opts.CheckpointDir, spec.Parent, "save.json")); err != nil {
			result.StepFailure = fmt.Sprintf("父档 %s 不在存档点目录 %s 里：先重建父层（checkpointbuild -layer %s）或从别处拷来",
				spec.Parent, r.opts.CheckpointDir, spec.Parent)
			return result
		}
	}
	if spec.Parent == "" {
		if err := r.rt.ResetToConfiguredNewGameFromFile(r.opts.ConfigPath); err != nil {
			result.StepFailure = fmt.Sprintf("开新局失败: %v", err)
			return result
		}
	} else if _, err := r.rt.LoadCheckpoint(spec.Parent); err != nil {
		result.StepFailure = fmt.Sprintf("读档 %s 失败: %v", spec.Parent, err)
		return result
	}

	sess := r.rt.Current()
	if sess == nil || sess.Core == nil {
		result.StepFailure = "没有活动对局"
		return result
	}
	core := sess.Core
	result.StartTick = core.CurrentTick()

	maxTicks := r.opts.MaxTicks
	if maxTicks <= 0 {
		maxTicks = 400000
	}
	for index, step := range spec.Steps {
		if core.CurrentTick()-result.StartTick > maxTicks {
			result.StepFailure = fmt.Sprintf("第 %d 步前已超过 %d tick 上限", index+1, maxTicks)
			return result
		}
		switch {
		case step.Cmd != nil:
			message, err := runCommand(sess, *step.Cmd)
			result.Commands++
			if err != nil {
				result.Rejected++
				result.StepFailure = fmt.Sprintf("第 %d 步 %s 被拒: %s", index+1, step.Cmd.Type, err)
				return result
			}
			r.logf("  [%d/%d] tick %d %s → %s", index+1, len(spec.Steps), core.CurrentTick(), step.Cmd.Type, message)
		case step.AdvanceToTick != nil:
			target := *step.AdvanceToTick
			for core.CurrentTick() < target {
				core.AdvanceTick()
			}
			r.logf("  [%d/%d] advance_to_tick %d → tick %d", index+1, len(spec.Steps), target, core.CurrentTick())
		case step.ItemGrowth != nil:
			// 「产线流动」断言：推进一段窗口，要求落点建筑里的物品存量增长。
			// 放在这里（契约校验之前）是为了让失败信息直接指向「第几步」，
			// 而不是只报一条 building_item_at_gte 的存量结果。
			message, err := r.runItemGrowth(core, *step.ItemGrowth)
			if err != nil {
				result.StepFailure = fmt.Sprintf("第 %d 步 item_growth 失败: %s", index+1, err)
				return result
			}
			r.logf("  [%d/%d] %s", index+1, len(spec.Steps), message)
		case step.WaitUntil != nil:
			deadline := core.CurrentTick() + step.Timeout()
			predicate := checkpoint.Contract{Checks: []checkpoint.ContractCheck{*step.WaitUntil}}
			for !core.EvaluateContract(predicate).Passed {
				if core.CurrentTick() >= deadline {
					result.StepFailure = fmt.Sprintf("第 %d 步 wait_until %s 超时（%d tick）",
						index+1, describeCheck(*step.WaitUntil), step.Timeout())
					return result
				}
				core.AdvanceTick()
			}
			r.logf("  [%d/%d] wait_until %s 满足（tick %d）", index+1, len(spec.Steps), describeCheck(*step.WaitUntil), core.CurrentTick())
		}
	}

	// 落点 tick：最后一条建造命令只是把施工任务排进队列，建筑要等若干 tick 才落成。
	// 契约里的 building_count_gte / building_running_gte 看的是「此刻已落成的建筑」，
	// 所以存档前要按构建记录声明的 end_tick 把世界推到位。
	if spec.EndTick > core.CurrentTick() {
		if spec.EndTick-result.StartTick > maxTicks {
			result.StepFailure = fmt.Sprintf("end_tick %d 超过单层 %d tick 上限", spec.EndTick, maxTicks)
			return result
		}
		for core.CurrentTick() < spec.EndTick {
			core.AdvanceTick()
		}
		r.logf("  推进到 end_tick %d", core.CurrentTick())
	}

	result.EndTick = core.CurrentTick()
	result.Contract = core.EvaluateContract(spec.Contract)
	if !result.Contract.Passed {
		result.StepFailure = "契约未通过：" + describeFailures(result.Contract)
		return result
	}
	summary, err := r.rt.SaveCheckpoint(startup.SaveCheckpointRequest{
		Name:     name,
		Note:     spec.Note,
		Contract: spec.Contract,
		Replace:  r.opts.Replace,
	})
	if err != nil {
		result.SaveError = err.Error()
		return result
	}
	result.Saved = true
	result.EndTick = summary.Tick
	return result
}

// RebuildChain 重建一串层（父在前）。任一层失败即停止，返回已完成的层。
func (r *Runner) RebuildChain(tree Tree, names []string) []LayerResult {
	results := make([]LayerResult, 0, len(names))
	for _, name := range names {
		spec := tree[name]
		r.logf("重建 %s（父层 %s，%d 步）", name, orDash(spec.Parent), len(spec.Steps))
		result := r.RebuildLayer(spec, name)
		r.logf("%s", result)
		results = append(results, result)
		if result.Failed() {
			break
		}
	}
	return results
}

// runCommand 把一条命令交给命令队列并在下一 tick 结算，返回回执与拒绝原因。
// 走的是 gamecore.SubmitAndAdvance——与 POST /commands 同一条路径（入队 → 下一
// tick 结算 → 读结果），因此重建时命令被拒的原因与线上完全一致。
func runCommand(sess *startup.Session, cmd model.Command) (string, error) {
	if sess == nil || sess.Core == nil {
		return "", fmt.Errorf("没有活动对局")
	}
	result, err := sess.Core.SubmitAndAdvance("p1", cmd)
	if err != nil {
		return "", err
	}
	return result.Message, nil
}

// ExportFromAudit 从一局对局的审计日志导出构建步骤（回放玩家实际下过的命令）。
// entries 一般来自 GET /audit?action=command 或存档点 save.json 的 debug_state.audit_log。
func ExportFromAudit(entries []*model.AuditEntry, opts checkpoint.ExportOptions) ([]checkpoint.BuildStep, int, error) {
	return checkpoint.ExportBuildSteps(entries, opts)
}

// ReadAuditFromCheckpoint 读存档点里的审计日志（导出构建记录用）。
func ReadAuditFromCheckpoint(checkpointDir, name string) ([]*model.AuditEntry, error) {
	path := filepath.Join(checkpointDir, name, "save.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	save, err := gamedir.DecodeSaveFile(raw)
	if err != nil {
		return nil, fmt.Errorf("解析 %s: %w", path, err)
	}
	return save.DebugState.AuditLog, nil
}

func describeCheck(check checkpoint.ContractCheck) string {
	switch {
	case check.Kind == "no_alert_since":
		return fmt.Sprintf("%s(%s@tick%d)", check.Kind, check.AlertType, check.Tick)
	case check.Type != "" && check.ItemID != "":
		return fmt.Sprintf("%s(%s/%s≥%d)", check.Kind, check.Type, check.ItemID, check.N)
	case check.Type != "":
		return fmt.Sprintf("%s(%s≥%d)", check.Kind, check.Type, check.N)
	case check.TechID != "":
		return fmt.Sprintf("%s(%s)", check.Kind, check.TechID)
	case check.ItemID != "":
		return fmt.Sprintf("%s(%s≥%d)", check.Kind, check.ItemID, check.N)
	default:
		return check.Kind
	}
}

func describeFailures(report checkpoint.ContractReport) string {
	var parts []string
	for _, result := range report.Results {
		if result.Passed {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s 实际=%s", describeCheck(result.Check), result.Actual))
	}
	return strings.Join(parts, "; ")
}
