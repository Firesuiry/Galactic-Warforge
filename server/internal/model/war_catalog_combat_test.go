package model

import "testing"

func TestPublicBlueprintCombatClasses(t *testing.T) {
	catalog := PublicWarfareCatalog()
	byID := map[string]WarPublicBlueprintCatalogEntry{}
	for _, entry := range catalog.PublicBlueprints {
		byID[entry.ID] = entry
	}
	checks := []struct {
		id     string
		armor  ArmorClass
		weapon WeaponType
		attack int
		rang   float64
		maxHP  int
	}{
		{ItemPrototype, ArmorHeavy, WeaponTypeLaser, 20, 24, 80},
		{ItemPrecisionDrone, ArmorAir, WeaponTypeMissile, 35, 36, 60},
		{ItemCorvette, ArmorShip, WeaponTypeLaser, 40, 72, 100},
		{ItemDestroyer, ArmorShip, WeaponTypeLaser, 80, 72, 180},
	}
	if len(byID) != len(checks) {
		t.Fatalf("expected %d public blueprints, got %d", len(checks), len(byID))
	}
	for _, check := range checks {
		entry, ok := byID[check.id]
		if !ok {
			t.Fatalf("missing public blueprint %s", check.id)
		}
		if entry.ArmorClass != check.armor || entry.WeaponClass != check.weapon {
			t.Fatalf("%s classes = %s/%s, want %s/%s", check.id, entry.ArmorClass, entry.WeaponClass, check.armor, check.weapon)
		}
		if entry.Attack != check.attack || entry.Range != check.rang || entry.MaxHP != check.maxHP {
			t.Fatalf("%s stats = attack %d range %v max_hp %d, want %d/%v/%d", check.id, entry.Attack, entry.Range, entry.MaxHP, check.attack, check.rang, check.maxHP)
		}
		again, ok := PublicWarBlueprintByID(check.id)
		if !ok || again.ArmorClass != check.armor || again.WeaponClass != check.weapon || again.Attack != check.attack {
			t.Fatalf("PublicWarBlueprintByID(%s) = %+v", check.id, again)
		}
	}
	for _, entry := range warPublicBlueprintEntries {
		if entry.ArmorClass != "" || entry.WeaponClass != "" || entry.Attack != 0 || entry.MaxHP != 0 || entry.Range != 0 {
			t.Fatalf("static blueprint %s stored derived combat fields", entry.ID)
		}
	}

	armor, weapon := BlueprintCombatClasses(UnitRuntimeClassCombatSquad, UnitDomainAir, "")
	if armor != ArmorAir || weapon != "" {
		t.Fatalf("air squad without profile = %s/%s, want air and omitted weapon", armor, weapon)
	}
	armor, weapon = BlueprintCombatClasses(UnitRuntimeClassCombatSquad, UnitDomainGround, ItemPrototype)
	if armor != ArmorHeavy || weapon != WeaponTypeLaser {
		t.Fatalf("ground squad = %s/%s, want heavy/laser", armor, weapon)
	}
	armor, _ = BlueprintCombatClasses(UnitRuntimeClassFleet, UnitDomainGround, ItemCorvette)
	if armor != ArmorShip {
		t.Fatalf("fleet armor = %s, want ship", armor)
	}
}

// TestDerivedWarWeaponRangeMatchesPublicBlueprintScale 派生路径（war.yaml 里没有
// 预置 runtime 档案的蓝图，走 ResolveWarBlueprintRuntimeProfile 现推）的武器射程
// 必须与 public_blueprints 预置档案同一 cell 口径：细分网格前派生值漏 ×3 时，
// 同一件武器组件在派生路径只有预置路径的 1/3 射程。
func TestDerivedWarWeaponRangeMatchesPublicBlueprintScale(t *testing.T) {
	catalog := PublicWarBlueprintCatalogIndex()
	// 与 corvette（线圈炮阵列，kinetic，预置射程 72）同底盘、同组件的蓝图，
	// 但用一个不在预置表里的 id，强制走派生路径。
	base, ok := PresetWarBlueprintByID(ItemCorvette)
	if !ok {
		t.Fatal("expected corvette preset blueprint")
	}
	derived := base
	derived.ID = "derived-coilgun-test"
	derived.Name = "派生线圈炮测试舰"
	derived.State = WarBlueprintStateDraft

	if _, preset := WarBlueprintRuntimeProfileByID(derived.ID); preset {
		t.Fatal("derived blueprint must not have a preset runtime profile")
	}
	if res := ValidateWarBlueprint(catalog, derived); !res.Valid {
		t.Fatalf("derived blueprint must validate: %+v", res.Issues)
	}

	profile := ResolveWarBlueprintRuntimeProfile(derived)
	if profile.FleetUnit == nil {
		t.Fatalf("space blueprint must derive a fleet unit profile: %+v", profile)
	}
	if got := profile.FleetUnit.Weapon.Range; got != 60 {
		t.Fatalf("derived kinetic weapon range = %v, want 60 cell (预置 72 的同一 cell 口径；漏 ×3 时是 20)", got)
	}

	// 组件级：三种武器类别的派生射程都是设计值的 3 倍。
	components := []struct {
		id    string
		tag   string
		rang  float64
	}{
		{id: "plasma_lance", tag: "direct_fire", rang: 39},
		{id: "swarm_missile_pod", tag: "missile", rang: 54},
		{id: "coilgun_battery", tag: "kinetic", rang: 60},
	}
	for _, check := range components {
		component, ok := catalog.ComponentByID(check.id)
		if !ok {
			t.Fatalf("missing war component %s", check.id)
		}
		if !hasWarComponentTag(component, check.tag) {
			t.Fatalf("component %s should carry tag %s", check.id, check.tag)
		}
		if got := derivedWarWeapon(component).Range; got != check.rang {
			t.Fatalf("derived %s range = %v, want %v cell", check.id, got, check.rang)
		}
	}
}
