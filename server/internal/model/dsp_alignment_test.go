package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"siliconworld/internal/mapmodel"
)

// dsp_alignment_test.go 是 W1 总验收：以 develop_tools/dsp-catalog 的冻结数据
// （scope.json = DSP 行星内范围权威目录，mapping.json = DSP id → SW id 映射，
// mapping_overrides.json = 人工裁定别名与政策）校验 SW 目录对齐结果。
//
// 验收点：
//   - TestDSPItemCoverage     行星内非建筑/非科技物品全部入库
//   - TestDSPResourceCoverage 18 种种子资源全部注册
//   - TestDSPRecipeCoverage   行星内生产配方（排除建筑/开采）全部入库
//   - TestDSPTechCoverage     researchable 科技节点全部存在且前置不悬空
//   - TestDSPInPlanetClosure  18 种子经配方目录闭包可达全部行星内物品（政策 gated 除外）

const dspCatalogRelDir = "../../../develop_tools/dsp-catalog"

// dspPolicyExcludedTechs 是政策裁定不实现的科技（mapping_overrides.json policy.holo_beacon：
// holo-beacon 为纯展示建筑不实现，其解锁科技随之豁免）。
var dspPolicyExcludedTechs = map[string]bool{
	"holo-beacon-tech": true,
}

// dspClosureGatedItems 是政策 gated 物品（mapping_overrides.json policy.out_of_scope）：
// 反物质/临界光子/宇宙矩阵链与黑雾掉落物保留数据但不给行星内免费解锁路径。
// 这些物品在 scope.json 中 inPlanet=false，本表作为防御性排除守住政策口径。
var dspClosureGatedItems = map[string]bool{
	"antimatter":          true,
	"antimatter_fuel_rod": true,
	"critical_photon":     true,
	"universe_matrix":     true,
}

type dspScopeItem struct {
	Cat      string `json:"cat"`
	Zh       string `json:"zh"`
	En       string `json:"en"`
	InPlanet bool   `json:"inPlanet"`
}

type dspScopeRecipe struct {
	Cat      string             `json:"cat"`
	Zh       string             `json:"zh"`
	In       map[string]float64 `json:"in"`
	Out      map[string]float64 `json:"out"`
	Locked   bool               `json:"locked"`
	IsTech   bool               `json:"is_tech"`
	Mining   bool               `json:"mining"`
	InPlanet bool               `json:"inPlanet"`
}

type dspScopeTech struct {
	Zh     string   `json:"zh"`
	En     string   `json:"en"`
	Prereq []string `json:"prereq"`
}

type dspScopeTechCost struct {
	Researchable bool `json:"researchable"`
}

type dspScope struct {
	Resources []string                    `json:"resources"`
	Items     map[string]dspScopeItem     `json:"items"`
	Recipes   map[string]dspScopeRecipe   `json:"recipes"`
	Techs     map[string]dspScopeTech     `json:"techs"`
	TechCosts map[string]dspScopeTechCost `json:"tech_costs"`
}

type dspMapping struct {
	Mapping struct {
		Items     []map[string]string `json:"items"`
		Buildings []map[string]string `json:"buildings"`
		Techs     []map[string]string `json:"techs"`
		Resources []map[string]string `json:"resources"`
	} `json:"mapping"`
}

type dspOverrides struct {
	ItemAliases     map[string]string `json:"item_aliases"`
	ResourceAliases map[string]string `json:"resource_aliases"`
	RecipeAliases   map[string]string `json:"recipe_aliases"`
	TechAliases     map[string]string `json:"tech_aliases"`
}

// dspCatalog 是加载后的冻结数据视图。
type dspCatalog struct {
	scope     dspScope
	itemMap   map[string]string // DSP item id -> SW item id（仅行星内非建筑物品）
	techMap   map[string]string // DSP tech id -> SW tech id
	resMap    map[string]string // DSP resource id -> SW resource kind
	overrides dspOverrides
}

