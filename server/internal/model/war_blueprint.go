package model

// WarBlueprintState tracks lifecycle state for player and preset warfare blueprints.
type WarBlueprintState string

const (
	WarBlueprintStateDraft       WarBlueprintState = "draft"
	WarBlueprintStateValidated   WarBlueprintState = "validated"
	WarBlueprintStatePrototype   WarBlueprintState = "prototype"
	WarBlueprintStateFieldTested WarBlueprintState = "field_tested"
	WarBlueprintStateAdopted     WarBlueprintState = "adopted"
	WarBlueprintStateObsolete    WarBlueprintState = "obsolete"
)

// WarBlueprintValidationIssueCode identifies one structured blueprint validation problem.
type WarBlueprintValidationIssueCode string

const (
	WarBlueprintIssueUnknownBase                 WarBlueprintValidationIssueCode = "unknown_base"
	WarBlueprintIssueUnknownComponent            WarBlueprintValidationIssueCode = "unknown_component"
	WarBlueprintIssueRequiredSlotMissing         WarBlueprintValidationIssueCode = "required_slot_missing"
	WarBlueprintIssuePowerBudgetExceeded         WarBlueprintValidationIssueCode = "power_budget_exceeded"
	WarBlueprintIssueVolumeBudgetExceeded        WarBlueprintValidationIssueCode = "volume_budget_exceeded"
	WarBlueprintIssueMassBudgetExceeded          WarBlueprintValidationIssueCode = "mass_budget_exceeded"
	WarBlueprintIssueRigidityBudgetExceeded      WarBlueprintValidationIssueCode = "rigidity_budget_exceeded"
	WarBlueprintIssueHeatDissipationInsufficient WarBlueprintValidationIssueCode = "heat_dissipation_insufficient"
	WarBlueprintIssueSignatureBudgetExceeded     WarBlueprintValidationIssueCode = "signature_budget_exceeded"
	WarBlueprintIssueMaintenanceBudgetExceeded   WarBlueprintValidationIssueCode = "maintenance_budget_exceeded"
	WarBlueprintIssueHardpointMismatch           WarBlueprintValidationIssueCode = "hardpoint_mismatch"
	WarBlueprintIssueDomainMismatch              WarBlueprintValidationIssueCode = "domain_mismatch"
	WarBlueprintIssueVariantSlotLocked           WarBlueprintValidationIssueCode = "variant_slot_locked"
	WarBlueprintIssueInvalidStateTransition      WarBlueprintValidationIssueCode = "invalid_state_transition"
)

// WarBlueprintBudgetUsage reports the current component totals of a blueprint.
type WarBlueprintBudgetUsage struct {
	PowerOutput   int `json:"power_output,omitempty"`
	PowerDraw     int `json:"power_draw,omitempty"`
	Volume        int `json:"volume,omitempty"`
	Mass          int `json:"mass,omitempty"`
	RigidityLoad  int `json:"rigidity_load,omitempty"`
	HeatLoad      int `json:"heat_load,omitempty"`
	Maintenance   int `json:"maintenance,omitempty"`
	SignalLoad    int `json:"signal_load,omitempty"`
	StealthRating int `json:"stealth_rating,omitempty"`
}

// WarBlueprintValidationIssue is one machine-readable validation failure.
type WarBlueprintValidationIssue struct {
	Code        WarBlueprintValidationIssueCode `json:"code"`
	Message     string                          `json:"message"`
	SlotID      string                          `json:"slot_id,omitempty"`
	ComponentID string                          `json:"component_id,omitempty"`
	Actual      int                             `json:"actual,omitempty"`
	Limit       int                             `json:"limit,omitempty"`
}

// WarBlueprintValidationResult captures the latest validation outcome for one blueprint.
type WarBlueprintValidationResult struct {
	Valid  bool                         `json:"valid"`
	Limits WarBudgetProfile             `json:"limits,omitempty"`
	Usage  WarBlueprintBudgetUsage      `json:"usage,omitempty"`
	Issues []WarBlueprintValidationIssue `json:"issues,omitempty"`
}

