package gamecore

import (
	"slices"
	"testing"

	"siliconworld/internal/model"
)

// ammoUnlockDepth 返回一个基础弹药配方最少需要研究多少项科技才能使用；开局可用为 0。
func ammoUnlockDepth(t *testing.T, recipeID string) int {
	t.Helper()
	fresh := &model.PlayerState{PlayerID: "p-ammo", Tech: model.NewPlayerTechState("p-ammo")}
	if CanUseRecipeTech(fresh, recipeID) {
		return 0
	}
	gates := map[string]bool{}
	recipe, ok := model.Recipe(recipeID)
	if !ok {
		t.Fatalf("recipe %s not found", recipeID)
	}
	for _, id := range recipe.TechUnlock {
		gates[id] = true
	}
	for _, def := range model.AllTechDefinitions() {
		for _, unlock := range def.Unlocks {
			if unlock.Type == model.TechUnlockRecipe && unlock.ID == recipeID {
				gates[def.ID] = true
			}
		}
	}
	best := -1
	for id := range gates {
		seen := map[string]bool{}
		var walk func(string)
		walk = func(techID string) {
			if seen[techID] || fresh.Tech.HasTech(techID) {
				return
			}
			def, ok := model.TechDefinitionByID(techID)
			if !ok {
				t.Fatalf("tech %s not found", techID)
			}
			seen[techID] = true
			for _, pre := range def.Prerequisites {
				walk(pre)
			}
		}
		walk(id)
		if best < 0 || len(seen) < best {
			best = len(seen)
		}
	}
	return best
}

// 弹药科技门控：子弹开局可造，炮弹中期，导弹更晚；高档弹晚于同类低档。
func TestAmmunitionTechGating(t *testing.T) {
	bullet := ammoUnlockDepth(t, "ammo_bullet")
	shell := ammoUnlockDepth(t, "shell_set")
	missile := ammoUnlockDepth(t, "ammo_missile")
	if bullet != 0 {
		t.Fatalf("bullets must be craftable from the start, needs %d techs", bullet)
	}
	if !(shell > bullet && shell < missile) {
		t.Fatalf("expected bullet < shell < missile in tech depth, got bullet=%d shell=%d missile=%d", bullet, shell, missile)
	}
	tiers := [][]string{
		{"ammo_bullet", "titanium_ammo"},
		{"shell_set", "crystal_shell"},
		{"ammo_missile", "supersonic_missile", "df_gravity_missile_set"},
	}
	for _, chain := range tiers {
		prev := -1
		for _, id := range chain {
			depth := ammoUnlockDepth(t, id)
			if depth <= prev {
				t.Fatalf("higher-tier recipe %s (depth %d) must need more research than the previous tier (depth %d)", id, depth, prev)
			}
			prev = depth
		}
	}
}

// 聚爆加农炮吃炮弹，不吃子弹/导弹。
func TestImplosionCannonUsesShells(t *testing.T) {
	b := newBuilding("cannon-shell", model.BuildingTypeImplosionCannon, "p1", model.Position{X: 2, Y: 2})
	combat := b.Runtime.Functions.Combat
	if combat == nil || combat.AmmoItem != model.ItemShellSet {
		t.Fatalf("implosion cannon must use shell_set, got %+v", combat)
	}
	for _, port := range b.Runtime.Params.IOPorts {
		if port.Direction != model.PortInput {
			continue
		}
		for _, item := range []string{model.ItemAmmoBullet, model.ItemAmmoMissile} {
			if len(port.AllowedItems) > 0 && slices.Contains(port.AllowedItems, item) {
				t.Fatalf("implosion cannon input must not accept %s", item)
			}
		}
	}
}
