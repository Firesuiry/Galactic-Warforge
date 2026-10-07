package model

import (
	"regexp"
	"testing"
)

// 玩家可见目录名称规则：
//   - 物品/配方/科技/建筑/单位/战争目录的 name（及战争目录 description）必须是中文，不含 ASCII 字母；
//   - 唯一允许的 ASCII 字母是 DSP 官方译名沿用的两类记号：等级后缀 "Mk.I/Mk.II/Mk.III"
//     （如 "制造台 Mk.II"、"增产剂 Mk.III"）与 "X射线" 前缀（如 "X射线裂解"）；
//   - 同一目录内 name 唯一（替代配方以 "（高效）/（高级）/（原始）/（旧版）" 等后缀区分）。
var (
	catalogNameAllowedTokens = regexp.MustCompile(`Mk\.(III|II|I)\b|X射线`)
	asciiLetter              = regexp.MustCompile(`[A-Za-z]`)
)

func checkCatalogNames(t *testing.T, catalog string, names map[string]string, requireUnique bool) {
	t.Helper()
	seen := make(map[string]string, len(names))
	for id, name := range names {
		if name == "" {
			t.Errorf("%s %s: name 为空", catalog, id)
			continue
		}
		if asciiLetter.MatchString(catalogNameAllowedTokens.ReplaceAllString(name, "")) {
			t.Errorf("%s %s: name %q 含英文字母", catalog, id, name)
		}
		if !requireUnique {
			continue
		}
		if other, ok := seen[name]; ok {
			t.Errorf("%s: name %q 重复（%s 与 %s）", catalog, name, other, id)
		}
		seen[name] = id
	}
}

func TestCatalogNamesChineseAndUnique(t *testing.T) {
	items := map[string]string{}
	for _, def := range AllItems() {
		items[def.ID] = def.Name
	}
	checkCatalogNames(t, "item", items, true)

	recipes := map[string]string{}
	for _, def := range AllRecipes() {
		recipes[def.ID] = def.Name
	}
	checkCatalogNames(t, "recipe", recipes, true)

	techs := map[string]string{}
	for _, def := range AllTechDefinitions() {
		techs[def.ID] = def.Name
	}
	checkCatalogNames(t, "tech", techs, true)

	buildings := map[string]string{}
	for _, def := range AllBuildingDefinitions() {
		buildings[string(def.ID)] = def.Name
	}
	checkCatalogNames(t, "building", buildings, true)

	units := map[string]string{}
	for id, def := range unitDefinitions {
		units[string(id)] = def.Name
	}
	checkCatalogNames(t, "unit", units, true)

	war := PublicWarfareCatalog()
	warNames := map[string]string{}
	warDescs := map[string]string{}
	for _, e := range war.BaseFrames {
		warNames["frame:"+e.ID] = e.Name
		warDescs["frame:"+e.ID] = e.Description
	}
	for _, e := range war.BaseHulls {
		warNames["hull:"+e.ID] = e.Name
		warDescs["hull:"+e.ID] = e.Description
	}
	for _, e := range war.Components {
		warNames["component:"+e.ID] = e.Name
	}
	for _, e := range war.PublicBlueprints {
		warNames["blueprint:"+e.ID] = e.Name
	}
	checkCatalogNames(t, "war", warNames, true)
	checkCatalogNames(t, "war description", warDescs, false)
}
