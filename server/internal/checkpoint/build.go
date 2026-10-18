package checkpoint

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"siliconworld/internal/model"
)

// 存档点的「构建段」可执行记录。
//
// 一层存档点由三样东西定义（见 docs/guide/存档点回归测试.md 第 3 节）：父层、
// 构建记录、契约。构建记录原先只是一段文字，重建时只能靠人回忆当初点了什么；
// 这里把它定义成**有序步骤数组**，重建 = 照着重放一遍。
//
// 首选来源是「真实 UI 试玩的审计日志导出」（见 ExportBuildSteps）：玩家在网页上
// 实际下过的命令原样落进 cmd 步骤，重建即回放。手写步骤是没有试玩记录时的兜底。
//
// 三种步骤：
//
//	{"cmd": {...}}                 发一条命令（body 就是 POST /commands 里的那条命令）
//	{"advance_to_tick": 4096}      快进到指定 tick
//	{"wait_until": {契约谓词}, "timeout_ticks": 600}
//	                               等谓词成立；超时即失败并报出卡在哪一步
//	{"item_growth": {"position", "item_id", "growth", "advance_ticks"}}
//	                               推进若干 tick，断言某建筑里某物品的存量增长
//	                               达到阈值（「产线此刻真的在流动」）
type BuildStep struct {
	// Cmd 是一条命令，字段与 POST /commands 的 commands[] 元素一致。
	Cmd *model.Command `json:"cmd,omitempty"`
	// AdvanceToTick 推进到该 tick（不含等待命令结算）。
	AdvanceToTick *int64 `json:"advance_to_tick,omitempty"`
	// WaitUntil 等一个契约谓词成立（谓词词表见 internal/checkpoint/contract.go）。
	WaitUntil *ContractCheck `json:"wait_until,omitempty"`
	// TimeoutTicks 是 WaitUntil 的超时（tick）。缺省 600。
	TimeoutTicks int64 `json:"timeout_ticks,omitempty"`
	// ItemGrowth 是「产线流动」断言：推进若干 tick，断言某建筑里某物品的存量
	// 增长达到阈值。用于证明产线此刻真的在流动，而不是只留下读档前攒下的存量
	// （试玩 1016 报告问题 1）。执行方见 internal/checkpointbuild。
	ItemGrowth *ItemGrowthStep `json:"item_growth,omitempty"`
	// Note 是给人看的说明，重建时忽略。
	Note string `json:"note,omitempty"`
}

// Validate 检查步骤本身是否自洽（恰好一种动作）。
func (s BuildStep) Validate() error {
	kinds := 0
	if s.Cmd != nil {
		kinds++
	}
	if s.AdvanceToTick != nil {
		kinds++
	}
	if s.WaitUntil != nil {
		kinds++
	}
	if s.ItemGrowth != nil {
		kinds++
	}
	if kinds != 1 {
		return fmt.Errorf("构建步骤必须恰好是 cmd / advance_to_tick / wait_until 之一")
	}
	if s.Cmd != nil && s.Cmd.Type == "" {
		return fmt.Errorf("构建步骤的 cmd 缺少 type")
	}
	if s.WaitUntil != nil && s.WaitUntil.Kind == "" {
		return fmt.Errorf("构建步骤的 wait_until 缺少 kind")
	}
	if s.ItemGrowth != nil {
		if s.ItemGrowth.Growth <= 0 {
			return fmt.Errorf("构建步骤的 item_growth 缺少正数 growth")
		}
		if s.ItemGrowth.ItemID == "" {
			return fmt.Errorf("构建步骤的 item_growth 缺少 item_id")
		}
	}
	if s.AdvanceToTick != nil && *s.AdvanceToTick < 0 {
		return fmt.Errorf("构建步骤的 advance_to_tick 不能为负")
	}
	return nil
}

// Timeout 返回 WaitUntil 的超时 tick 数（缺省 600）。
func (s BuildStep) Timeout() int64 {
	if s.TimeoutTicks > 0 {
		return s.TimeoutTicks
	}
	return 600
}

// BuildSpec 是一层的可执行构建记录，对应 docs/guide/checkpoints/<名字>.json。
type BuildSpec struct {
	// Parent 是父层存档点名（也是 LoadCheckpoint 的起点）。
	Parent string `json:"parent"`
	// Note 是这一层的说明，写进新存档点的 manifest。
	Note string `json:"note,omitempty"`
	// Steps 是有序步骤。
	Steps []BuildStep `json:"steps"`
	// EndTick 是这一层的落点 tick：重放完步骤后把世界推进到该 tick，再校验契约、
	// 存档（0 = 不额外推进，停在最后一步的 tick）。
	//
	// 契约里的 building_count_gte / building_running_gte 看的是「此刻已落成的
	// 建筑」——建造命令只是把施工任务排进队列，建筑要若干 tick 后才落地。脚本化
	// 生成时这个字段就是脚本走到下一层之前的那个 tick；从试玩审计日志导出时，
	// 填存档点当时的 tick（也就是 -to-tick）。
	EndTick int64 `json:"end_tick,omitempty"`
	// Contract 是这一层必须成立的条件。
	Contract Contract `json:"contract"`
}

// Validate 校验整份构建记录。parent 为空只允许出现在根层（cp-root）：
// 根层的重建方式是「按配置开新局」，没有父档可读。
func (s BuildSpec) Validate() error {
	if len(s.Steps) == 0 {
		return fmt.Errorf("构建记录没有任何步骤")
	}
	for i, step := range s.Steps {
		if err := step.Validate(); err != nil {
			return fmt.Errorf("第 %d 步：%w", i+1, err)
		}
	}
	return nil
}