// WarBlueprint is the authoritative mutable blueprint object stored per player.
type WarBlueprint struct {
	ID                 string                       `json:"id"`
	OwnerID            string                       `json:"owner_id,omitempty"`
	Name               string                       `json:"name"`
	Source             WarBlueprintSource           `json:"source"`
	State              WarBlueprintState            `json:"state"`
	Domain             UnitDomain                   `json:"domain"`
	BaseFrameID        string                       `json:"base_frame_id,omitempty"`
	BaseHullID         string                       `json:"base_hull_id,omitempty"`
	ParentBlueprintID  string                       `json:"parent_blueprint_id,omitempty"`
	AllowedVariantSlots []string                    `json:"allowed_variant_slots,omitempty"`
	Components         []WarBlueprintComponentSlot  `json:"components,omitempty"`
	Validation         *WarBlueprintValidationResult `json:"validation,omitempty"`
	CreatedTick        int64                        `json:"created_tick,omitempty"`
	UpdatedTick        int64                        `json:"updated_tick,omitempty"`
}

// WarBlueprintDetailView is the query-facing blueprint detail payload.
type WarBlueprintDetailView struct {
	ID                  string                        `json:"id"`
	OwnerID             string                        `json:"owner_id,omitempty"`
	Name                string                        `json:"name"`
	Source              WarBlueprintSource            `json:"source"`
	State               WarBlueprintState             `json:"state"`
	Domain              UnitDomain                    `json:"domain"`
	BaseFrameID         string                        `json:"base_frame_id,omitempty"`
	BaseHullID          string                        `json:"base_hull_id,omitempty"`
	ParentBlueprintID   string                        `json:"parent_blueprint_id,omitempty"`
	AllowedVariantSlots []string                      `json:"allowed_variant_slots,omitempty"`
	Components          []WarBlueprintComponentSlot   `json:"components,omitempty"`
	Validation          WarBlueprintValidationResult  `json:"validation"`
	AllowedActions      []string                      `json:"allowed_actions,omitempty"`
}

// WarBlueprintListView groups player-owned blueprint summaries.
type WarBlueprintListView struct {
	Blueprints []WarBlueprintDetailView `json:"blueprints"`
}

// WarBlueprintCatalogIndex accelerates lookups for validation and query assembly.
type WarBlueprintCatalogIndex struct {
	baseFrames      map[string]WarBaseFrameCatalogEntry
	baseHulls       map[string]WarBaseHullCatalogEntry
	components      map[string]WarComponentCatalogEntry
	publicBlueprints map[string]WarPublicBlueprintCatalogEntry
}

// NewWarBlueprintCatalogIndex builds a validation/query lookup index.
func NewWarBlueprintCatalogIndex(
	baseFrames []WarBaseFrameCatalogEntry,
	baseHulls []WarBaseHullCatalogEntry,
	components []WarComponentCatalogEntry,
	publicBlueprints []WarPublicBlueprintCatalogEntry,
) WarBlueprintCatalogIndex {
	index := WarBlueprintCatalogIndex{
		baseFrames:      make(map[string]WarBaseFrameCatalogEntry, len(baseFrames)),
		baseHulls:       make(map[string]WarBaseHullCatalogEntry, len(baseHulls)),
		components:      make(map[string]WarComponentCatalogEntry, len(components)),
		publicBlueprints: make(map[string]WarPublicBlueprintCatalogEntry, len(publicBlueprints)),
	}
	for _, entry := range baseFrames {
		index.baseFrames[entry.ID] = cloneWarBaseFrameEntries([]WarBaseFrameCatalogEntry{entry})[0]
	}
	for _, entry := range baseHulls {
		index.baseHulls[entry.ID] = cloneWarBaseHullEntries([]WarBaseHullCatalogEntry{entry})[0]
	}
	for _, entry := range components {
		index.components[entry.ID] = cloneWarComponentEntries([]WarComponentCatalogEntry{entry})[0]
	}
	for _, entry := range publicBlueprints {
		index.publicBlueprints[entry.ID] = cloneWarPublicBlueprintEntry(entry)
	}
	return index
}

// PublicWarBlueprintCatalogIndex returns the immutable public catalog lookup index.
func PublicWarBlueprintCatalogIndex() WarBlueprintCatalogIndex {
	catalog := PublicWarfareCatalog()
	return NewWarBlueprintCatalogIndex(catalog.BaseFrames, catalog.BaseHulls, catalog.Components, catalog.PublicBlueprints)
}

