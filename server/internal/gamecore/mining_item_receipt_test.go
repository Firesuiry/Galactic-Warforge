package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 采集建筑建成时写进 building.MiningItem，且 build 回执写明将开采什么矿
// （试玩 1016 报告 B2：建造前玩家要知道这台矿机采什么）。
func TestBuildReceiptNamesMinedOre(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	pos := model.Position{X: 24, Y: 24}
	node := &model.ResourceNodeState{ID: "r1", Kind: model.ItemIronOre, Position: pos, Behavior: "finite", Remaining: 100, MaxAmount: 100}
	ws.Resources[node.ID] = node
	ws.Grid[pos.Y][pos.X].ResourceNodeID = node.ID

	res := buildAt(t, core, ws, pos, model.BuildingTypeMiningMachine)
	if res.Code != model.CodeOK {
		t.Fatalf("build rejected: %s %s", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "将开采") {
		t.Fatalf("build 回执应写明将开采的矿种，got %q", res.Message)
	}
	taskID := ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)]
	task := ws.Construction.Tasks[taskID]
	if task == nil || task.MiningItem != model.ItemIronOre {
		t.Fatalf("施工任务应带 mining_item=iron_ore，got %+v", task)
	}
}

// 非采集建筑的施工任务不带 mining_item（回执也不提矿种）。
func TestBuildReceiptOmitsOreForNonCollector(t *testing.T) {
	core := newEnclosureTestCore(t)
	ws := core.World()
	pos := model.Position{X: 24, Y: 24}
	res := buildAt(t, core, ws, pos, model.BuildingTypeWindTurbine)
	if res.Code != model.CodeOK {
		t.Fatalf("build rejected: %s %s", res.Code, res.Message)
	}
	if strings.Contains(res.Message, "将开采") {
		t.Fatalf("风机回执不该提矿种，got %q", res.Message)
	}
	taskID := ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)]
	if task := ws.Construction.Tasks[taskID]; task == nil || task.MiningItem != "" {
		t.Fatalf("非采集任务不该带 mining_item，got %+v", task)
	}
}
