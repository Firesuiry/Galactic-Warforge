package model

import "sort"

type AmmunitionDefinition struct {
	ItemID           string  `json:"item_id" yaml:"item_id"`
	Class            string  `json:"class" yaml:"class"`
	Tier             int     `json:"tier" yaml:"tier"`
	DamageMultiplier float64 `json:"damage_multiplier" yaml:"damage_multiplier"`
}

var ammunitionCatalog []AmmunitionDefinition

func AmmunitionCatalog() []AmmunitionDefinition {
	return append([]AmmunitionDefinition(nil), ammunitionCatalog...)
}
func AmmunitionByItem(id string) (AmmunitionDefinition, bool) {
	for _, a := range ammunitionCatalog {
		if a.ItemID == id {
			return a, true
		}
	}
	return AmmunitionDefinition{}, false
}
func AmmunitionForClass(class string) []AmmunitionDefinition {
	out := make([]AmmunitionDefinition, 0)
	for _, a := range ammunitionCatalog {
		if a.Class == class {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Tier == out[j].Tier {
			return out[i].ItemID < out[j].ItemID
		}
		return out[i].Tier > out[j].Tier
	})
	return out
}
func DefaultAmmunition(class string) string {
	a := AmmunitionForClass(class)
	if len(a) == 0 {
		return ""
	}
	return a[len(a)-1].ItemID
}
func UnitAmmoDamageMultiplier(u *Unit) float64 {
	if a, ok := AmmunitionByItem(u.AmmoItem); ok {
		return a.DamageMultiplier
	}
	return 1
}

type UnitProductionOrder struct {
	UnitType       UnitType `json:"unit_type"`
	RemainingTicks int      `json:"remaining_ticks"`
	TotalTicks     int      `json:"total_ticks"`
}
