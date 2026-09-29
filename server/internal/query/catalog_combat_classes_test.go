package query

import (
	"encoding/json"
	"testing"
)

func TestCatalogJSONExposesBlueprintCombatClasses(t *testing.T) {
	data, err := json.Marshal((&Layer{}).Catalog())
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		DamageCoefficients map[string]map[string]float64 `json:"damage_coefficients"`
		Warfare            struct {
			PublicBlueprints []struct {
				ID          string  `json:"id"`
				ArmorClass  string  `json:"armor_class"`
				WeaponClass string  `json:"weapon_class"`
				Attack      int     `json:"attack"`
				Range       float64 `json:"range"`
				MaxHP       int     `json:"max_hp"`
			} `json:"public_blueprints"`
		} `json:"warfare"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	if body.DamageCoefficients["gun"]["light"] != 1.25 {
		t.Fatalf("catalog JSON missing damage_coefficients, got %+v", body.DamageCoefficients["gun"])
	}
	want := map[string]struct {
		armor, weapon string
		attack        int
		rang          float64
		maxHP         int
	}{
		"prototype":       {"heavy", "laser", 20, 8, 80},
		"precision_drone": {"air", "missile", 35, 12, 60},
		"corvette":        {"ship", "laser", 40, 24, 100},
		"destroyer":       {"ship", "laser", 80, 24, 180},
	}
	if len(body.Warfare.PublicBlueprints) != len(want) {
		t.Fatalf("expected %d public blueprints, got %+v", len(want), body.Warfare.PublicBlueprints)
	}
	for _, entry := range body.Warfare.PublicBlueprints {
		check, ok := want[entry.ID]
		if !ok {
			t.Fatalf("unexpected blueprint %s", entry.ID)
		}
		if entry.ArmorClass != check.armor || entry.WeaponClass != check.weapon {
			t.Fatalf("%s JSON classes = %s/%s, want %s/%s", entry.ID, entry.ArmorClass, entry.WeaponClass, check.armor, check.weapon)
		}
		if entry.Attack != check.attack || entry.Range != check.rang || entry.MaxHP != check.maxHP {
			t.Fatalf("%s JSON stats = %d/%v/%d, want %d/%v/%d", entry.ID, entry.Attack, entry.Range, entry.MaxHP, check.attack, check.rang, check.maxHP)
		}
	}
}
