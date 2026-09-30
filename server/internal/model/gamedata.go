package model

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"

	"gopkg.in/yaml.v3"

	"siliconworld/data"
)

// 游戏数据文件（默认内置于 server/data/，格式见 docs/dev/数据配置文件.md）。
const (
	GameDataItemsFile     = "items.yaml"
	GameDataRecipesFile   = "recipes.yaml"
	GameDataTechsFile     = "techs.yaml"
	GameDataBuildingsFile = "buildings.yaml"
	GameDataUnitsFile     = "units.yaml"
	GameDataCombatFile    = "combat.yaml"
	GameDataWarFile       = "war.yaml"
)

// ItemsFile 对应 items.yaml。
type ItemsFile struct {
	// FormContainers 流体形态 -> 装载它的容器物品。
	FormContainers map[ResourceForm]string `yaml:"form_containers,omitempty"`
	Items          []ItemDefinition        `yaml:"items"`
}

// RecipesFile 对应 recipes.yaml。
type RecipesFile struct {
	Recipes []RecipeDefinition `yaml:"recipes"`
}

// TechsFile 对应 techs.yaml。
type TechsFile struct {
	// PendingRecipeUnlocks 科技树里故意保留、但配方尚未落地的 recipe 解锁：id -> 说明。
	// 加载时从科技解锁中剔除；配方落地后必须从这里删掉（校验会强制）。
	PendingRecipeUnlocks map[string]string `yaml:"pending_recipe_unlocks,omitempty"`
	Techs                []TechDefinition  `yaml:"techs"`
}

// BuildingSpec 是 buildings.yaml 的一个条目：建筑定义 + 可选运行时参数。
type BuildingSpec struct {
	BuildingDefinition `yaml:",inline"`
	Runtime            *BuildingRuntimeDefinition `yaml:"runtime,omitempty"`
}

// BuildingsFile 对应 buildings.yaml。
type BuildingsFile struct {
	Buildings []BuildingSpec `yaml:"buildings"`
}

// UnitsFile 对应 units.yaml。
type UnitsFile struct {
	Units []UnitDefinition `yaml:"units"`
	// LogisticsUnits 物流单位（由物流站运行时管理、无战斗数值），可作为科技 unit 解锁目标。
	LogisticsUnits []string `yaml:"logistics_units,omitempty"`
}

// CombatFile 对应 combat.yaml。
type CombatFile struct {
	Ammunition []AmmunitionDefinition `yaml:"ammunition"`
	// DamageCoefficients 武器类 -> 护甲类 -> 伤害系数，缺省 1.0。
	DamageCoefficients map[WeaponType]map[ArmorClass]float64 `yaml:"damage_coefficients"`
}

// WarBlueprintSpec 是 war.yaml public_blueprints 的一个条目：公开蓝图 + 运行时战斗档案。
type WarBlueprintSpec struct {
	WarPublicBlueprintCatalogEntry `yaml:",inline"`
	Runtime                        WarBlueprintRuntimeProfile `yaml:"runtime,omitempty"`
}

// WarFile 对应 war.yaml。
type WarFile struct {
	BaseFrames       []WarBaseFrameCatalogEntry `yaml:"base_frames"`
	BaseHulls        []WarBaseHullCatalogEntry  `yaml:"base_hulls"`
	Components       []WarComponentCatalogEntry `yaml:"components"`
	PublicBlueprints []WarBlueprintSpec         `yaml:"public_blueprints"`
}

// GameData 一整套游戏数据。
type GameData struct {
	Items     ItemsFile
	Recipes   RecipesFile
	Techs     TechsFile
	Buildings BuildingsFile
	Units     UnitsFile
	Combat    CombatFile
	War       WarFile
}

