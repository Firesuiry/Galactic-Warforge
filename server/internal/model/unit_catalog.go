package model

// UnitDomain describes the space a unit or blueprint lives in.
type UnitDomain string

const (
	UnitDomainGround  UnitDomain = "ground"
	UnitDomainAir     UnitDomain = "air"
	UnitDomainOrbital UnitDomain = "orbital"
	UnitDomainSpace   UnitDomain = "space"
)

// UnitRuntimeClass describes which authoritative runtime owns the unit.
type UnitRuntimeClass string

const (
	UnitRuntimeClassWorld       UnitRuntimeClass = "world_unit"
	UnitRuntimeClassCombatSquad UnitRuntimeClass = "combat_squad"
	UnitRuntimeClassFleet       UnitRuntimeClass = "fleet_unit"
)

// UnitProductionMode describes how a unit enters the world.
type UnitProductionMode string

const (
	UnitProductionModeWorldProduce  UnitProductionMode = "world_produce"
	UnitProductionModeFactoryRecipe UnitProductionMode = "factory_recipe"
	UnitProductionModeInternal      UnitProductionMode = "internal"
)

// WorldUnitCatalogEntry is the authoritative public-facing catalog entry for non-blueprint world units.
type WorldUnitCatalogEntry struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	Domain         UnitDomain         `json:"domain"`
	RuntimeClass   UnitRuntimeClass   `json:"runtime_class"`
	Public         bool               `json:"public"`
	ProductionMode UnitProductionMode `json:"production_mode"`
	QueryScopes    []string           `json:"query_scopes,omitempty"`
	Commands       []string           `json:"commands,omitempty"`
	HiddenReason   string             `json:"hidden_reason,omitempty"`
}

var worldUnitCatalogEntries = []WorldUnitCatalogEntry{
	{
		ID:             string(UnitTypeWorker),
		Name:           "Worker",
		Domain:         UnitDomainGround,
		RuntimeClass:   UnitRuntimeClassWorld,
		Public:         true,
		ProductionMode: UnitProductionModeWorldProduce,
		QueryScopes:    []string{"planet"},
		Commands:       []string{"move"},
	},
	{
		ID:             string(UnitTypeSoldier),
		Name:           "Soldier",
		Domain:         UnitDomainGround,
		RuntimeClass:   UnitRuntimeClassWorld,
		Public:         true,
		ProductionMode: UnitProductionModeWorldProduce,
		QueryScopes:    []string{"planet"},
		Commands:       []string{"move", "attack"},
	},
}

// PublicWorldUnitCatalogEntries returns the public world-unit catalog snapshot.
func PublicWorldUnitCatalogEntries() []WorldUnitCatalogEntry {
	out := make([]WorldUnitCatalogEntry, 0, len(worldUnitCatalogEntries))
	for _, entry := range worldUnitCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, cloneWorldUnitCatalogEntry(entry))
	}
	return out
}

// PublicWorldUnitByID returns one public-facing world-unit entry.
func PublicWorldUnitByID(id string) (WorldUnitCatalogEntry, bool) {
	for _, entry := range worldUnitCatalogEntries {
		if entry.ID != id || !entry.Public {
			continue
		}
		return cloneWorldUnitCatalogEntry(entry), true
	}
	return WorldUnitCatalogEntry{}, false
}

// PublicWorldProduceUnitByID returns the authoritative world-produce entry.
func PublicWorldProduceUnitByID(id string) (WorldUnitCatalogEntry, bool) {
	entry, ok := PublicWorldUnitByID(id)
	if !ok || entry.ProductionMode != UnitProductionModeWorldProduce || entry.RuntimeClass != UnitRuntimeClassWorld {
		return WorldUnitCatalogEntry{}, false
	}
	return entry, true
}

func cloneWorldUnitCatalogEntry(entry WorldUnitCatalogEntry) WorldUnitCatalogEntry {
	entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
	entry.Commands = append([]string(nil), entry.Commands...)
	return entry
}
