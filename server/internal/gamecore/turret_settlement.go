package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

// settleTurrets - turrets auto-attack enemies in range (both units and enemy forces)
func settleTurrets(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	unitIDs := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		unitIDs = append(unitIDs, id)
	}
	sort.Strings(unitIDs)
	for _, id := range ids {
		turret := ws.Buildings[id]
		if turret == nil || turret.HP <= 0 || turret.Runtime.State != model.BuildingWorkRunning {
			continue
		}

		combat := turret.Runtime.Functions.Combat
		if combat == nil || combat.Attack <= 0 || combat.Range <= 0 {
			continue
		}
		if combat.FireRate > 0 && combat.LastFireTick > 0 && ws.Tick-combat.LastFireTick < int64(combat.FireRate) {
			continue
		}

		// Check if turret type is a defense building
		isDefenseTurret := model.IsDefenseBuilding(turret.Type)
		if !isDefenseTurret && turret.Type != model.BuildingTypeGaussTurret {
			continue
		}

		// Try to find a target - prioritize enemy forces, then enemy units
		targetedForce := -1
		targetedUnit := ""

		// Find enemy forces in range
		if ws.EnemyForces != nil && !combat.AirOnly {
			for i, force := range ws.EnemyForces.Forces {
				if ws.SurfaceWithin(turret.Position, force.Position, combat.Range) && ws.SurfaceDistance(turret.Position, force.Position) >= combat.MinRange {
					targetedForce = i
					break // one attack per turret per tick
				}
			}
		}

		// If no enemy force target, find enemy unit target
		if targetedForce < 0 {
			for _, unitID := range unitIDs {
				unit := ws.Units[unitID]
				if unit == nil || unit.HP <= 0 {
					continue
				}
				if combat.AirOnly && unit.Domain != model.UnitDomainAir || unit.Domain == model.UnitDomainAir && model.WeaponClassForBuilding(turret.Type) != model.WeaponTypeMissile && !combat.AirOnly || ws.SurfaceDistance(turret.Position, unit.Position) < combat.MinRange {
					continue
				}
				if unit.OwnerID == turret.OwnerID {
					continue
				}
				if sameTeam(ws, unit.OwnerID, turret.OwnerID) {
					continue
				}
				if !ws.SurfaceWithin(turret.Position, unit.Position, combat.Range) {
					continue
				}
				targetedUnit = unit.ID
				break
			}
		}
		// 防空炮最后才找空中物流载具（打击来袭战斗单位优先）。
		var targetedLogistics *airborneLogistics
		if targetedForce < 0 && targetedUnit == "" && combat.AirOnly {
			targetedLogistics = hostileAirborneLogistics(ws, turret, combat)
		}
		if targetedForce < 0 && targetedUnit == "" && targetedLogistics == nil {
			continue
		}
		// All storage buckets are parts of the same magazine; storage settlement
		// may already have moved loaded ammunition to the output buffer.
		attack := combat.Attack
		if ammo, ok := model.AmmunitionByItem(combat.AmmoItem); ok {
			loaded := false
			for _, tier := range model.AmmunitionForClass(ammo.Class) {
				if consumeTurretAmmunition(turret.Storage, tier.ItemID, max(1, combat.AmmoConsume)) {
					attack = int(float64(attack) * tier.DamageMultiplier)
					loaded = true
					break
				}
			}
			if !loaded {
				if turret.Runtime.StateReason != "no_ammunition" {
					turret.Runtime.StateReason = "no_ammunition"
					events = append(events, turretStateEvent(turret))
				}
				continue
			}
		} else if combat.AmmoItem != "" && !consumeTurretAmmunition(turret.Storage, combat.AmmoItem, max(1, combat.AmmoConsume)) {
			if turret.Runtime.StateReason != "no_ammunition" {
				turret.Runtime.StateReason = "no_ammunition"
				events = append(events, turretStateEvent(turret))
			}
			continue
		}

		if turret.Runtime.StateReason == "no_ammunition" {
			turret.Runtime.StateReason = ""
			events = append(events, turretStateEvent(turret))
		}
		combat.LastFireTick = ws.Tick

		// Apply damage to the target
		if targetedLogistics != nil {
			events = append(events, shootDownLogistics(ws, turret, targetedLogistics)...)
		} else if targetedForce >= 0 {
			// Attack enemy force
			force := &ws.EnemyForces.Forces[targetedForce]
			damage := attack
			// Shield mitigation (30% damage to shield, 70% to HP)
			if force.SpreadRadius > 0 { // using spreadRadius as shield proxy
				shieldDamage := float64(damage) * 0.3
				force.SpreadRadius -= shieldDamage * 0.01
				if force.SpreadRadius < 0.1 {
					force.SpreadRadius = 0.1
				}
				damage = int(float64(damage) * 0.7)
			}

			// Reduce force strength based on damage
			strengthBefore := force.Strength
			force.Strength -= damage / 10
			if force.Strength < 0 {
				force.Strength = 0
			}

			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: "all",
				Payload: map[string]any{
					"attacker_id":        turret.ID,
					"target_id":          force.ID,
					"damage":             damage,
					"target_type":        "enemy_force",
					"remaining_strength": force.Strength,
				},
			})

			// Remove destroyed enemy forces
			if force.Strength <= 0 {
				// 炮塔击杀同样掉落：优先进入炮塔自身存储（行星侧库存），
				// 满仓保留已有物品，溢出转入击杀者机甲背包。
				// E4 起统一走 destroyEnemyForce（掉落放大/威胁回落/遗址登记/战报事件）。
				events = append(events, destroyEnemyForce(ws, force, strengthBefore, turret.ID, turret.OwnerID, "turret", turret.Storage)...)
			}
		} else if targetedUnit != "" {
			// Attack enemy unit
			unit := ws.Units[targetedUnit]
			model.SyncMechaCapabilities(unit, ws.Players[unit.OwnerID])
			turretWeapon := model.WeaponClassForBuilding(turret.Type)
			raw := max(1, int(float64(max(1, attack-unit.Defense))*model.ResolveDamageCoefficient(turretWeapon, unit.ArmorClass)))
			damage, absorbed := model.ApplyUnitDamage(unit, raw, ws.Tick)
			if unit.Mecha != nil {
				events = append(events, mechaStateEvent(unit))
			}

			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: unit.OwnerID,
				Payload: map[string]any{
					"attacker_id":     turret.ID,
					"target_id":       unit.ID,
					"damage":          damage,
					"target_hp":       unit.HP,
					"shield_absorbed": absorbed,
				},
			})

			// The firing player also needs this authoritative event for combat UI.
			shot := *events[len(events)-1]
			shot.VisibilityScope = turret.OwnerID
			events = append(events, &shot)

			if unit.HP <= 0 {
				events = append(events, killUnit(ws, unit, turret.ID, turret.OwnerID, "turret")...)
			}
		}
	}

	return events
}

func consumeTurretAmmunition(storage *model.StorageState, itemID string, quantity int) bool {
	if storage == nil || availableStorageItem(storage, itemID)+currentStorageItem(storage.OutputBuffer, itemID) < quantity {
		return false
	}
	remaining := quantity
	for _, inventory := range []model.ItemInventory{storage.InputBuffer, storage.Inventory, storage.OutputBuffer} {
		remaining -= removeStorageItem(inventory, itemID, remaining)
	}
	return true
}

func turretStateEvent(turret *model.Building) *model.GameEvent {
	return &model.GameEvent{EventType: model.EvtBuildingStateChanged, VisibilityScope: turret.OwnerID,
		Payload: map[string]any{"building_id": turret.ID, "state": turret.Runtime.State, "reason": turret.Runtime.StateReason}}
}