// LoadGameData 从 fsys 读取全部数据文件并做完整校验（含跨文件引用）。
func LoadGameData(fsys fs.FS) (*GameData, error) {
	gd := &GameData{}
	files := []struct {
		name string
		out  any
	}{
		{GameDataItemsFile, &gd.Items},
		{GameDataRecipesFile, &gd.Recipes},
		{GameDataTechsFile, &gd.Techs},
		{GameDataBuildingsFile, &gd.Buildings},
		{GameDataUnitsFile, &gd.Units},
		{GameDataCombatFile, &gd.Combat},
		{GameDataWarFile, &gd.War},
	}
	for _, f := range files {
		raw, err := fs.ReadFile(fsys, f.name)
		if err != nil {
			return nil, fmt.Errorf("game data: read %s: %w", f.name, err)
		}
		dec := yaml.NewDecoder(bytes.NewReader(raw))
		dec.KnownFields(true)
		if err := dec.Decode(f.out); err != nil {
			return nil, fmt.Errorf("game data: parse %s: %w", f.name, err)
		}
		var extra any
		if err := dec.Decode(&extra); err != io.EOF {
			return nil, fmt.Errorf("game data: %s must contain exactly one YAML document", f.name)
		}
	}
	if err := gd.Validate(); err != nil {
		return nil, err
	}
	return gd, nil
}

// LoadGameDataDir 从目录加载游戏数据（config.yaml 的 game_data_dir）。
func LoadGameDataDir(dir string) (*GameData, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("game data dir %s: %w", dir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("game data dir %s is not a directory", dir)
	}
	return LoadGameData(os.DirFS(dir))
}

// knownSpecialUnlocks 代码里有对应逻辑的 special 解锁 ID。
var knownSpecialUnlocks = map[string]struct{}{
	"dyson_component":        {},
	"satellite_power":        {},
	"vertical_construction":  {},
	"dyson_stress":           {},
	"ionosphere_utilization": {},
	"photon_mode":            {},
	"warp_drive":             {},
	"game_win":               {},
	// 战争蓝图由 war.yaml 的 visible_tech_id 门控，这里仅让科技在面板上保持可见。
	"blueprint_prototype": {},
	"blueprint_corvette":  {},
	"blueprint_destroyer": {},
}

func isItemCategory(c ItemCategory) bool {
	switch c {
	case ItemCategoryOre, ItemCategoryMaterial, ItemCategoryComponent, ItemCategoryFuel,
		ItemCategoryMatrix, ItemCategoryAmmo, ItemCategoryContainer:
		return true
	}
	return false
}

func isResourceForm(f ResourceForm) bool {
	return f == ResourceSolid || f == ResourceLiquid || f == ResourceGas
}

func isTechCategory(c TechCategory) bool {
	return c == TechCategoryMain || c == TechCategoryBranch || c == TechCategoryBonus
}

func isTechType(t TechType) bool {
	switch t {
	case TechTypeMain, TechTypeEnergy, TechTypeLogistics, TechTypeSmelting,
		TechTypeChemical, TechTypeCombat, TechTypeMecha, TechTypeDyson:
		return true
	}
	return false
}

// IsWeaponType 报告武器类型是否合法。
func IsWeaponType(w WeaponType) bool {
	switch w {
	case WeaponTypeGun, WeaponTypeCannon, WeaponTypeMissile, WeaponTypeLaser:
		return true
	}
	return false
}

// IsArmorClass 报告护甲类型是否合法。
func IsArmorClass(a ArmorClass) bool {
	switch a {
	case ArmorLight, ArmorHeavy, ArmorStructure, ArmorAir, ArmorShip:
		return true
	}
	return false
}

func isUnitDomain(d UnitDomain) bool {
	switch d {
	case UnitDomainGround, UnitDomainAir, UnitDomainOrbital, UnitDomainSpace:
		return true
	}
	return false
}

func isUnitRuntimeClass(c UnitRuntimeClass) bool {
	return c == UnitRuntimeClassWorld || c == UnitRuntimeClassCombatSquad || c == UnitRuntimeClassFleet
}

func isUnitProductionMode(m UnitProductionMode) bool {
	return m == UnitProductionModeWorldProduce || m == UnitProductionModeFactoryRecipe || m == UnitProductionModeInternal
}

func isWarComponentCategory(c WarComponentCategory) bool {
	switch c {
	case WarComponentCategoryPower, WarComponentCategoryPropulsion, WarComponentCategoryDefense,
		WarComponentCategorySensor, WarComponentCategoryWeapon, WarComponentCategoryUtility:
		return true
	}
	return false
}

// dataErrors 收集全部校验错误，一次报完。
type dataErrors struct {
	errs []error
}

func (e *dataErrors) addf(file, format string, args ...any) {
	e.errs = append(e.errs, fmt.Errorf("%s: %s", file, fmt.Sprintf(format, args...)))
}