func (idx WarBlueprintCatalogIndex) BaseFrameByID(id string) (WarBaseFrameCatalogEntry, bool) {
	entry, ok := idx.baseFrames[id]
	return entry, ok
}

func (idx WarBlueprintCatalogIndex) BaseHullByID(id string) (WarBaseHullCatalogEntry, bool) {
	entry, ok := idx.baseHulls[id]
	return entry, ok
}

func (idx WarBlueprintCatalogIndex) ComponentByID(id string) (WarComponentCatalogEntry, bool) {
	entry, ok := idx.components[id]
	return entry, ok
}

func (idx WarBlueprintCatalogIndex) PublicBlueprintByID(id string) (WarPublicBlueprintCatalogEntry, bool) {
	entry, ok := idx.publicBlueprints[id]
	return cloneWarPublicBlueprintEntry(entry), ok
}

// PresetWarBlueprintByID materializes one public preset into the common blueprint model.
func PresetWarBlueprintByID(id string) (WarBlueprint, bool) {
	entry, ok := PublicWarBlueprintByID(id)
	if !ok {
		return WarBlueprint{}, false
	}
	return WarBlueprintFromPreset(entry), true
}

// WarBlueprintFromPreset converts a public preset entry into the shared blueprint object.
func WarBlueprintFromPreset(entry WarPublicBlueprintCatalogEntry) WarBlueprint {
	return WarBlueprint{
		ID:          entry.ID,
		Name:        entry.Name,
		Source:      WarBlueprintSourcePreset,
		State:       WarBlueprintStateAdopted,
		Domain:      entry.Domain,
		BaseFrameID: entry.BaseFrameID,
		BaseHullID:  entry.BaseHullID,
		Components:  append([]WarBlueprintComponentSlot(nil), entry.Components...),
	}
}

// ResolveWarBlueprintForPlayer resolves a player-owned blueprint first, then falls back to public presets.
func ResolveWarBlueprintForPlayer(player *PlayerState, id string) (WarBlueprint, bool) {
	if player != nil && player.WarBlueprints != nil {
		if blueprint := player.WarBlueprints[id]; blueprint != nil {
			return *blueprint.Clone(), true
		}
	}
	return PresetWarBlueprintByID(id)
}

// Clone returns a deep copy of the blueprint.
func (bp *WarBlueprint) Clone() *WarBlueprint {
	if bp == nil {
		return nil
	}
	clone := *bp
	clone.AllowedVariantSlots = append([]string(nil), bp.AllowedVariantSlots...)
	clone.Components = append([]WarBlueprintComponentSlot(nil), bp.Components...)
	clone.Validation = cloneWarBlueprintValidationResult(bp.Validation)
	return &clone
}

// ComponentsBySlot returns the installed component ids keyed by slot id.
func (bp *WarBlueprint) ComponentsBySlot() map[string]string {
	out := make(map[string]string, len(bp.Components))
	if bp == nil {
		return out
	}
	for _, component := range bp.Components {
		if component.SlotID == "" || component.ComponentID == "" {
			continue
		}
		out[component.SlotID] = component.ComponentID
	}
	return out
}

// CanEditSlot reports whether the slot is editable on this blueprint.
func (bp *WarBlueprint) CanEditSlot(slotID string) bool {
	if bp == nil || slotID == "" {
		return false
	}
	if len(bp.AllowedVariantSlots) == 0 {
		return true
	}
	return containsWarString(bp.AllowedVariantSlots, slotID)
}

// AllowedActions returns the current authoritative action set for this blueprint state.
func (bp *WarBlueprint) AllowedActions() []string {
	if bp == nil {
		return nil
	}
	if bp.Source == WarBlueprintSourcePreset {
		return []string{"query", "variant"}
	}
	actions := []string{"query"}
	switch bp.State {
	case WarBlueprintStateDraft:
		actions = append(actions, "set_component", "validate")
	case WarBlueprintStateValidated:
		actions = append(actions, "set_component", "validate", "finalize")
	case WarBlueprintStatePrototype, WarBlueprintStateFieldTested:
		actions = append(actions, "finalize", "variant")
	case WarBlueprintStateAdopted:
		actions = append(actions, "variant", "finalize")
	}
	return actions
}

