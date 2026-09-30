package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

// Ammunition is consumed only after a valid target and cooldown are resolved.
func consumeUnitAmmunition(u *model.Unit) bool {
	if u.OwnerID == model.DarkFogOwnerID || u.AmmoClass == "" {
		return true
	}
	if u.Ammo <= 0 {
		u.CombatState = "no_ammunition"
		return false
	}
	u.Ammo--
	if u.Ammo == 0 {
		u.CombatState = "no_ammunition"
	} else {
		u.CombatState = ""
	}
	return true
}

func refillUnit(u *model.Unit, budget int, available func(string) int, take func(string, int)) int {
	if budget <= 0 || u.AmmoClass == "" || u.Ammo >= u.AmmoCapacity {
		return 0
	}
	for _, ammo := range model.AmmunitionForClass(u.AmmoClass) {
		// Never convert leftover low-tier rounds into free high-tier rounds.
		if u.Ammo > 0 && u.AmmoItem != ammo.ItemID {
			continue
		}
		n := min(budget, min(u.AmmoCapacity-u.Ammo, available(ammo.ItemID)))
		if n <= 0 {
			continue
		}
		take(ammo.ItemID, n)
		u.Ammo += n
		u.AmmoItem = ammo.ItemID
		u.CombatState = ""
		return n
	}
	return 0
}

func settleAmmunitionSupply(ws *model.WorldState) {
	if ws == nil {
		return
	}
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	buildings := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		buildings = append(buildings, id)
	}
	sort.Strings(buildings)
	for _, id := range buildings {
		b := ws.Buildings[id]
		if b == nil || b.HP <= 0 || b.Storage == nil || b.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		def, ok := model.BuildingDefinitionByID(b.Type)
		if !ok || def.SupplyRadius <= 0 || def.SupplyRate <= 0 {
			continue
		}
		remaining := def.SupplyRate
		available := func(item string) int { return b.Storage.ItemQuantity(item) }
		take := func(item string, n int) { consumeTurretAmmunition(b.Storage, item, n) }
		for _, uid := range ids {
			u := ws.Units[uid]
			if u == nil || u.HP <= 0 || u.OwnerID != b.OwnerID || ws.SurfaceDistance(b.Position, u.Position) > def.SupplyRadius {
				continue
			}
			remaining -= refillUnit(u, remaining, available, take)
			spec, _ := model.UnitDefinitionByID(u.Type)
			if spec.CargoCapacity <= 0 || remaining <= 0 {
				continue
			}
			if u.Cargo == nil {
				u.Cargo = make(model.ItemInventory)
			}
			// Rotate classes to avoid filling a transport exclusively with bullets.
			classes := []string{"bullet", "shell", "missile"}
			total := 0
			for _, q := range u.Cargo {
				total += q
			}
			for i := 0; i < len(classes) && remaining > 0; i++ {
				class := classes[(int(ws.Tick)+i)%len(classes)]
				classTotal := 0
				for item, q := range u.Cargo {
					a, ok := model.AmmunitionByItem(item)
					if ok && a.Class == class {
						classTotal += q
					}
				}
				for _, a := range model.AmmunitionForClass(class) {
					n := min(remaining, min(spec.CargoCapacity-total, min(spec.CargoCapacity/3-classTotal, available(a.ItemID))))
					if n <= 0 {
						continue
					}
					take(a.ItemID, n)
					u.Cargo[a.ItemID] += n
					remaining -= n
					total += n
					classTotal += n
				}
			}
		}
	}
	for _, id := range ids {
		carrier := ws.Units[id]
		if carrier == nil || carrier.HP <= 0 {
			continue
		}
		def, _ := model.UnitDefinitionByID(carrier.Type)
		if def.SupplyRadius <= 0 {
			continue
		}
		remaining := def.SupplyRate
		for _, uid := range ids {
			u := ws.Units[uid]
			if u == nil || u.ID == id || u.HP <= 0 || u.OwnerID != carrier.OwnerID || ws.SurfaceDistance(carrier.Position, u.Position) > def.SupplyRadius {
				continue
			}
			if def.RepairRate > 0 {
				u.HP = min(u.MaxHP, u.HP+def.RepairRate)
			}
			remaining -= refillUnit(u, remaining, func(item string) int { return carrier.Cargo[item] }, func(item string, n int) {
				carrier.Cargo[item] -= n
				if carrier.Cargo[item] == 0 {
					delete(carrier.Cargo, item)
				}
			})
		}
	}
}