func (e *dataErrors) err() error {
	if len(e.errs) == 0 {
		return nil
	}
	return fmt.Errorf("game data invalid (%d errors):\n%w", len(e.errs), errors.Join(e.errs...))
}

// Validate 校验字段取值与跨文件引用。
func (gd *GameData) Validate() error {
	errs := &dataErrors{}

	items := make(map[string]ItemDefinition, len(gd.Items.Items))
	for _, it := range gd.Items.Items {
		if it.ID == "" {
			errs.addf(GameDataItemsFile, "item with empty id")
			continue
		}
		if _, dup := items[it.ID]; dup {
			errs.addf(GameDataItemsFile, "duplicate item %q", it.ID)
		}
		items[it.ID] = it
	}
	hasItem := func(id string) bool { _, ok := items[id]; return ok }
	checkAmounts := func(file, owner string, amounts []ItemAmount) {
		for _, a := range amounts {
			if !hasItem(a.ItemID) {
				errs.addf(file, "%s references unknown item %q", owner, a.ItemID)
			}
			if a.Quantity <= 0 {
				errs.addf(file, "%s item %q has non-positive quantity %d", owner, a.ItemID, a.Quantity)
			}
		}
	}

	for _, it := range gd.Items.Items {
		if it.Name == "" {
			errs.addf(GameDataItemsFile, "item %s missing name", it.ID)
		}
		if !isItemCategory(it.Category) {
			errs.addf(GameDataItemsFile, "item %s has invalid category %q", it.ID, it.Category)
		}
		if !isResourceForm(it.Form) {
			errs.addf(GameDataItemsFile, "item %s has invalid form %q", it.ID, it.Form)
		}
		if it.StackLimit <= 0 || it.UnitVolume <= 0 {
			errs.addf(GameDataItemsFile, "item %s needs positive stack_limit and unit_volume", it.ID)
		}
		if it.ContainerID != "" && !hasItem(it.ContainerID) {
			errs.addf(GameDataItemsFile, "item %s container %q not found", it.ID, it.ContainerID)
		}
	}
	for form, container := range gd.Items.FormContainers {
		if form != ResourceLiquid && form != ResourceGas {
			errs.addf(GameDataItemsFile, "form_containers has non-fluid form %q", form)
		}
		if !hasItem(container) {
			errs.addf(GameDataItemsFile, "form_containers %s -> unknown item %q", form, container)
		}
	}

	// 科技 ID 先收集，配方的 tech_unlock 要用。
	techIDs := make(map[string]struct{}, len(gd.Techs.Techs))
	for _, t := range gd.Techs.Techs {
		if t.ID == "" {
			errs.addf(GameDataTechsFile, "tech with empty id")
			continue
		}
		if _, dup := techIDs[t.ID]; dup {
			errs.addf(GameDataTechsFile, "duplicate tech %q", t.ID)
		}
		techIDs[t.ID] = struct{}{}
	}
	hasTech := func(id string) bool { _, ok := techIDs[id]; return ok }

	buildingIDs := make(map[BuildingType]struct{}, len(gd.Buildings.Buildings))
	for _, b := range gd.Buildings.Buildings {
		if _, dup := buildingIDs[b.ID]; dup {
			errs.addf(GameDataBuildingsFile, "duplicate building %q", b.ID)
		}
		buildingIDs[b.ID] = struct{}{}
	}

	recipes := make(map[string]RecipeDefinition, len(gd.Recipes.Recipes))
	for _, r := range gd.Recipes.Recipes {
		owner := "recipe " + r.ID
		if r.ID == "" {
			errs.addf(GameDataRecipesFile, "recipe with empty id")
			continue
		}
		if _, dup := recipes[r.ID]; dup {
			errs.addf(GameDataRecipesFile, "duplicate recipe %q", r.ID)
		}
		recipes[r.ID] = r
		if r.Name == "" {
			errs.addf(GameDataRecipesFile, "%s missing name", owner)
		}
		if len(r.Outputs) == 0 {
			errs.addf(GameDataRecipesFile, "%s has no outputs", owner)
		}
		if r.Duration <= 0 || r.EnergyCost < 0 {
			errs.addf(GameDataRecipesFile, "%s needs positive duration and non-negative energy_cost", owner)
		}
		checkAmounts(GameDataRecipesFile, owner, r.Inputs)
		checkAmounts(GameDataRecipesFile, owner, r.Outputs)
		checkAmounts(GameDataRecipesFile, owner, r.Byproducts)
		for _, bt := range r.BuildingTypes {
			if _, ok := buildingIDs[bt]; !ok {
				errs.addf(GameDataRecipesFile, "%s references unknown building %q", owner, bt)
			}
		}
		for _, techID := range r.TechUnlock {
			if !hasTech(techID) {
				errs.addf(GameDataRecipesFile, "%s tech_unlock references unknown tech %q", owner, techID)
			}
		}
	}

	unitIDs := make(map[string]struct{}, len(gd.Units.Units)+len(gd.Units.LogisticsUnits))
	for _, u := range gd.Units.Units {
		owner := "unit " + string(u.ID)
		if u.ID == "" {
			errs.addf(GameDataUnitsFile, "unit with empty id")
			continue
		}
		if _, dup := unitIDs[string(u.ID)]; dup {
			errs.addf(GameDataUnitsFile, "duplicate unit %q", u.ID)
		}
		unitIDs[string(u.ID)] = struct{}{}
		if u.Name == "" {
			errs.addf(GameDataUnitsFile, "%s missing name", owner)
		}
		if u.MaxHP <= 0 || u.MoveSpeed < 0 || u.AttackCooldownTicks < 0 {
			errs.addf(GameDataUnitsFile, "%s needs positive max_hp and non-negative move_speed/attack_cooldown_ticks", owner)
		}
		if !IsArmorClass(u.ArmorClass) {
			errs.addf(GameDataUnitsFile, "%s has invalid armor_class %q", owner, u.ArmorClass)
		}
		if !IsWeaponType(u.WeaponClass) {
			errs.addf(GameDataUnitsFile, "%s has invalid weapon_class %q", owner, u.WeaponClass)
		}
		checkAmounts(GameDataUnitsFile, owner, u.Cost)
		if u.AmmoCapacity < 0 || u.MinAttackRange < 0 || u.MinAttackRange > u.AttackRange || u.SupplyRadius < 0 || u.SupplyRate < 0 || u.CargoCapacity < 0 {
			errs.addf(GameDataUnitsFile, "%s invalid combat or supply capacity", owner)
		}
		if u.AmmoClass != "" {
			found := false
			for _, a := range gd.Combat.Ammunition {
				if a.Class == u.AmmoClass {
					found = true
				}
			}
			if !found || u.AmmoCapacity <= 0 {
				errs.addf(GameDataUnitsFile, "%s invalid ammunition class/capacity", owner)
			}
		}
		if u.UnlockTech != "" && !hasTech(u.UnlockTech) {
			errs.addf(GameDataUnitsFile, "%s unknown unlock tech %s", owner, u.UnlockTech)
		}
		if u.Public && u.ProductionMode == UnitProductionModeWorldProduce {
			if _, ok := buildingIDs[u.Producer]; !ok || u.ProductionTicks <= 0 || len(u.Cost) == 0 {
				errs.addf(GameDataUnitsFile, "%s needs a producer, material cost and positive production_ticks", owner)
			}
		}
		if u.Public {
			if !isUnitDomain(u.Domain) || !isUnitRuntimeClass(u.RuntimeClass) || !isUnitProductionMode(u.ProductionMode) {
				errs.addf(GameDataUnitsFile, "%s is public but has invalid domain/runtime_class/production_mode", owner)
			}
		}
	}
	// 代码逻辑直接引用的单位类型必须有定义；执行体还要有 mecha 段。
	for _, required := range []UnitType{UnitTypeWorker, UnitTypeSoldier, UnitTypeMecha, UnitTypeExecutor, UnitTypeDarkFog} {
		if _, ok := unitIDs[string(required)]; !ok {
			errs.addf(GameDataUnitsFile, "required unit %q is missing", required)
		}
	}
	for _, u := range gd.Units.Units {
		if u.Mecha != nil && (u.Mecha.MaxEnergy <= 0 || u.Mecha.InventoryCapacity <= 0 || u.Mecha.RespawnTicks <= 0) {
			errs.addf(GameDataUnitsFile, "unit %s mecha needs positive max_energy and inventory_capacity", u.ID)
		}
		if u.ID == UnitTypeExecutor && u.Mecha == nil {
			errs.addf(GameDataUnitsFile, "unit executor must define mecha")
		}
	}
	for _, id := range gd.Units.LogisticsUnits {
		if _, dup := unitIDs[id]; dup {
			errs.addf(GameDataUnitsFile, "duplicate unit %q", id)
		}
		unitIDs[id] = struct{}{}
	}

	referencedRecipes := make(map[string]bool)
	for _, t := range gd.Techs.Techs {
		owner := "tech " + t.ID
		if t.Name == "" {
			errs.addf(GameDataTechsFile, "%s missing name", owner)
		}
		if !isTechCategory(t.Category) {
			errs.addf(GameDataTechsFile, "%s has invalid category %q", owner, t.Category)
		}
		if !isTechType(t.Type) {
			errs.addf(GameDataTechsFile, "%s has invalid type %q", owner, t.Type)
		}
		for _, prereq := range t.Prerequisites {
			if !hasTech(prereq) {
				errs.addf(GameDataTechsFile, "%s prerequisite %q not found", owner, prereq)
			}
		}
		checkAmounts(GameDataTechsFile, owner, t.Cost)
		for level, cost := range t.CostPerLevel {
			if level <= 0 {
				errs.addf(GameDataTechsFile, "%s cost_per_level has non-positive level %d", owner, level)
			}
			checkAmounts(GameDataTechsFile, fmt.Sprintf("%s level %d", owner, level), cost)
		}
		for _, unlock := range t.Unlocks {
			switch unlock.Type {
			case TechUnlockBuilding:
				if _, ok := buildingIDs[BuildingType(unlock.ID)]; !ok {
					errs.addf(GameDataTechsFile, "%s unlocks unknown building %q", owner, unlock.ID)
				}
			case TechUnlockRecipe:
				referencedRecipes[unlock.ID] = true
				if _, ok := recipes[unlock.ID]; ok {
					continue
				}
				if _, pending := gd.Techs.PendingRecipeUnlocks[unlock.ID]; !pending {
					errs.addf(GameDataTechsFile, "%s unlocks unknown recipe %q (add the recipe or list it in pending_recipe_unlocks)", owner, unlock.ID)
				}
			case TechUnlockUnit:
				if _, ok := unitIDs[unlock.ID]; !ok {
					errs.addf(GameDataTechsFile, "%s unlocks unknown unit %q", owner, unlock.ID)
				}
			case TechUnlockSpecial:
				if _, ok := knownSpecialUnlocks[unlock.ID]; !ok {
					errs.addf(GameDataTechsFile, "%s unlocks unknown special %q", owner, unlock.ID)
				}
			default:
				errs.addf(GameDataTechsFile, "%s has unlock with invalid type %q (%q)", owner, unlock.Type, unlock.ID)
			}
		}
	}
	for id := range gd.Techs.PendingRecipeUnlocks {
		if _, ok := recipes[id]; ok {
			errs.addf(GameDataTechsFile, "pending recipe unlock %q already exists in recipes.yaml; remove it from pending_recipe_unlocks", id)
		}
		if !referencedRecipes[id] {
			errs.addf(GameDataTechsFile, "pending recipe unlock %q is not referenced by any tech; remove it", id)
		}
	}

	blueprintIDs := make(map[string]struct{}, len(gd.War.PublicBlueprints))
	for _, bp := range gd.War.PublicBlueprints {
		blueprintIDs[bp.ID] = struct{}{}
	}

	recipeByID := func(id string) (RecipeDefinition, bool) { r, ok := recipes[id]; return r, ok }
	for _, b := range gd.Buildings.Buildings {
		owner := "building " + string(b.ID)
		if err := validateBuildingDefinition(b.BuildingDefinition, recipeByID); err != nil {
			errs.addf(GameDataBuildingsFile, "%v", err)
		}
		checkAmounts(GameDataBuildingsFile, owner+" build_cost", b.BuildCost.Items)
		p := b.Profile
		if p.MaxHPBase+p.MaxHPPerLevel <= 0 || p.MaxHPPerLevel < 0 || p.VisionRange < 0 {
			errs.addf(GameDataBuildingsFile, "%s profile needs positive max hp and non-negative vision_range", owner)
		}
		if p.WeaponClass != "" && !IsWeaponType(p.WeaponClass) {
			errs.addf(GameDataBuildingsFile, "%s profile has invalid weapon_class %q", owner, p.WeaponClass)
		}
		if b.Runtime == nil {
			continue
		}
		rt := runtimeDefinitionFromSpec(b)
		if err := validateBuildingRuntimeDefinition(rt, b.BuildingDefinition, hasItem); err != nil {
			errs.addf(GameDataBuildingsFile, "%v", err)
		}
		if rt.Functions.Combat != nil && p.WeaponClass == "" {
			errs.addf(GameDataBuildingsFile, "%s has combat module but profile.weapon_class is empty", owner)
		}
		if dep := rt.Functions.Deployment; dep != nil {
			for _, bpID := range dep.AllowedBlueprints {
				if _, ok := blueprintIDs[bpID]; !ok {
					errs.addf(GameDataBuildingsFile, "%s deployment allows unknown blueprint %q", owner, bpID)
				}
			}
		}
	}

	seenAmmo := map[string]bool{}
	for _, a := range gd.Combat.Ammunition {
		if !hasItem(a.ItemID) || seenAmmo[a.ItemID] || a.Tier <= 0 || a.DamageMultiplier < 1 || (a.Class != "bullet" && a.Class != "shell" && a.Class != "missile") {
			errs.addf(GameDataCombatFile, "invalid ammunition %s", a.ItemID)
		}
		seenAmmo[a.ItemID] = true
	}
	for weapon, row := range gd.Combat.DamageCoefficients {
		if !IsWeaponType(weapon) {
			errs.addf(GameDataCombatFile, "damage_coefficients has invalid weapon class %q", weapon)
		}
		for armor, coef := range row {
			if !IsArmorClass(armor) {
				errs.addf(GameDataCombatFile, "damage_coefficients.%s has invalid armor class %q", weapon, armor)
			}
			if coef <= 0 {
				errs.addf(GameDataCombatFile, "damage_coefficients.%s.%s must be positive", weapon, armor)
			}
		}
	}

	gd.validateWar(errs, hasTech)

	return errs.err()
}