func dspLoadJSON(t *testing.T, name string, out any) {
	t.Helper()
	path := filepath.Join(dspCatalogRelDir, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

func dspLoadCatalog(t *testing.T) dspCatalog {
	t.Helper()
	var scope dspScope
	var mapping dspMapping
	var overrides dspOverrides
	dspLoadJSON(t, "scope.json", &scope)
	dspLoadJSON(t, "mapping.json", &mapping)
	dspLoadJSON(t, "mapping_overrides.json", &overrides)

	flatten := func(entries []map[string]string) map[string]string {
		out := make(map[string]string, len(entries))
		for _, e := range entries {
			for k, v := range e {
				out[k] = v
			}
		}
		return out
	}
	return dspCatalog{
		scope:     scope,
		itemMap:   flatten(mapping.Mapping.Items),
		techMap:   flatten(mapping.Mapping.Techs),
		resMap:    flatten(mapping.Mapping.Resources),
		overrides: overrides,
	}
}

func dspSnake(id string) string { return strings.ReplaceAll(id, "-", "_") }

// dspInPlanetComponentItems 返回 scope.json 中行星内、非建筑/非科技的物品 id（排序）。
func dspInPlanetComponentItems(c dspCatalog) []string {
	out := make([]string, 0, len(c.scope.Items))
	for id, it := range c.scope.Items {
		if !it.InPlanet {
			continue
		}
		switch it.Cat {
		case "buildings", "buildings-alt", "technologies", "upgrades":
			continue
		}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// dspInPlanetProductionRecipes 返回行星内生产配方 id（排除建筑合成与开采类，排序）。
func dspInPlanetProductionRecipes(c dspCatalog) []string {
	out := make([]string, 0, len(c.scope.Recipes))
	for id, r := range c.scope.Recipes {
		if r.IsTech || r.Mining || !r.InPlanet {
			continue
		}
		if r.Cat == "buildings" || r.Cat == "buildings-alt" {
			continue
		}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// dspResearchableTechs 返回 tech_costs 中标记 researchable 的科技节点 id（排序）。
func dspResearchableTechs(c dspCatalog) []string {
	out := make([]string, 0, len(c.scope.TechCosts))
	for id, tc := range c.scope.TechCosts {
		if tc.Researchable {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}

var dspTechLevelSuffix = regexp.MustCompile(`^(.*)-(\d+)$`)

// dspResolveTech 把 DSP 科技节点 id 解析为 SW 科技 id：
// mapping.json（已含 overrides 裁定）→ tech_aliases → kebab→snake →
// 家族聚合（DSP xxx-N → SW xxx 且 MaxLevel≥N 或单节点）。
func dspResolveTech(c dspCatalog, tid string) (string, bool) {
	if sw, ok := c.techMap[tid]; ok && sw != "" {
		if _, ok := TechDefinitionByID(sw); ok {
			return sw, true
		}
	}
	for _, cand := range []string{c.overrides.TechAliases[tid], dspSnake(tid)} {
		if cand == "" {
			continue
		}
		if _, ok := TechDefinitionByID(cand); ok {
			return cand, true
		}
	}
	if m := dspTechLevelSuffix.FindStringSubmatch(tid); m != nil {
		base, n := m[1], func() int { v, _ := strconv.Atoi(m[2]); return v }()
		for _, cand := range []string{c.overrides.TechAliases[base], dspSnake(base)} {
			if cand == "" {
				continue
			}
			def, ok := TechDefinitionByID(cand)
			if !ok {
				continue
			}
			if def.MaxLevel < 0 || def.MaxLevel >= n || (n == 1 && def.MaxLevel == 0) {
				return cand, true
			}
		}
	}
	return "", false
}

// dspResolveRecipe 把 DSP 配方 id 解析为 SW 配方 id：
// recipe_aliases → kebab→snake → 按输出集合匹配（输出经物品映射换算）。
func dspResolveRecipe(c dspCatalog, rid string, r dspScopeRecipe) (string, bool) {
	for _, cand := range []string{c.overrides.RecipeAliases[rid], dspSnake(rid)} {
		if cand == "" {
			continue
		}
		if _, ok := Recipe(cand); ok {
			return cand, true
		}
	}
	outs := make([]string, 0, len(r.Out))
	for oid := range r.Out {
		swid, ok := c.itemMap[oid]
		if !ok {
			return "", false
		}
		outs = append(outs, swid)
	}
	want := dspOutputKey(outs)
	for _, swr := range AllRecipes() {
		got := make([]string, 0, len(swr.Outputs)+len(swr.Byproducts))
		for _, o := range swr.AllOutputs() {
			got = append(got, o.ItemID)
		}
		if dspOutputKey(got) == want {
			return swr.ID, true
		}
	}
	return "", false
}

func dspOutputKey(ids []string) string {
	sorted := append([]string(nil), ids...)
	sort.Strings(sorted)
	return strings.Join(sorted, ",")
}

// TestDSPItemCoverage 守住：scope.json 行星内非建筑/非科技物品经映射全部在物品目录中。
func TestDSPItemCoverage(t *testing.T) {
	c := dspLoadCatalog(t)
	targets := dspInPlanetComponentItems(c)
	if len(targets) != 99 {
		t.Errorf("in-planet component item count = %d, want frozen 99", len(targets))
	}
	var missing, unmapped []string
	for _, did := range targets {
		swid, ok := c.itemMap[did]
		if !ok || swid == "" {
			unmapped = append(unmapped, did)
			continue
		}
		if _, ok := itemCatalog[swid]; !ok {
			missing = append(missing, fmt.Sprintf("%s->%s", did, swid))
		}
	}
	if len(unmapped) > 0 {
		t.Errorf("items with no mapping entry: %v", unmapped)
	}
	if len(missing) > 0 {
		t.Errorf("items missing from item catalog: %v", missing)
	}
}

// TestDSPResourceCoverage 守住：18 种种子资源全部注册进 mapmodel.AllResourceKinds。
func TestDSPResourceCoverage(t *testing.T) {
	c := dspLoadCatalog(t)
	if len(c.scope.Resources) != 18 {
		t.Errorf("seed resource count = %d, want frozen 18", len(c.scope.Resources))
	}
	registered := make(map[string]bool)
	for _, k := range mapmodel.AllResourceKinds() {
		registered[string(k)] = true
	}
	var missing, unmapped []string
	for _, rid := range c.scope.Resources {
		swid, ok := c.resMap[rid]
		if !ok || swid == "" {
			unmapped = append(unmapped, rid)
			continue
		}
		if !registered[swid] {
			missing = append(missing, fmt.Sprintf("%s->%s", rid, swid))
		}
	}
	if len(unmapped) > 0 {
		t.Errorf("resources with no mapping entry: %v", unmapped)
	}
	if len(missing) > 0 {
		t.Errorf("resources missing from AllResourceKinds: %v", missing)
	}
}

// TestDSPRecipeCoverage 守住：行星内生产配方（排除建筑/开采）全部在配方目录中。
func TestDSPRecipeCoverage(t *testing.T) {
	c := dspLoadCatalog(t)
	targets := dspInPlanetProductionRecipes(c)
	if len(targets) != 95 {
		t.Errorf("in-planet production recipe count = %d, want frozen 95", len(targets))
	}
	var missing []string
	for _, rid := range targets {
		r := c.scope.Recipes[rid]
		if _, ok := dspResolveRecipe(c, rid, r); !ok {
			missing = append(missing, fmt.Sprintf("%s(%s)", rid, r.Zh))
		}
	}
	if len(missing) > 0 {
		t.Errorf("recipes missing from recipe catalog: %v", missing)
	}
}

// TestDSPTechCoverage 守住：researchable 科技节点（家族聚合后）全部存在，
// 且其 DSP 前置链与解析出的 SW 科技自身 Prerequisites 均不悬空。
func TestDSPTechCoverage(t *testing.T) {
	c := dspLoadCatalog(t)
	targets := dspResearchableTechs(c)
	if len(targets) != 270 {
		t.Errorf("researchable tech node count = %d, want frozen 270", len(targets))
	}
	var missing, dangling []string
	resolved := map[string]string{}
	for _, tid := range targets {
		if dspPolicyExcludedTechs[tid] {
			continue
		}
		sw, ok := dspResolveTech(c, tid)
		if !ok {
			missing = append(missing, tid)
			continue
		}
		resolved[tid] = sw
	}
	if len(missing) > 0 {
		t.Errorf("researchable techs with no SW counterpart: %v", missing)
	}
	// DSP 前置链：researchable 节点的 prereq 必须可解析（scope.techs 之外的节点无前置数据，跳过）。
	for _, tid := range targets {
		node, ok := c.scope.Techs[tid]
		if !ok {
			continue
		}
		for _, p := range node.Prereq {
			if dspPolicyExcludedTechs[p] {
				continue
			}
			if _, ok := dspResolveTech(c, p); !ok {
				dangling = append(dangling, fmt.Sprintf("%s requires %s", tid, p))
			}
		}
	}
	// SW 侧完整性：解析到的科技自身 Prerequisites 必须指向已定义科技。
	checked := map[string]bool{}
	for _, sw := range resolved {
		if checked[sw] {
			continue
		}
		checked[sw] = true
		def, ok := TechDefinitionByID(sw)
		if !ok {
			continue
		}
		for _, p := range def.Prerequisites {
			if _, ok := TechDefinitionByID(p); !ok {
				dangling = append(dangling, fmt.Sprintf("sw tech %s requires undefined %s", sw, p))
			}
		}
	}
	if len(dangling) > 0 {
		t.Errorf("dangling tech prerequisites: %v", dangling)
	}
}

// TestDSPInPlanetClosure 纯数据闭包推演：从 18 种子资源出发按配方目录扩张，
// 断言全部行星内物品（政策 gated 除外）都可达。
func TestDSPInPlanetClosure(t *testing.T) {
	c := dspLoadCatalog(t)
	seeds := make(map[string]bool)
	for _, rid := range c.scope.Resources {
		swid, ok := c.resMap[rid]
		if !ok || swid == "" {
			t.Fatalf("seed resource %s has no mapping", rid)
		}
		seeds[swid] = true
	}
	if len(seeds) != 18 {
		t.Fatalf("seed set size = %d, want 18", len(seeds))
	}

	reached := map[string]bool{}
	for s := range seeds {
		reached[s] = true
	}
	recipes := AllRecipes()
	for changed := true; changed; {
		changed = false
		for _, r := range recipes {
			ready := true
			for _, in := range r.Inputs {
				if !reached[in.ItemID] {
					ready = false
					break
				}
			}
			if !ready {
				continue
			}
			for _, out := range r.AllOutputs() {
				if !reached[out.ItemID] {
					reached[out.ItemID] = true
					changed = true
				}
			}
		}
	}

	var unreached []string
	for _, did := range dspInPlanetComponentItems(c) {
		swid, ok := c.itemMap[did]
		if !ok || swid == "" {
			t.Errorf("in-planet item %s has no mapping", did)
			continue
		}
		if dspClosureGatedItems[swid] {
			continue
		}
		if !reached[swid] {
			unreached = append(unreached, fmt.Sprintf("%s->%s", did, swid))
		}
	}
	if len(unreached) > 0 {
		t.Errorf("in-planet items not reachable from seeds via recipe catalog: %v", unreached)
	}
}
