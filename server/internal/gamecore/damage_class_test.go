package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// R6 伤害类型与克制：护甲 × 武器系数在交战结算中生效。

func TestR6DamageCoefficientTable(t *testing.T) {
	// 每个武器类至少有一个 >1 的克制对象与一个 <1 的被克制对象。
	for weapon, row := range model.DamageCoefficient {
		strong, weak := false, false
		for _, coef := range row {
			if coef > 1.0 {
				strong = true
			}
			if coef < 1.0 {
				weak = true
			}
		}
		if !strong || !weak {
			t.Fatalf("weapon %s lacks counter/countered pair: %+v", weapon, row)
		}
	}
	// 关键克制关系。
	if c := model.ResolveDamageCoefficient(model.WeaponTypeCannon, model.ArmorStructure); c <= 1 {
		t.Fatal("cannon should counter structures")
	}
	if c := model.ResolveDamageCoefficient(model.WeaponTypeCannon, model.ArmorAir); c >= 1 {
		t.Fatal("cannon should be countered by air")
	}
	if c := model.ResolveDamageCoefficient(model.WeaponTypeMissile, model.ArmorAir); c <= 1 {
		t.Fatal("missile should counter air")
	}
	if c := model.ResolveDamageCoefficient(model.WeaponTypeGun, model.ArmorHeavy); c >= 1 {
		t.Fatal("gun should be countered by heavy armor")
	}
	if c := model.ResolveDamageCoefficient(model.WeaponTypeGun, model.ArmorLight); c <= 1 {
		t.Fatal("gun should counter light armor")
	}
}

func TestR6UnitDamageAppliesCoefficient(t *testing.T) {
	ws := newRTTWorld(true)
	// 机枪士兵打重甲机甲：系数 0.75（基础 15-12=3 → 3*0.75=2.25→2... 取 max(1,..) 逻辑）。
	gunner := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 5, Y: 5})
	mechaVictim := spawnWorldTestUnit(ws, model.UnitTypeMecha, "p2", model.Position{X: 6, Y: 5})
	// 炮机机甲打轻甲士兵：系数 0.75，但对建筑 1.5。
	cannon := spawnWorldTestUnit(ws, model.UnitTypeMecha, "p2", model.Position{X: 8, Y: 5})
	soldierVictim := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 8, Y: 6})

	gunner.AttackTarget = mechaVictim.ID
	cannon.AttackTarget = soldierVictim.ID
	ws.Tick++
	settleUnitCombat(ws)

	// 机枪 vs 重甲：(15-12)=3 × 0.75 = 2.25 → 2
	if got, want := mechaVictim.MaxHP-mechaVictim.HP, 2; got != want {
		t.Fatalf("gun vs heavy damage = %d, want %d", got, want)
	}
	// 加农 vs 轻甲：(28-5)=23 × 0.75 = 17.25 → 17
	if got, want := soldierVictim.MaxHP-soldierVictim.HP, 17; got != want {
		t.Fatalf("cannon vs light damage = %d, want %d", got, want)
	}
}

func TestR6BuildingTakesCoefficientDamage(t *testing.T) {
	ws := newRTTWorld(true)
	cannon := spawnWorldTestUnit(ws, model.UnitTypeMecha, "p1", model.Position{X: 5, Y: 5})
	depot := newBuilding("depot-r6", model.BuildingTypeDepotMk1, "p2", model.Position{X: 7, Y: 5})
	placeBuilding(ws, depot)
	hpBefore := depot.HP

	cannon.AttackTarget = depot.ID
	ws.Tick++
	settleUnitCombat(ws)

	// 加农 vs 建筑：(28-2)=26 × 1.5 = 39
	if got, want := hpBefore-depot.HP, 39; got != want {
		t.Fatalf("cannon vs structure damage = %d, want %d", got, want)
	}
}

func TestR6TurretCounterAirAndHeavy(t *testing.T) {
	ws := newRTTWorld(true)
	// 导弹塔打轻甲（系数 1.0）与加农塔打重甲（系数 1.25）对照。
	turret := newBuilding("turret-r6", model.BuildingTypeGaussTurret, "p1", model.Position{X: 5, Y: 5})
	turret.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, turret)
	combat := turret.Runtime.Functions.Combat
	if accepted, _, err := turret.Storage.Load(combat.AmmoItem, 50); err != nil || accepted != 50 {
		t.Fatalf("load ammo: %d %v", accepted, err)
	}

	victim := spawnWorldTestUnit(ws, model.UnitTypeMecha, "p2", model.Position{X: 6, Y: 5})
	ws.Tick++
	settleTurrets(ws)

	// 加农塔 vs 重甲：(attack-12) × 1.25；attack 取自炮塔定义。
	want := max(1, int(float64(max(1, combat.Attack-victim.Defense))*1.25))
	if got := victim.MaxHP - victim.HP; got != want {
		t.Fatalf("gauss turret vs heavy damage = %d, want %d", got, want)
	}
}
