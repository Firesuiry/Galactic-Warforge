package model

// UnitDomain describes the space a unit lives in.
type UnitDomain string

const (
	UnitDomainGround UnitDomain = "ground"
	UnitDomainAir    UnitDomain = "air"
	UnitDomainSpace  UnitDomain = "space"
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

// UnitCatalogEntry is the authoritative public-facing unit capability record.
type UnitCatalogEntry struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	Domain          UnitDomain         `json:"domain"`
	RuntimeClass    UnitRuntimeClass   `json:"runtime_class"`
	Public          bool               `json:"public"`
	VisibleTechID   string             `json:"visible_tech_id,omitempty"`
	ProductionMode  UnitProductionMode `json:"production_mode"`
	ProducerRecipes []string           `json:"producer_recipes,omitempty"`
	DeployCommand   string             `json:"deploy_command,omitempty"`
	QueryScopes     []string           `json:"query_scopes,omitempty"`
	Commands        []string           `json:"commands,omitempty"`
	HiddenReason    string             `json:"hidden_reason,omitempty"`
}

var unitCatalogEntries = []UnitCatalogEntry{
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

// PublicUnitCatalogEntries returns the public unit catalog snapshot.
func PublicUnitCatalogEntries() []UnitCatalogEntry {
	out := make([]UnitCatalogEntry, 0, len(unitCatalogEntries))
	for _, entry := range unitCatalogEntries {
		if !entry.Public {
			continue
		}
		out = append(out, cloneUnitCatalogEntry(entry))
	}
	return out
}

// PublicUnitCatalogEntryByID returns one public-facing unit entry.
func PublicUnitCatalogEntryByID(id string) (UnitCatalogEntry, bool) {
	for _, entry := range unitCatalogEntries {
		if entry.ID != id || !entry.Public {
			continue
		}
		return cloneUnitCatalogEntry(entry), true
	}
	return UnitCatalogEntry{}, false
}

// PublicWorldProduceUnitByID returns the authoritative world-produce entry.
func PublicWorldProduceUnitByID(id string) (UnitCatalogEntry, bool) {
	entry, ok := PublicUnitCatalogEntryByID(id)
	if !ok || entry.ProductionMode != UnitProductionModeWorldProduce || entry.RuntimeClass != UnitRuntimeClassWorld {
		return UnitCatalogEntry{}, false
	}
	return entry, true
}

func cloneUnitCatalogEntry(entry UnitCatalogEntry) UnitCatalogEntry {
	entry.ProducerRecipes = append([]string(nil), entry.ProducerRecipes...)
	entry.QueryScopes = append([]string(nil), entry.QueryScopes...)
	entry.Commands = append([]string(nil), entry.Commands...)
	return entry
}
