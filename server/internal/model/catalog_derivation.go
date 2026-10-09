package model

import (
	"sort"
	"sync"
	"sync/atomic"
)

var (
	techCatalogDerivedMu sync.Mutex
	techCatalogDerived   atomic.Bool

	recipeUnlockIndexMu sync.RWMutex
	recipeUnlockIndex   map[string][]string
	recipeUnlockIndexOK bool

	buildingCatalogDerivedMu sync.Mutex
	buildingCatalogDerived   bool
)

// resetCatalogDerivations 数据重新安装后，让科技 leads_to/hidden 与建筑 unlock_tech 重新派生。
func resetCatalogDerivations() {
	techCatalogDerived.Store(false)
	markBuildingCatalogDerivedDirty()
	recipeUnlockIndexMu.Lock()
	recipeUnlockIndexOK = false
	recipeUnlockIndexMu.Unlock()
}

// TechsUnlockingRecipe 返回"解锁该配方的科技 ID"（含隐藏科技，与
// AllTechDefinitions 遍历口径一致，顺序按科技等级/ID 排序）。
// 供 CanUseRecipeTech 等每 tick 高频调用点 O(1) 查询。
func TechsUnlockingRecipe(recipeID string) []string {
	ensureRecipeUnlockIndex()
	recipeUnlockIndexMu.RLock()
	defer recipeUnlockIndexMu.RUnlock()
	return recipeUnlockIndex[recipeID]
}

func ensureRecipeUnlockIndex() {
	recipeUnlockIndexMu.RLock()
	ok := recipeUnlockIndexOK
	recipeUnlockIndexMu.RUnlock()
	if ok {
		return
	}
	recipeUnlockIndexMu.Lock()
	defer recipeUnlockIndexMu.Unlock()
	if recipeUnlockIndexOK {
		return
	}
	index := make(map[string][]string, len(recipeCatalog))
	if techCatalog != nil {
		techCatalog.mu.RLock()
		ids := make([]string, 0, len(techCatalog.techs))
		for id := range techCatalog.techs {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			def := techCatalog.techs[id]
			if def == nil {
				continue
			}
			for _, unlock := range def.Unlocks {
				if unlock.Type != TechUnlockRecipe || unlock.ID == "" {
					continue
				}
				index[unlock.ID] = appendStringUnique(index[unlock.ID], id)
			}
		}
		techCatalog.mu.RUnlock()
	}
	recipeUnlockIndex = index
	recipeUnlockIndexOK = true
}

func ensureTechCatalogDerived() {
	if techCatalog == nil {
		return
	}

	if techCatalogDerived.Load() {
		return
	}
	techCatalogDerivedMu.Lock()
	defer techCatalogDerivedMu.Unlock()
	if techCatalogDerived.Load() {
		return
	}
	defer techCatalogDerived.Store(true)
	{
		techCatalog.mu.Lock()
		defer techCatalog.mu.Unlock()

		successors := make(map[string][]string, len(techCatalog.techs))
		for id, def := range techCatalog.techs {
			if def == nil {
				continue
			}
			def.LeadsTo = nil
			successors[id] = nil
		}
		for _, def := range techCatalog.techs {
			if def == nil {
				continue
			}
			for _, prereq := range def.Prerequisites {
				if _, ok := techCatalog.techs[prereq]; !ok {
					continue
				}
				successors[prereq] = append(successors[prereq], def.ID)
			}
		}
		for id := range successors {
			sort.Strings(successors[id])
		}

		changed := true
		for changed {
			changed = false
			for _, def := range techCatalog.techs {
				if def == nil || def.Hidden || techHasPublicValue(def) {
					continue
				}

				hasVisibleSuccessor := false
				for _, nextID := range successors[def.ID] {
					next := techCatalog.techs[nextID]
					if next != nil && !next.Hidden {
						hasVisibleSuccessor = true
						break
					}
				}
				if hasVisibleSuccessor {
					continue
				}

				def.Hidden = true
				changed = true
			}
		}

		for _, def := range techCatalog.techs {
			if def == nil || def.Hidden {
				continue
			}

			leadsTo := make([]string, 0, len(successors[def.ID]))
			for _, nextID := range successors[def.ID] {
				next := techCatalog.techs[nextID]
				if next != nil && !next.Hidden {
					leadsTo = append(leadsTo, nextID)
				}
			}
			if len(leadsTo) > 0 {
				def.LeadsTo = leadsTo
			}
		}
	}
}

func techHasPublicValue(def *TechDefinition) bool {
	return def.MaxLevel != 0 || len(def.Unlocks) > 0 || len(def.Effects) > 0
}

func ensureBuildingCatalogDerived() {
	if techCatalog == nil {
		return
	}
	ensureTechCatalogDerived()

	buildingCatalogDerivedMu.Lock()
	defer buildingCatalogDerivedMu.Unlock()
	if buildingCatalogDerived {
		return
	}

	unlockTechByBuilding := make(map[BuildingType][]string)

	techCatalog.mu.RLock()
	for _, def := range techCatalog.techs {
		if def == nil || def.Hidden {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type != TechUnlockBuilding {
				continue
			}
			btype := BuildingType(unlock.ID)
			unlockTechByBuilding[btype] = appendStringUnique(unlockTechByBuilding[btype], def.ID)
		}
	}
	techCatalog.mu.RUnlock()

	for btype := range unlockTechByBuilding {
		sort.Strings(unlockTechByBuilding[btype])
	}

	buildingCatalogMu.Lock()
	for id, def := range buildingCatalog {
		def.UnlockTech = nil
		if unlocks := unlockTechByBuilding[id]; len(unlocks) > 0 {
			def.UnlockTech = append([]string(nil), unlocks...)
		}
		buildingCatalog[id] = def
	}
	buildingCatalogMu.Unlock()

	buildingCatalogDerived = true
}

func markBuildingCatalogDerivedDirty() {
	buildingCatalogDerivedMu.Lock()
	buildingCatalogDerived = false
	buildingCatalogDerivedMu.Unlock()
}

func appendStringUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
