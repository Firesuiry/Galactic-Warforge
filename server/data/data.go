// Package data 内置默认游戏数据：物品、配方、科技、建筑、单位、战斗系数与战争蓝图。
// 文件格式见 docs/dev/数据配置文件.md；config.yaml 的 game_data_dir 可整套替换。
package data

import "embed"

// FS 内置的 *.yaml 数据文件。
//
//go:embed *.yaml
var FS embed.FS
