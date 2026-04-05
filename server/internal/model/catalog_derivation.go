package model

import (
	"sort"
	"sync"
)

var (
	techCatalogDerivedOnce sync.Once

	buildingCatalogDerivedMu sync.Mutex
	buildingCatalogDerived   bool
)

func ensureTechCatalogDerived() {
	if techCatalog == nil {
		return
	}

	techCatalogDerivedOnce.Do(func() {
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
	})
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