// DefaultFinalizeTarget returns the default promotion target for the current state.
func (bp *WarBlueprint) DefaultFinalizeTarget() WarBlueprintState {
	if bp == nil {
		return ""
	}
	switch bp.State {
	case WarBlueprintStateValidated:
		return WarBlueprintStatePrototype
	case WarBlueprintStatePrototype:
		return WarBlueprintStateFieldTested
	case WarBlueprintStateFieldTested:
		return WarBlueprintStateAdopted
	case WarBlueprintStateAdopted:
		return WarBlueprintStateObsolete
	default:
		return ""
	}
}

// CanTransitionTo reports whether the lifecycle move is allowed.
func (bp *WarBlueprint) CanTransitionTo(target WarBlueprintState) bool {
	if bp == nil {
		return false
	}
	switch bp.State {
	case WarBlueprintStateValidated:
		return target == WarBlueprintStatePrototype
	case WarBlueprintStatePrototype:
		return target == WarBlueprintStateFieldTested || target == WarBlueprintStateObsolete
	case WarBlueprintStateFieldTested:
		return target == WarBlueprintStateAdopted || target == WarBlueprintStateObsolete
	case WarBlueprintStateAdopted:
		return target == WarBlueprintStateObsolete
	default:
		return false
	}
}

// CanCreateVariant reports whether the blueprint can serve as a variant parent.
func (bp *WarBlueprint) CanCreateVariant() bool {
	if bp == nil {
		return false
	}
	if bp.Source == WarBlueprintSourcePreset {
		return true
	}
	switch bp.State {
	case WarBlueprintStatePrototype, WarBlueprintStateFieldTested, WarBlueprintStateAdopted:
		return true
	default:
		return false
	}
}