func (gd *GameData) validateWar(errs *dataErrors, hasTech func(string) bool) {
	const file = GameDataWarFile
	checkDomains := func(owner string, domains []UnitDomain) {
		for _, d := range domains {
			if !isUnitDomain(d) {
				errs.addf(file, "%s has invalid domain %q", owner, d)
			}
		}
	}
	checkSlots := func(owner string, slots []WarSlotSpec) map[string]struct{} {
		ids := make(map[string]struct{}, len(slots))
		for _, slot := range slots {
			if _, dup := ids[slot.ID]; dup || slot.ID == "" {
				errs.addf(file, "%s has empty or duplicate slot %q", owner, slot.ID)
			}
			ids[slot.ID] = struct{}{}
			if !isWarComponentCategory(slot.Category) {
				errs.addf(file, "%s slot %s has invalid category %q", owner, slot.ID, slot.Category)
			}
		}
		return ids
	}
	checkVisibleTech := func(owner, techID string) {
		if techID != "" && !hasTech(techID) {
			errs.addf(file, "%s visible_tech_id %q not found", owner, techID)
		}
	}

	frameSlots := make(map[string]map[string]struct{})
	for _, f := range gd.War.BaseFrames {
		owner := "base frame " + f.ID
		if _, dup := frameSlots[f.ID]; dup || f.ID == "" {
			errs.addf(file, "empty or duplicate base frame %q", f.ID)
		}
		checkDomains(owner, f.SupportedDomains)
		checkVisibleTech(owner, f.VisibleTechID)
		frameSlots[f.ID] = checkSlots(owner, f.Slots)
	}
	hullSlots := make(map[string]map[string]struct{})
	for _, h := range gd.War.BaseHulls {
		owner := "base hull " + h.ID
		if _, dup := hullSlots[h.ID]; dup || h.ID == "" {
			errs.addf(file, "empty or duplicate base hull %q", h.ID)
		}
		checkDomains(owner, h.SupportedDomains)
		checkVisibleTech(owner, h.VisibleTechID)
		hullSlots[h.ID] = checkSlots(owner, h.Slots)
	}
	components := make(map[string]struct{}, len(gd.War.Components))
	for _, c := range gd.War.Components {
		owner := "component " + c.ID
		if _, dup := components[c.ID]; dup || c.ID == "" {
			errs.addf(file, "empty or duplicate component %q", c.ID)
		}
		components[c.ID] = struct{}{}
		if !isWarComponentCategory(c.Category) {
			errs.addf(file, "%s has invalid category %q", owner, c.Category)
		}
		checkDomains(owner, c.SupportedDomains)
	}
	seen := make(map[string]struct{}, len(gd.War.PublicBlueprints))
	for _, bp := range gd.War.PublicBlueprints {
		owner := "blueprint " + bp.ID
		if _, dup := seen[bp.ID]; dup || bp.ID == "" {
			errs.addf(file, "empty or duplicate blueprint %q", bp.ID)
		}
		seen[bp.ID] = struct{}{}
		if !isUnitDomain(bp.Domain) || !isUnitRuntimeClass(bp.RuntimeClass) || !isUnitProductionMode(bp.ProductionMode) {
			errs.addf(file, "%s has invalid domain/runtime_class/production_mode", owner)
		}
		checkVisibleTech(owner, bp.VisibleTechID)
		var slots map[string]struct{}
		switch {
		case bp.BaseFrameID != "" && bp.BaseHullID == "":
			if slots = frameSlots[bp.BaseFrameID]; slots == nil {
				errs.addf(file, "%s base_frame_id %q not found", owner, bp.BaseFrameID)
			}
		case bp.BaseHullID != "" && bp.BaseFrameID == "":
			if slots = hullSlots[bp.BaseHullID]; slots == nil {
				errs.addf(file, "%s base_hull_id %q not found", owner, bp.BaseHullID)
			}
		default:
			errs.addf(file, "%s needs exactly one of base_frame_id/base_hull_id", owner)
		}
		for _, slot := range bp.Components {
			if _, ok := components[slot.ComponentID]; !ok {
				errs.addf(file, "%s slot %s uses unknown component %q", owner, slot.SlotID, slot.ComponentID)
			}
			if slots != nil {
				if _, ok := slots[slot.SlotID]; !ok {
					errs.addf(file, "%s uses unknown slot %q", owner, slot.SlotID)
				}
			}
		}
		for _, stack := range []*WarStackRuntimeProfile{bp.Runtime.Squad, bp.Runtime.FleetUnit} {
			if stack == nil {
				continue
			}
			if stack.HP <= 0 || !IsWeaponType(stack.Weapon.Type) {
				errs.addf(file, "%s runtime profile needs positive hp and a valid weapon type", owner)
			}
		}
	}
}

