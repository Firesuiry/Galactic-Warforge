// catalogdump 导出服务端权威目录（物品/配方/科技/建筑/建筑运行时/资源矿脉）为 JSON，
// 用于文档生成、外部对齐比对与测试基线。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

type dump struct {
	Items            []model.ItemDefinition            `json:"items"`
	Recipes          []model.RecipeDefinition          `json:"recipes"`
	Techs            []*model.TechDefinition           `json:"techs"`
	Buildings        []model.BuildingDefinition        `json:"buildings"`
	BuildingRuntimes []model.BuildingRuntimeDefinition `json:"building_runtimes"`
	ResourceKinds    []mapmodel.ResourceKind           `json:"resource_kinds"`
}

func main() {
	out := flag.String("out", "", "输出文件（默认 stdout）")
	flag.Parse()
	d := dump{
		Items:            model.AllItems(),
		Recipes:          model.AllRecipes(),
		Techs:            model.AllTechDefinitions(),
		Buildings:        model.AllBuildingDefinitions(),
		BuildingRuntimes: model.AllBuildingRuntimeDefinitions(),
	}
	for _, k := range mapmodel.AllResourceKinds() {
		d.ResourceKinds = append(d.ResourceKinds, k)
	}
	data, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *out == "" {
		fmt.Println(string(data))
		return
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "items=%d recipes=%d techs=%d buildings=%d runtimes=%d resource_kinds=%d -> %s\n",
		len(d.Items), len(d.Recipes), len(d.Techs), len(d.Buildings), len(d.BuildingRuntimes), len(d.ResourceKinds), *out)
}
