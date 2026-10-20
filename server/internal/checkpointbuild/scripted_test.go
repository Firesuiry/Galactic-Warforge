package checkpointbuild

import (
	"os"
	"path/filepath"
	"testing"

	"siliconworld/internal/checkpoint"
)

// TestEarlyScriptLayersCoverAllRoles 保证分层划分与脚本角色表一一对应：
// 少一个角色，那一段命令就会落进下一层（或丢掉），重建出来的局面就与预期不符。
func TestEarlyScriptLayersCoverAllRoles(t *testing.T) {
	layers := EarlyScriptLayers()
	if len(layers) == 0 {
		t.Fatal("没有分层")
	}
	seen := map[string]string{}
	for _, layer := range layers {
		if layer.Name == "" {
			t.Fatal("层缺名字")
		}
		if len(layer.Roles) == 0 {
			t.Fatalf("层 %s 没有角色", layer.Name)
		}
		if len(layer.Contract.Checks) == 0 {
			t.Fatalf("层 %s 没有契约", layer.Name)
		}
		for _, role := range layer.Roles {
			if prev, ok := seen[role]; ok {
				t.Fatalf("角色 %s 同时属于 %s 和 %s", role, prev, layer.Name)
			}
			seen[role] = layer.Name
		}
	}
	// 每层的契约里都要有「对局未结束 / 玩家存活」，这是所有下游测试的前提。
	for _, layer := range layers {
		kinds := map[string]bool{}
		for _, check := range layer.Contract.Checks {
			kinds[check.Kind] = true
		}
		if !kinds["game_not_finished"] || !kinds["player_alive"] {
			t.Fatalf("层 %s 的契约缺 game_not_finished / player_alive", layer.Name)
		}
	}
}

// TestRootLayerIsSelfConsistent 保证根层能通过构建记录校验（无父档是允许的）。
func TestRootLayerIsSelfConsistent(t *testing.T) {
	root := RootLayer()
	if err := root.Validate(); err != nil {
		t.Fatalf("根层构建记录不自洽: %v", err)
	}
	if root.Parent != "" {
		t.Fatalf("根层不该有父档，实际 %q", root.Parent)
	}
	if root.EndTick <= 0 {
		t.Fatalf("根层要有落点 tick，实际 %d", root.EndTick)
	}
}

// TestWriteSpecsRoundTrip 保证写盘后再读回来是同一份（steps / end_tick / 契约都不丢）。
func TestWriteSpecsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	root := RootLayer()
	specs := map[string]*checkpoint.BuildSpec{RootLayerName: &root}
	if err := WriteSpecs(dir, specs); err != nil {
		t.Fatalf("写构建记录: %v", err)
	}
	path := filepath.Join(dir, RootLayerName+".json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("构建记录没写出来: %v", err)
	}
	back, err := checkpoint.LoadBuildSpec(path)
	if err != nil {
		t.Fatalf("读回构建记录: %v", err)
	}
	if back.EndTick != root.EndTick {
		t.Fatalf("end_tick 丢了：写入 %d 读回 %d", root.EndTick, back.EndTick)
	}
	if len(back.Steps) != len(root.Steps) {
		t.Fatalf("步骤数不一致：写入 %d 读回 %d", len(root.Steps), len(back.Steps))
	}
	if len(back.Contract.Checks) != len(root.Contract.Checks) {
		t.Fatalf("契约条数不一致：写入 %d 读回 %d", len(root.Contract.Checks), len(back.Contract.Checks))
	}
}

