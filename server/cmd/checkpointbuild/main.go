// checkpointbuild 是存档点重建的命令行入口：
//
//	checkpointbuild -list
//	checkpointbuild -layer cp-power                 重建单层（自动先重建父链）
//	checkpointbuild -from cp-power                  重建 cp-power 及其全部下游
//	checkpointbuild -layer cp-base -export         从存档点的审计日志导出构建步骤（不写盘）
//	checkpointbuild -layer cp-base -export -write  导出并写回构建记录的 steps 字段
//
// 默认路径按仓库布局：构建记录 docs/guide/checkpoints，存档点 .run/checkpoints，
// 配置 server/config-skirmish.yaml + server/map-skirmish.yaml。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/checkpointbuild"
)

func main() {
	root := flag.String("root", "", "仓库根目录（默认取当前目录）")
	configPath := flag.String("config", "server/config-skirmish.yaml", "服务端配置")
	mapConfigPath := flag.String("map-config", "server/map-skirmish.yaml", "地图配置")
	specDir := flag.String("spec-dir", "docs/guide/checkpoints", "构建记录目录")
	checkpointDir := flag.String("checkpoint-dir", ".run/checkpoints", "存档点目录")
	dataDir := flag.String("data-dir", "", "重建期间的活动存档目录（默认临时目录）")
	layer := flag.String("layer", "", "只重建这一层（含其父链）")
	from := flag.String("from", "", "重建这一层及其全部下游")
	list := flag.Bool("list", false, "列出构建记录树与状态")
	export := flag.Bool("export", false, "从存档点的审计日志导出构建步骤（不重建）")
	write := flag.Bool("write", false, "导出时把步骤写回构建记录文件")
	player := flag.String("player", "p1", "导出时只取该玩家下过的命令")
	fromTick := flag.Int64("from-tick", 0, "导出时的起始 tick")
	toTick := flag.Int64("to-tick", 0, "导出时的结束 tick（0 = 不限）")
	maxGap := flag.Int64("max-gap", 400, "导出时相邻命令间隔超过这么多 tick 就插入 advance_to_tick（0 = 不插）")
	replace := flag.Bool("replace", true, "覆盖同名存档点")
	flag.Parse()

	base := *root
	if base == "" {
		wd, err := os.Getwd()
		if err != nil {
			log.Fatalf("取当前目录: %v", err)
		}
		base = wd
	}
	abs := func(p string) string {
		if filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(base, p)
	}
	opts := checkpointbuild.Options{
		ConfigPath:    abs(*configPath),
		MapConfigPath: abs(*mapConfigPath),
		SpecDir:       abs(*specDir),
		CheckpointDir: abs(*checkpointDir),
		DataDir:       *dataDir,
		Replace:       *replace,
		Log:           func(format string, args ...any) { fmt.Printf(format+"\n", args...) },
	}

	tree, err := checkpointbuild.LoadTree(opts.SpecDir)
	if err != nil {
		log.Fatalf("读取构建记录: %v", err)
	}

	if *list {
		printTree(tree)
		return
	}

	if *export {
		if *layer == "" {
			log.Fatalf("-export 需要 -layer")
		}
		runExport(opts, *layer, *player, *fromTick, *toTick, *maxGap, *write)
		return
	}

	if *layer == "" && *from == "" {
		printTree(tree)
		flag.Usage()
		os.Exit(2)
	}

	runner, err := checkpointbuild.NewRunner(opts)
	if err != nil {
		log.Fatalf("装配重建环境: %v", err)
	}
	defer runner.Close()

	var order []string
	switch {
	case *from != "":
		order = checkpointbuild.Subtree(tree, *from)
		if len(order) == 0 {
			log.Fatalf("找不到 %s 的可执行构建记录", *from)
		}
	case *layer != "":
		order, err = checkpointbuild.RebuildOrder(tree, *layer)
		if err != nil {
			log.Fatalf("%v", err)
		}
	}

	started := time.Now()
	results := runner.RebuildChain(tree, order)
	fmt.Printf("\n重建结果（%s）：\n", time.Since(started).Round(time.Millisecond))
	failed := false
	for _, result := range results {
		fmt.Println("  " + result.String())
		if result.Failed() {
			failed = true
		}
	}
	if failed {
		os.Exit(1)
	}
}

func printTree(tree checkpointbuild.Tree) {
	names := make([]string, 0, len(tree))
	for name := range tree {
		names = append(names, name)
	}
	sortStrings(names)
	fmt.Printf("构建记录 %d 条：\n", len(names))
	for _, name := range names {
		spec := tree[name]
		if spec == nil {
			fmt.Printf("  %-22s %s\n", name, "（旧版文字 build，待改写为可执行步骤）")
			continue
		}
		cmds, waits, advances := 0, 0, 0
		for _, step := range spec.Steps {
			switch {
			case step.Cmd != nil:
				cmds++
			case step.WaitUntil != nil:
				waits++
			case step.AdvanceToTick != nil:
				advances++
			}
		}
		fmt.Printf("  %-22s parent=%-18s 步骤 %d（命令 %d / 等待 %d / 快进 %d）契约 %d 条\n",
			name, orDash(spec.Parent), len(spec.Steps), cmds, waits, advances, len(spec.Contract.Checks))
	}
}

func runExport(opts checkpointbuild.Options, layer, player string, fromTick, toTick, maxGap int64, write bool) {
	entries, err := checkpointbuild.ReadAuditFromCheckpoint(opts.CheckpointDir, layer)
	if err != nil {
		log.Fatalf("读存档点 %s 的审计日志: %v", layer, err)
	}
	steps, rejected, err := checkpointbuild.ExportFromAudit(entries, checkpoint.ExportOptions{
		PlayerID:    player,
		FromTick:    fromTick,
		ToTick:      toTick,
		MaxGapTicks: maxGap,
	})
	if err != nil {
		log.Fatalf("导出构建步骤: %v", err)
	}
	fmt.Printf("从 %s 的审计日志导出 %d 步（跳过被拒命令 %d 条）\n", layer, len(steps), rejected)
	if !write {
		out, _ := json.MarshalIndent(steps, "", "  ")
		fmt.Println(string(out))
		return
	}
	path := filepath.Join(opts.SpecDir, layer+".json")
	spec, err := checkpoint.LoadBuildSpec(path)
	if err != nil {
		log.Fatalf("读构建记录 %s: %v", path, err)
	}
	spec.Steps = steps
	raw, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		log.Fatalf("序列化: %v", err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
		log.Fatalf("写入 %s: %v", path, err)
	}
	fmt.Printf("已写回 %s（%d 步）\n", path, len(steps))
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && strings.Compare(values[j-1], values[j]) > 0; j-- {
			values[j-1], values[j] = values[j], values[j-1]
		}
	}
}
