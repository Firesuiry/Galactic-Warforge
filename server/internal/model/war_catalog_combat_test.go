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
		{ItemPrototype, ArmorHeavy, WeaponTypeLaser, 20, 8, 80},
		{ItemPrecisionDrone, ArmorAir, WeaponTypeMissile, 35, 12, 60},
		{ItemCorvette, ArmorShip, WeaponTypeLaser, 40, 24, 100},
		{ItemDestroyer, ArmorShip, WeaponTypeLaser, 80, 24, 180},
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

	armor, weapon := BlueprintCombatClasses(UnitRuntimeClassCombatSquad, UnitDomainGround, "drone", "")
	if armor != ArmorAir || weapon != "" {
		t.Fatalf("drone platform without profile = %s/%s, want air and omitted weapon", armor, weapon)
	}
	armor, weapon = BlueprintCombatClasses(UnitRuntimeClassCombatSquad, UnitDomainGround, "mech", ItemPrototype)
	if armor != ArmorHeavy || weapon != WeaponTypeLaser {
		t.Fatalf("ground squad = %s/%s, want heavy/laser", armor, weapon)
	}
	armor, _ = BlueprintCombatClasses(UnitRuntimeClassFleet, UnitDomainGround, "", ItemCorvette)
	if armor != ArmorShip {
		t.Fatalf("fleet armor = %s, want ship", armor)
	}
}
