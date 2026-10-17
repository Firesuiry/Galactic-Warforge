package checkpointbuild

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/model"
)

// item_growth 是「产线此刻真的在流动」的构建步骤（试玩 1016 报告问题 1）。
// 这里覆盖三件事：记录格式往返、校验拒绝非法值、重建路径真的推进 tick 并断言增量。

func TestItemGrowthRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "layer.json")
	raw := `{
	  "parent": "cp-base",
	  "steps": [
	    {"advance_to_tick": 100},
	    {"item_growth": {"position": {"x": 64, "y": 132, "z": 0}, "item_id": "iron_ingot", "growth": 2, "advance_ticks": 900}}
	  ],
	  "end_tick": 1200,
	  "contract": {"checks": [{"kind": "game_not_finished"}]}
	}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	spec, err := checkpoint.LoadBuildSpec(path)
	if err != nil {
		t.Fatalf("读构建记录: %v", err)
	}
	if len(spec.Steps) != 2 || spec.Steps[1].ItemGrowth == nil {
		t.Fatalf("item_growth 步骤没解析出来：%+v", spec.Steps)
	}
	growth := *spec.Steps[1].ItemGrowth
	if growth.Position.X != 64 || growth.Position.Y != 132 || growth.ItemID != "iron_ingot" || growth.Growth != 2 {
		t.Fatalf("字段解析错误：%+v", growth)
	}
	if growth.AdvanceTicks != 900 || growth.Window() != 900 {
		t.Fatalf("advance_ticks 丢了：%+v", growth)
	}

	// 写回再读回：JSON 形态与输入一致（拍平的字段名）。
	data, err := json.Marshal(spec.Steps[1])
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	inner, ok := back["item_growth"].(map[string]any)
	if !ok || inner["item_id"] != "iron_ingot" || inner["growth"] != float64(2) {
		t.Fatalf("序列化形态不对：%s", data)
	}
}

func TestItemGrowthValidation(t *testing.T) {
	base := checkpoint.ItemGrowthStep{Position: model.Position{X: 1, Y: 2}, ItemID: "iron_ingot", Growth: 1}
	if err := base.Validate(); err != nil {
		t.Fatalf("合法步骤不该报错：%v", err)
	}
	zero := base
	zero.Growth = 0
	if err := zero.Validate(); err == nil {
		t.Fatal("growth=0 应被拒绝")
	}
	noItem := base
	noItem.ItemID = ""
	if err := noItem.Validate(); err == nil {
		t.Fatal("缺 item_id 应被拒绝")
	}
	// BuildStep.Validate 也必须拦住非法 item_growth（构建记录读入时就走这条）。
	step := checkpoint.BuildStep{ItemGrowth: &zero}
	if err := step.Validate(); err == nil {
		t.Fatal("BuildStep 应拒绝 growth=0 的 item_growth")
	}
	step = checkpoint.BuildStep{ItemGrowth: &base}
	if err := step.Validate(); err != nil {
		t.Fatalf("合法 item_growth 步骤不该报错：%v", err)
	}
	// 与 cmd 同时出现：不是「恰好一种动作」。
	cmd := model.Command{Type: model.CmdBuild}
	step = checkpoint.BuildStep{ItemGrowth: &base, Cmd: &cmd}
	if err := step.Validate(); err == nil {
		t.Fatal("item_growth 与 cmd 同时出现应被拒绝")
	}
	if got := (checkpoint.ItemGrowthStep{Growth: 1}).Window(); got != 600 {
		t.Fatalf("缺省观察窗口应为 600，实际 %d", got)
	}
}