// TestRebuildOrderChainsParents 保证重建顺序是父在前，且链上有环时报错。
func TestRebuildOrderChainsParents(t *testing.T) {
	tree := Tree{
		"cp-root":   {Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(1)}}},
		"cp-power":  {Parent: "cp-root", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(2)}}},
		"cp-mining": {Parent: "cp-power", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(3)}}},
	}
	order, err := RebuildOrder(tree, "cp-mining")
	if err != nil {
		t.Fatalf("算重建顺序: %v", err)
	}
	want := []string{"cp-root", "cp-power", "cp-mining"}
	if len(order) != len(want) {
		t.Fatalf("顺序长度 %d，期望 %d：%v", len(order), len(want), order)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("第 %d 个应是 %s，实际 %s（全序 %v）", i, want[i], order[i], order)
		}
	}

	cyclic := Tree{
		"a": {Parent: "b", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(1)}}},
		"b": {Parent: "a", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(1)}}},
	}
	if _, err := RebuildOrder(cyclic, "a"); err == nil {
		t.Fatal("parent 链有环时应报错")
	}
}

// TestSubtreeFromRoot 保证 -from 会带上全部下游（父在子前）。
func TestSubtreeFromRoot(t *testing.T) {
	tree := Tree{
		"cp-root":   {Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(1)}}},
		"cp-power":  {Parent: "cp-root", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(2)}}},
		"cp-mining": {Parent: "cp-power", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(3)}}},
		"cp-lab":    {Parent: "cp-power", Steps: []checkpoint.BuildStep{{AdvanceToTick: ptrInt64(4)}}},
	}
	order := Subtree(tree, "cp-power")
	if len(order) != 3 {
		t.Fatalf("子树应含 cp-power 与两个下游，实际 %v", order)
	}
	if order[0] != "cp-power" {
		t.Fatalf("子树根应排最前，实际 %v", order)
	}
}

func ptrInt64(v int64) *int64 { return &v }

// TestRepoBuildSpecsAreExecutable 把仓库里的构建记录也当成被测数据：docs/guide/checkpoints
// 下的每一份都要能解析、步骤自洽、parent 指向存在的一层。层表（README / 回归测试
// 指南）与 -list 对不上时，最容易坏的就是这里——写坏一个 JSON 或把 parent 写成
// 已退役的层，重建工具要到跑整棵树时才报错。
func TestRepoBuildSpecsAreExecutable(t *testing.T) {
	specDir := filepath.Join("..", "..", "..", "docs", "guide", "checkpoints")
	tree, err := LoadTree(specDir)
	if err != nil {
		t.Fatalf("读构建记录目录: %v", err)
	}
	if len(tree) == 0 {
		t.Fatal("构建记录目录里没有 JSON")
	}
	for name, spec := range tree {
		if spec == nil {
			t.Fatalf("%s 不是可执行的构建记录（旧版文字 build？）", name)
		}
		if err := spec.Validate(); err != nil {
			t.Fatalf("%s 不自洽: %v", name, err)
		}
		if spec.Parent != "" {
			if parent, ok := tree[spec.Parent]; !ok || parent == nil {
				t.Fatalf("%s 的 parent %q 没有可执行构建记录", name, spec.Parent)
			}
		}
		// 契约里不能出现未知谓词：重建跑到落点才发现「未知谓词」等于白跑一趟。
		for _, check := range spec.Contract.Checks {
			if !knownContractKind(check.Kind) {
				t.Fatalf("%s 的契约用了未知谓词 %q", name, check.Kind)
			}
		}
	}
}

// knownContractKind 是契约谓词词表（与 internal/gamecore/contract.go 的 switch 一致）。
// 新增谓词时两边都要加：这里漏了会让构建记录在重建时静默失败。
func knownContractKind(kind string) bool {
	switch kind {
	case "tick_gte", "tick_lt", "game_not_finished", "player_alive",
		"tech_researched", "research_in_progress", "research_progress_gte",
		"building_count_gte", "building_running_gte", "building_item_gte",
		"building_item_at_gte", "building_item_at_lt",
		"building_no_alert_since", "building_alert_since",
		"unit_count_gte", "unit_near", "item_gte", "no_alert_since",
		"dark_fog_hostile", "dark_fog_calmed", "enemy_attack_seen",
		"mecha_count_gte", "mecha_operator_count":
		return true
	}
	return false
}