// ValidateWarBlueprint validates a blueprint against the shared warfare catalog semantics.
func ValidateWarBlueprint(index WarBlueprintCatalogIndex, blueprint WarBlueprint) WarBlueprintValidationResult {
	result := WarBlueprintValidationResult{}
	slotSpecs, limits, ok := blueprint.slotSpecsAndLimits(index)
	result.Limits = limits
	if !ok {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueUnknownBase,
			Message: "blueprint base frame or hull not found",
		})
		return result
	}

	slotByID := make(map[string]WarSlotSpec, len(slotSpecs))
	for _, slot := range slotSpecs {
		slotByID[slot.ID] = slot
	}

	installed := blueprint.ComponentsBySlot()
	for _, slot := range slotSpecs {
		if slot.Required && installed[slot.ID] == "" {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:    WarBlueprintIssueRequiredSlotMissing,
				Message: "required slot missing component",
				SlotID:  slot.ID,
			})
		}
	}

	usage := WarBlueprintBudgetUsage{}
	for _, slot := range blueprint.Components {
		component, componentOK := index.ComponentByID(slot.ComponentID)
		if !componentOK {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:        WarBlueprintIssueUnknownComponent,
				Message:     "component not found in authoritative warfare catalog",
				SlotID:      slot.SlotID,
				ComponentID: slot.ComponentID,
			})
			continue
		}

		usage.PowerOutput += component.PowerOutput
		usage.PowerDraw += component.PowerDraw
		usage.Volume += component.Volume
		usage.Mass += component.Mass
		usage.RigidityLoad += component.RigidityLoad
		usage.HeatLoad += component.HeatLoad
		usage.Maintenance += component.Maintenance
		usage.SignalLoad += component.SignalLoad
		usage.StealthRating += component.StealthRating

		slotSpec, slotOK := slotByID[slot.SlotID]
		if !slotOK || slotSpec.Category != component.Category {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:        WarBlueprintIssueHardpointMismatch,
				Message:     "component category does not match slot hardpoint",
				SlotID:      slot.SlotID,
				ComponentID: slot.ComponentID,
			})
		}
		if !containsUnitDomain(component.SupportedDomains, blueprint.Domain) {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:        WarBlueprintIssueDomainMismatch,
				Message:     "component does not support blueprint domain",
				SlotID:      slot.SlotID,
				ComponentID: slot.ComponentID,
			})
		}
	}
	result.Usage = usage

	if usage.PowerOutput <= 0 || usage.PowerDraw > usage.PowerOutput {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssuePowerBudgetExceeded,
			Message: "component draw exceeds available reactor output",
			Actual:  usage.PowerDraw,
			Limit:   usage.PowerOutput,
		})
	}
	if limits.PeakDraw > 0 && usage.PowerDraw > limits.PeakDraw {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssuePowerBudgetExceeded,
			Message: "component draw exceeds hull peak power budget",
			Actual:  usage.PowerDraw,
			Limit:   limits.PeakDraw,
		})
	}
	if limits.VolumeCapacity > 0 && usage.Volume > limits.VolumeCapacity {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueVolumeBudgetExceeded,
			Message: "component volume exceeds chassis capacity",
			Actual:  usage.Volume,
			Limit:   limits.VolumeCapacity,
		})
	}
	if limits.MassCapacity > 0 && usage.Mass > limits.MassCapacity {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueMassBudgetExceeded,
			Message: "component mass exceeds chassis capacity",
			Actual:  usage.Mass,
			Limit:   limits.MassCapacity,
		})
	}
	if limits.RigidityCapacity > 0 && usage.RigidityLoad > limits.RigidityCapacity {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueRigidityBudgetExceeded,
			Message: "component rigidity load exceeds frame budget",
			Actual:  usage.RigidityLoad,
			Limit:   limits.RigidityCapacity,
		})
	}
	if limits.HeatCapacity > 0 && usage.HeatLoad > limits.HeatCapacity {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueHeatDissipationInsufficient,
			Message: "component heat exceeds dissipation capacity",
			Actual:  usage.HeatLoad,
			Limit:   limits.HeatCapacity,
		})
	}
	if limits.MaintenanceLimit > 0 && usage.Maintenance > limits.MaintenanceLimit {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueMaintenanceBudgetExceeded,
			Message: "component maintenance exceeds chassis sustainment budget",
			Actual:  usage.Maintenance,
			Limit:   limits.MaintenanceLimit,
		})
	}
	netSignature := usage.SignalLoad - usage.StealthRating
	if netSignature < 0 {
		netSignature = 0
	}
	if limits.SignalCapacity > 0 && netSignature > limits.SignalCapacity {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueSignatureBudgetExceeded,
			Message: "component signal profile exceeds signature budget",
			Actual:  netSignature,
			Limit:   limits.SignalCapacity,
		})
	}

	result.Valid = len(result.Issues) == 0
	return result
}

func (bp *WarBlueprint) slotSpecsAndLimits(index WarBlueprintCatalogIndex) ([]WarSlotSpec, WarBudgetProfile, bool) {
	if bp == nil {
		return nil, WarBudgetProfile{}, false
	}
	if bp.BaseFrameID != "" {
		frame, ok := index.BaseFrameByID(bp.BaseFrameID)
		if !ok {
			return nil, WarBudgetProfile{}, false
		}
		if !containsUnitDomain(frame.SupportedDomains, bp.Domain) {
			return frame.Slots, frame.Budgets, true
		}
		return frame.Slots, frame.Budgets, true
	}
	if bp.BaseHullID != "" {
		hull, ok := index.BaseHullByID(bp.BaseHullID)
		if !ok {
			return nil, WarBudgetProfile{}, false
		}
		if !containsUnitDomain(hull.SupportedDomains, bp.Domain) {
			return hull.Slots, hull.Budgets, true
		}
		return hull.Slots, hull.Budgets, true
	}
	return nil, WarBudgetProfile{}, false
}

func cloneWarBlueprintValidationResult(result *WarBlueprintValidationResult) *WarBlueprintValidationResult {
	if result == nil {
		return nil
	}
	clone := *result
	clone.Issues = append([]WarBlueprintValidationIssue(nil), result.Issues...)
	return &clone
}

func containsUnitDomain(domains []UnitDomain, target UnitDomain) bool {
	if len(domains) == 0 || target == "" {
		return false
	}
	for _, domain := range domains {
		if domain == target {
			return true
		}
	}
	return false
}

func containsWarString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
