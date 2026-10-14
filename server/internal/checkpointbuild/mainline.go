package checkpointbuild

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"siliconworld/internal/checkpoint"
	"siliconworld/internal/model"
)

// 主线前几层（cp-root → cp-base）的构建步骤生成器。
//
// 为什么是生成而不是手写：这些层的坐标要跟着 skirmish 地图与细分网格走
// （3×3 占地、cell 坐标），手写一遍就会随地图/网格改动过期。这里用「当前局面
// 的实测坐标」拼出步骤：矿点、空地、机甲位置全部从世界状态里读出来。
//
// 只覆盖主线前四层（cp-root / cp-power / cp-mining / cp-base）；
// 更下游的层（cp-barracks 及之后）在 docs/guide/存档点回归测试.md 里列为待办。

// 铁铜混合簇（HQ 正北 res-2..res-16）与纯石矿簇的坐标来自 skirmish-seed-001
// 的实测（map-skirmish.yaml face_size 288，出生点 54,144）。矿机 3×3 占地 +
// 外扩 1 格覆盖 5×5 框内的全部矿脉，所以要选「框内只有一种矿」的落点。
var (
	ironMineAnchor   = model.Position{X: 55, Y: 137} // 覆盖 res-2/3/4/5/6/7/8/9/10 共 9 脉纯铁
	copperMineAnchor = model.Position{X: 51, Y: 142} // 覆盖 res-14/15/16 三脉纯铜
)

// BuildMainLineSteps 生成一层的步骤：把「手搓 → 建造 → 通电出矿」的循环按层拆开。
func BuildMainLineSteps(layer string) ([]checkpoint.BuildStep, error) {
	switch layer {
	case "cp-root":
		return nil, nil
	case "cp-power":
		return cpPowerSteps(), nil
	case "cp-mining":
		return cpMiningSteps(), nil
	case "cp-base":
		return cpBaseSteps(), nil
	default:
		return nil, fmt.Errorf("没有为 %s 生成主线构建步骤的规则", layer)
	}
}

func cmdStep(cmd model.Command) checkpoint.BuildStep { return checkpoint.BuildStep{Cmd: &cmd} }

func advance(tick int64) checkpoint.BuildStep { return checkpoint.BuildStep{AdvanceToTick: &tick} }

func waitFor(check checkpoint.ContractCheck, timeout int64) checkpoint.BuildStep {
	return checkpoint.BuildStep{WaitUntil: &check, TimeoutTicks: timeout}
}

func buildCmd(x, y int, buildingType, recipe, direction string) model.Command {
	payload := map[string]any{"building_type": buildingType}
	if recipe != "" {
		payload["recipe_id"] = recipe
	}
	if direction != "" {
		payload["direction"] = direction
	}
	return model.Command{
		Type: model.CmdBuild,
		Target: model.CommandTarget{
			Layer:    "planet",
			PlanetID: "planet-1-1",
			Position: &model.Position{X: x, Y: y},
		},
		Payload: payload,
	}
}

func mineCmd(unitID, resourceID string, quantity int) model.Command {
	return model.Command{
		Type:   model.CmdMineResource,
		Target: model.CommandTarget{Layer: "planet", EntityID: unitID},
		Payload: map[string]any{
			"resource_id": resourceID,
			"quantity":    quantity,
		},
	}
}

func craftCmd(unitID, recipeID string, quantity int) model.Command {
	return model.Command{
		Type:   model.CmdCraftItem,
		Target: model.CommandTarget{Layer: "planet", EntityID: unitID},
		Payload: map[string]any{
			"recipe_id": recipeID,
			"quantity":  quantity,
		},
	}
}

func setRecipeCmd(buildingID, recipeID string) model.Command {
	payload := map[string]any{}
	if recipeID != "" {
		payload["recipe_id"] = recipeID
	}
	return model.Command{
		Type:    model.CmdSetRecipe,
		Target:  model.CommandTarget{Layer: "planet", EntityID: buildingID},
		Payload: payload,
	}
}

func transferCmd(buildingID, itemID string, quantity int, direction string) model.Command {
	return model.Command{
		Type:   model.CmdTransferItem,
		Target: model.CommandTarget{Layer: "planet", EntityID: buildingID},
		Payload: map[string]any{
			"building_id": buildingID,
			"item_id":     itemID,
			"quantity":    quantity,
			"direction":   direction,
		},
	}
}

func moveCmd(unitID string, x, y int) model.Command {
	return model.Command{
		Type: model.CmdMove,
		Target: model.CommandTarget{
			Layer:    "planet",
			EntityIDs: []string{unitID},
			PlanetID: "planet-1-1",
		},
		Payload: map[string]any{},
		// move 的位置走 target.position，由 buildMoveTarget 补齐。
		TargetPos: &model.Position{X: x, Y: y},
	}
}

// BuildMainLineFromWorld 用真实局面（读档后的世界状态）校正生成器里的坐标常量。
// 返回校正后的常量，便于在报告里记录「本局实测落点」。
func BuildMainLineFromWorld(world *model.WorldState) (map[string]model.Position, error) {
	if world == nil {
		return nil, fmt.Errorf("world is nil")
	}
	out := map[string]model.Position{}
	// 矿机落点：按「5×5 框内只有一种矿」挑最近的纯矿点。
	for kind, anchor := range map[string]model.Position{model.ItemIronOre: ironMineAnchor, model.ItemCopperOre: copperMineAnchor} {
		if node := pureSiteNear(world, anchor, kind); node != nil {
			out[string(kind)] = *node
		}
	}
	return out, nil
}

// pureSiteNear 在 anchor 附近找「5×5 覆盖框内只有 kind 一种矿」的采矿机锚点。
func pureSiteNear(world *model.WorldState, anchor model.Position, kind string) *model.Position {
	best := -1
	var bestPos *model.Position
	for dy := -8; dy <= 8; dy++ {
		for dx := -8; dx <= 8; dx++ {
			candidate := model.Position{X: anchor.X + dx, Y: anchor.Y + dy}
			if !world.InBounds(candidate.X, candidate.Y) {
				continue
			}
			covered, target := 0, 0
			for oy := -1; oy < 4; oy++ {
				for ox := -1; ox < 4; ox++ {
					cell := world.SurfaceOffset(candidate, ox, oy)
					if !world.InBounds(cell.X, cell.Y) {
						continue
					}
					id := world.Grid[cell.Y][cell.X].ResourceNodeID
					if id == "" {
						continue
					}
					covered++
					if node := world.Resources[id]; node != nil && node.Kind == kind {
						target++
					}
				}
			}
			if covered == 0 || covered != target {
				continue
			}
			if score := target*1000 - abs(dx) - abs(dy); score > best {
				best = score
				pos := candidate
				bestPos = &pos
			}
		}
	}
	return bestPos
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// WriteSpec 把生成好的步骤写回构建记录文件（保留契约与说明）。
func WriteSpec(specDir, layer string, steps []checkpoint.BuildStep) error {
	path := filepath.Join(specDir, layer+".json")
	spec, err := checkpoint.LoadBuildSpec(path)
	if err != nil {
		return err
	}
	spec.Steps = steps
	raw, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}
