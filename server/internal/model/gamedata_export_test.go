package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"testing"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

// F8 一次性导出器：把 Go 字面量定义导出为 server/data/*.yaml，并校验加载结果与原定义完全一致。
// 运行：EXPORT_GAMEDATA=1 go test ./internal/model -run TestExportGameData

const exportDataDir = "../../data"

func exportSourceOrder(t *testing.T, file string, keyRe *regexp.Regexp, resolve func(string) string) []string {
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, m := range keyRe.FindAllStringSubmatch(string(raw), -1) {
		out = append(out, resolve(m[1]))
	}
	return out
}

func buildExportGameData(t *testing.T) *GameData {
	t.Helper()
	gd := &GameData{}

	// items：按 item.go 源码顺序。
	raw, _ := os.ReadFile("item.go")
	constVal := map[string]string{}
	for _, m := range regexp.MustCompile(`(?m)^\t(Item\w+)\s*=\s*"([^"]+)"`).FindAllStringSubmatch(string(raw), -1) {
		constVal[m[1]] = m[2]
	}
	itemOrder := exportSourceOrder(t, "item.go", regexp.MustCompile(`(?m)^\t(Item\w+):\s+\{`), func(s string) string { return constVal[s] })
	if len(itemOrder) != len(itemCatalog) {
		t.Fatalf("item order %d != catalog %d", len(itemOrder), len(itemCatalog))
	}
	for _, id := range itemOrder {
		def, ok := itemCatalog[id]
		if !ok {
			t.Fatalf("item %s missing", id)
		}
		gd.Items.Items = append(gd.Items.Items, def)
	}
	gd.Items.FormContainers = map[ResourceForm]string{}
	for k, v := range containerByForm {
		gd.Items.FormContainers[k] = v
	}

	recipeOrder := exportSourceOrder(t, "recipe.go", regexp.MustCompile(`(?m)^\t"([^"]+)": \{`), func(s string) string { return s })
	if len(recipeOrder) != len(recipeCatalog) {
		t.Fatalf("recipe order %d != catalog %d", len(recipeOrder), len(recipeCatalog))
	}
	for _, id := range recipeOrder {
		gd.Recipes.Recipes = append(gd.Recipes.Recipes, recipeCatalog[id])
	}

	gd.Techs.PendingRecipeUnlocks = map[string]string{}
	for k, v := range pendingRecipeUnlocks {
		gd.Techs.PendingRecipeUnlocks[k] = v
	}
	gd.Techs.Techs = append([]TechDefinition(nil), defaultTechDefinitions...)

	runtimeByID := map[BuildingType]BuildingRuntimeDefinition{}
	for _, rt := range defaultBuildingRuntimeDefinitions {
		runtimeByID[rt.ID] = rt
	}
	for _, raw := range defaultBuildingDefinitions {
		def := normalizeBuildableCost(raw)
		def.UnlockTech = nil
		p1 := BuildingProfileFor(def.ID, 1)
		p2 := BuildingProfileFor(def.ID, 2)
		spec := BuildingProfileSpec{
			MaxHPPerLevel: p2.MaxHP - p1.MaxHP,
			VisionRange:   p1.VisionRange,
		}
		spec.MaxHPBase = p1.MaxHP - spec.MaxHPPerLevel
		if c1, c2 := p1.Runtime.Functions.Collect, p2.Runtime.Functions.Collect; c1 != nil {
			spec.LevelBonus.CollectYield = c2.YieldPerTick - c1.YieldPerTick
		}
		if e1, e2 := p1.Runtime.Functions.Energy, p2.Runtime.Functions.Energy; e1 != nil {
			spec.LevelBonus.EnergyOutput = e2.OutputPerTick - e1.OutputPerTick
		}
		if c1, c2 := p1.Runtime.Functions.Combat, p2.Runtime.Functions.Combat; c1 != nil {
			spec.LevelBonus.CombatAttack = c2.Attack - c1.Attack
			spec.LevelBonus.CombatRange = c2.Range - c1.Range
			spec.WeaponClass = WeaponClassForBuilding(def.ID)
		}
		def.Profile = spec
		entry := BuildingSpec{BuildingDefinition: def}
		if rt, ok := runtimeByID[def.ID]; ok {
			rt.ID = ""
			if rt.Params.Footprint == def.Footprint {
				rt.Params.Footprint = Footprint{}
			}
			entry.Runtime = &rt
		}
		gd.Buildings.Buildings = append(gd.Buildings.Buildings, entry)
	}

	catalogByID := map[string]WorldUnitCatalogEntry{}
	for _, e := range worldUnitCatalogEntries {
		catalogByID[e.ID] = e
	}
	names := map[UnitType]string{UnitTypeExecutor: "Executor", UnitTypeDarkFog: "Dark Fog"}
	for _, ut := range []UnitType{UnitTypeWorker, UnitTypeSoldier, UnitTypeMecha, UnitTypeExecutor, UnitTypeDarkFog} {
		s := UnitStats(ut)
		m, e := UnitCost(ut)
		def := UnitDefinition{
			ID: ut, Name: names[ut],
			MaxHP: s.MaxHP, Attack: s.Attack, Defense: s.Defense, AttackRange: s.AttackRange,
			MoveRange: s.MoveRange, VisionRange: s.VisionRange, MoveSpeed: s.MoveSpeed,
			AttackCooldownTicks: s.AttackCooldownTick, ArmorClass: s.ArmorClass, WeaponClass: s.WeaponClass,
			Cost: UnitProductionCost{Minerals: m, Energy: e},
		}
		if c, ok := catalogByID[string(ut)]; ok {
			def.Name = c.Name
			def.Public = c.Public
			def.Domain = c.Domain
			def.RuntimeClass = c.RuntimeClass
			def.ProductionMode = c.ProductionMode
			def.QueryScopes = c.QueryScopes
			def.Commands = c.Commands
			def.HiddenReason = c.HiddenReason
		}
		gd.Units.Units = append(gd.Units.Units, def)
	}
	for id := range runtimeSupportedUnitUnlocks() {
		gd.Units.LogisticsUnits = append(gd.Units.LogisticsUnits, id)
	}
	sort.Strings(gd.Units.LogisticsUnits)

	gd.Combat.DamageCoefficients = DamageCoefficient

	gd.War.BaseFrames = warBaseFrameEntries
	gd.War.BaseHulls = warBaseHullEntries
	gd.War.Components = warComponentEntries
	for _, bp := range warPublicBlueprintEntries {
		gd.War.PublicBlueprints = append(gd.War.PublicBlueprints, WarBlueprintSpec{
			WarPublicBlueprintCatalogEntry: bp,
			Runtime:                        warBlueprintRuntimeProfiles[bp.ID],
		})
	}
	if len(warBlueprintRuntimeProfiles) != len(warPublicBlueprintEntries) {
		t.Fatalf("runtime profiles without public blueprint")
	}
	return gd
}