// LoadBuildSpec 读取并校验一份构建记录（docs/guide/checkpoints/<名字>.json）。
func LoadBuildSpec(path string) (*BuildSpec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var spec BuildSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return nil, fmt.Errorf("解析构建记录 %s: %w", filepath.Base(path), err)
	}
	if err := spec.Validate(); err != nil {
		return nil, fmt.Errorf("构建记录 %s: %w", filepath.Base(path), err)
	}
	return &spec, nil
}

// ExportOptions 控制审计日志导出的过滤与合并。
type ExportOptions struct {
	PlayerID string
	FromTick int64
	ToTick   int64 // 0 = 不设上限
	// MaxGapTicks 控制 advance_to_tick 的插入：
	//   > 0  相邻两条命令之间超过这么多 tick 才插（压缩长等待）
	//   = 0  不插（步骤之间只有命令，回放时命令会连在一起下发）
	//   < 0  每条命令前都插（默认）：按玩家当初的节奏回放，命令之间的等待
	//        （手搓、采矿、建筑落成）都由 tick 推进还原
	MaxGapTicks int64
}

// ExportBuildSteps 从审计日志导出一层的构建步骤：把玩家真正下过的命令按 tick
// 排好，中间按需补 advance_to_tick。这样重建就是回放玩家实际的操作。
//
// 只保留被服务端接受的命令（status 不是 rejected/failed）：被拒的命令是回归信号，
// 但不该进构建记录——重放它只会再被拒一次。
func ExportBuildSteps(entries []*model.AuditEntry, opts ExportOptions) ([]BuildStep, int, error) {
	type record struct {
		tick int64
		cmd  model.Command
	}
	var kept []record
	rejected := 0
	for _, entry := range entries {
		if entry == nil || entry.Action != "command" {
			continue
		}
		if opts.PlayerID != "" && entry.PlayerID != opts.PlayerID {
			continue
		}
		if entry.Tick < opts.FromTick {
			continue
		}
		if opts.ToTick > 0 && entry.Tick > opts.ToTick {
			continue
		}
		raw, ok := entry.Details["command"]
		if !ok {
			continue
		}
		data, err := json.Marshal(raw)
		if err != nil {
			return nil, rejected, fmt.Errorf("第 %d tick 的命令无法序列化: %w", entry.Tick, err)
		}
		var cmd model.Command
		if err := json.Unmarshal(data, &cmd); err != nil {
			return nil, rejected, fmt.Errorf("第 %d tick 的命令无法解析: %w", entry.Tick, err)
		}
		if cmd.Type == "" {
			continue
		}
		if status, _ := entry.Details["status"].(string); status == string(model.StatusRejected) || status == string(model.StatusFailed) {
			rejected++
			continue
		}
		kept = append(kept, record{tick: entry.Tick, cmd: cmd})
	}
	steps := make([]BuildStep, 0, len(kept)*2)
	var lastTick int64
	for i, item := range kept {
		switch {
		case opts.MaxGapTicks < 0:
			// 逐条还原节奏：命令的 tick 就是玩家当初下它的 tick。
			target := item.tick
			steps = append(steps, BuildStep{AdvanceToTick: &target})
		case opts.MaxGapTicks > 0 && i > 0 && item.tick-lastTick > opts.MaxGapTicks:
			target := item.tick
			steps = append(steps, BuildStep{AdvanceToTick: &target})
		}
		cmd := item.cmd
		steps = append(steps, BuildStep{Cmd: &cmd})
		lastTick = item.tick
	}
	return steps, rejected, nil
}

// ItemGrowthStep 是构建记录里的「产线流动」步骤：推进 AdvanceTicks 个 tick，
// 断言 Position 上该玩家建筑的 ItemID 存量增长 ≥ Growth。
//
// 存量断言（building_item_at_gte）只能证明「曾经产出过」；死锁的产线照样能让
// 它通过（试玩 1016 报告问题 1）。item_growth 先数一次、推进一段、再数一次，
// 差值为负或不够大即失败。
type ItemGrowthStep struct {
	// Position 是被观察建筑的锚点格。
	Position model.Position `json:"position"`
	// ItemID 是观察的物品。
	ItemID string `json:"item_id"`
	// Growth 是要求的最小增量（≥ 1）。
	Growth int `json:"growth"`
	// AdvanceTicks 是观察窗口（tick）。缺省 600。
	AdvanceTicks int64 `json:"advance_ticks,omitempty"`
	// Elevation 是被观察建筑所在层：0 = 地面（TileBuilding），≥1 = 高架带
	// （BeltLayers）。高架带不写 TileBuilding，必须显式给层号。
	Elevation int `json:"elevation,omitempty"`
}

// Window 返回观察窗口的 tick 数（缺省 600）。
func (g ItemGrowthStep) Window() int64 {
	if g.AdvanceTicks > 0 {
		return g.AdvanceTicks
	}
	return 600
}

// Validate 检查一条 item_growth 是否可执行。
func (g ItemGrowthStep) Validate() error {
	if g.Growth <= 0 {
		return fmt.Errorf("item_growth 的 growth 必须为正数")
	}
	if g.ItemID == "" {
		return fmt.Errorf("item_growth 缺少 item_id")
	}
	return nil
}