// 已安装的游戏数据注册表。只在启动阶段（init / InstallGameData）写入，之后只读。
var (
	itemCatalog          map[string]ItemDefinition
	containerByForm      map[ResourceForm]string
	recipeCatalog        map[string]RecipeDefinition
	techDefinitions      []TechDefinition // techs.yaml 原样（未剔除 pending 解锁）
	pendingRecipeUnlocks map[string]string
	unitDefinitions      map[UnitType]UnitDefinition
	unitOrder            []UnitType
	damageCoefficients   map[WeaponType]map[ArmorClass]float64

	warBaseFrameEntries         []WarBaseFrameCatalogEntry
	warBaseHullEntries          []WarBaseHullCatalogEntry
	warComponentEntries         []WarComponentCatalogEntry
	warPublicBlueprintEntries   []WarPublicBlueprintCatalogEntry
	warBlueprintRuntimeProfiles map[string]WarBlueprintRuntimeProfile
)

func init() {
	gd, err := LoadGameData(data.FS)
	if err != nil {
		panic(fmt.Errorf("embedded game data: %w", err))
	}
	InstallGameData(gd)
}

// InstallGameData 用一套已通过 Validate 的数据替换全部注册表。
// 只应在对局开始前调用（启动时加载 game_data_dir）。
func InstallGameData(gd *GameData) {
	ammunitionCatalog = append([]AmmunitionDefinition(nil), gd.Combat.Ammunition...)
	itemCatalog = make(map[string]ItemDefinition, len(gd.Items.Items))
	for _, it := range gd.Items.Items {
		itemCatalog[it.ID] = it
	}
	containerByForm = make(map[ResourceForm]string, len(gd.Items.FormContainers))
	for form, id := range gd.Items.FormContainers {
		containerByForm[form] = id
	}

	recipeCatalog = make(map[string]RecipeDefinition, len(gd.Recipes.Recipes))
	for _, r := range gd.Recipes.Recipes {
		recipeCatalog[r.ID] = r
	}

	pendingRecipeUnlocks = make(map[string]string, len(gd.Techs.PendingRecipeUnlocks))
	for id, reason := range gd.Techs.PendingRecipeUnlocks {
		pendingRecipeUnlocks[id] = reason
	}
	techDefinitions = append([]TechDefinition(nil), gd.Techs.Techs...)
	techs := make(map[string]*TechDefinition, len(techDefinitions))
	for _, def := range techDefinitions {
		def.Unlocks = normalizeTechUnlocks(def.Unlocks)
		techs[def.ID] = &def
	}
	techCatalog = &TechCatalog{techs: techs}

	buildingDefs := make([]BuildingDefinition, 0, len(gd.Buildings.Buildings))
	runtimes := make(map[BuildingType]BuildingRuntimeDefinition, len(gd.Buildings.Buildings))
	for _, spec := range gd.Buildings.Buildings {
		buildingDefs = append(buildingDefs, spec.BuildingDefinition)
		runtimes[spec.ID] = runtimeDefinitionFromSpec(spec)
	}
	buildingCatalogMu.Lock()
	buildingCatalog = make(map[BuildingType]BuildingDefinition, len(buildingDefs))
	for _, def := range buildingDefs {
		buildingCatalog[def.ID] = def
	}
	buildingCatalogMu.Unlock()
	buildingRuntimeMu.Lock()
	buildingRuntime = runtimes
	buildingRuntimeMu.Unlock()

	unitDefinitions = make(map[UnitType]UnitDefinition, len(gd.Units.Units))
	unitOrder = unitOrder[:0]
	for _, u := range gd.Units.Units {
		unitDefinitions[u.ID] = u
		unitOrder = append(unitOrder, u.ID)
	}

	damageCoefficients = make(map[WeaponType]map[ArmorClass]float64, len(gd.Combat.DamageCoefficients))
	for weapon, row := range gd.Combat.DamageCoefficients {
		cp := make(map[ArmorClass]float64, len(row))
		for armor, coef := range row {
			cp[armor] = coef
		}
		damageCoefficients[weapon] = cp
	}

	warBaseFrameEntries = cloneWarBaseFrameEntries(gd.War.BaseFrames)
	warBaseHullEntries = cloneWarBaseHullEntries(gd.War.BaseHulls)
	warComponentEntries = cloneWarComponentEntries(gd.War.Components)
	warPublicBlueprintEntries = make([]WarPublicBlueprintCatalogEntry, 0, len(gd.War.PublicBlueprints))
	warBlueprintRuntimeProfiles = make(map[string]WarBlueprintRuntimeProfile, len(gd.War.PublicBlueprints))
	for _, bp := range gd.War.PublicBlueprints {
		entry := bp.WarPublicBlueprintCatalogEntry
		entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
		entry.Commands = append([]string(nil), entry.Commands...)
		entry.Components = append([]WarBlueprintComponentSlot(nil), entry.Components...)
		warPublicBlueprintEntries = append(warPublicBlueprintEntries, entry)
		warBlueprintRuntimeProfiles[bp.ID] = cloneWarBlueprintRuntimeProfile(bp.Runtime)
	}

	resetCatalogDerivations()
}

// runtimeDefinitionFromSpec 取条目的运行时定义；未配置 runtime 的建筑只有占地。
func runtimeDefinitionFromSpec(spec BuildingSpec) BuildingRuntimeDefinition {
	def := BuildingRuntimeDefinition{Params: BuildingRuntimeParams{Footprint: spec.Footprint}}
	if spec.Runtime != nil {
		def = BuildingRuntimeDefinition{
			Params:    spec.Runtime.Params.clone(),
			Functions: spec.Runtime.Functions.clone(),
		}
		if def.Params.Footprint == (Footprint{}) {
			def.Params.Footprint = spec.Footprint
		}
	}
	def.ID = spec.ID
	return def
}