// exportCompact 把只含标量的小映射/序列改为行内风格；顶层列表的条目保持块风格。
func exportCompact(n *yaml.Node, depth int) {
	for _, c := range n.Content {
		exportCompact(c, depth+1)
	}
	if n.Kind != yaml.MappingNode && n.Kind != yaml.SequenceNode {
		return
	}
	// depth: 0 document, 1 root mapping, 2 top-level value (list), 3 list entry.
	if depth <= 3 {
		return
	}
	length := 2
	for _, c := range n.Content {
		switch {
		case c.Kind == yaml.ScalarNode:
			length += utf8.RuneCountInString(c.Value) + 2
		case c.Style == yaml.FlowStyle:
			length += c.Line // 已压缩子节点长度记在 Line 上
		default:
			return
		}
	}
	if length > 110 {
		return
	}
	n.Style = yaml.FlowStyle
	n.Line = length
}

func exportYAML(t *testing.T, file, header string, v any) {
	t.Helper()
	var node yaml.Node
	if err := node.Encode(v); err != nil {
		t.Fatal(err)
	}
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{&node}}
	exportCompact(doc, 0)
	var buf bytes.Buffer
	buf.WriteString(header)
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&node); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(exportDataDir, file), buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestExportGameData(t *testing.T) {
	if os.Getenv("EXPORT_GAMEDATA") == "" {
		t.Skip("set EXPORT_GAMEDATA=1")
	}
	gd := buildExportGameData(t)
	const doc = "# 格式说明见 docs/dev/数据配置文件.md\n"
	if err := os.MkdirAll(exportDataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	exportYAML(t, GameDataItemsFile, "# 物品/资源定义。\n"+doc, gd.Items)
	exportYAML(t, GameDataRecipesFile, "# 配方定义。\n"+doc, gd.Recipes)
	exportYAML(t, GameDataTechsFile, "# 科技树定义。\n"+doc, gd.Techs)
	exportYAML(t, GameDataBuildingsFile, "# 建筑定义（基础属性 + 运行时参数）。\n"+doc, gd.Buildings)
	exportYAML(t, GameDataUnitsFile, "# 世界单位定义（含黑雾、执行体）。\n"+doc, gd.Units)
	exportYAML(t, GameDataCombatFile, "# 战斗系数表。\n"+doc, gd.Combat)
	exportYAML(t, GameDataWarFile, "# 战争蓝图：底盘、舰体、组件与公开蓝图。\n"+doc, gd.War)

	loaded, err := LoadGameData(os.DirFS(exportDataDir))
	if err != nil {
		t.Fatalf("load exported data: %v", err)
	}
	checkEq := func(name string, a, b any) {
		if !reflect.DeepEqual(a, b) {
			t.Errorf("%s: loaded data differs from Go definitions", name)
		}
	}
	checkEq("items", loaded.Items, gd.Items)
	checkEq("recipes", loaded.Recipes, gd.Recipes)
	checkEq("techs", loaded.Techs, gd.Techs)
	checkEq("buildings", loaded.Buildings, gd.Buildings)
	checkEq("units", loaded.Units, gd.Units)
	checkEq("combat", loaded.Combat, gd.Combat)
	checkEq("war", loaded.War, gd.War)
	if t.Failed() {
		for i := range gd.Techs.Techs {
			if !reflect.DeepEqual(gd.Techs.Techs[i], loaded.Techs.Techs[i]) {
				t.Logf("tech %d: %#v\n vs %#v", i, gd.Techs.Techs[i], loaded.Techs.Techs[i])
				break
			}
		}
		for i := range gd.Buildings.Buildings {
			if !reflect.DeepEqual(gd.Buildings.Buildings[i], loaded.Buildings.Buildings[i]) {
				t.Logf("building %d: %#v\n vs %#v", i, gd.Buildings.Buildings[i], loaded.Buildings.Buildings[i])
				break
			}
		}
		for i := range gd.Recipes.Recipes {
			if !reflect.DeepEqual(gd.Recipes.Recipes[i], loaded.Recipes.Recipes[i]) {
				t.Logf("recipe %d: %#v\n vs %#v", i, gd.Recipes.Recipes[i], loaded.Recipes.Recipes[i])
				break
			}
		}
	}

	// 行为等价：新的计算函数作用于加载数据，必须与旧函数逐级一致。
	for _, b := range loaded.Buildings.Buildings {
		rt := BuildingRuntimeDefinition{ID: b.ID, Params: BuildingRuntimeParams{Footprint: b.Footprint}}
		if b.Runtime != nil {
			rt = *b.Runtime
			rt.ID = b.ID
			if rt.Params.Footprint == (Footprint{}) {
				rt.Params.Footprint = b.Footprint
			}
		}
		old, _ := BuildingRuntimeDefinitionByID(b.ID)
		checkEq("runtime "+string(b.ID), rt, old)
		for lv := 1; lv <= 8; lv++ {
			checkEq("profile "+string(b.ID), buildingProfileFromSpec(b.Profile, rt, lv), BuildingProfileFor(b.ID, lv))
		}
		if b.Runtime != nil && b.Runtime.Functions.Combat != nil {
			checkEq("weapon "+string(b.ID), b.Profile.WeaponClass, WeaponClassForBuilding(b.ID))
		}
	}
	for _, u := range loaded.Units.Units {
		checkEq("unit stats "+string(u.ID), unitStatsFromDefinition(u), UnitStats(u.ID))
		m, e := UnitCost(u.ID)
		checkEq("unit cost "+string(u.ID), u.Cost, UnitProductionCost{Minerals: m, Energy: e})
		if old, ok := PublicWorldUnitByID(string(u.ID)); ok {
			checkEq("unit catalog "+string(u.ID), worldUnitCatalogEntryFromDefinition(u), old)
		} else if u.Public {
			t.Errorf("unit %s should not be public", u.ID)
		}
	}
}
