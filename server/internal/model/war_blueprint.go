package model

import (
	"fmt"
	"sort"
)

// WarBlueprintStatus captures the lifecycle of a war blueprint.
type WarBlueprintStatus string

const (
	WarBlueprintStatusDraft       WarBlueprintStatus = "draft"
	WarBlueprintStatusValidated   WarBlueprintStatus = "validated"
	WarBlueprintStatusPrototype   WarBlueprintStatus = "prototype"
	WarBlueprintStatusFieldTested WarBlueprintStatus = "field_tested"
	WarBlueprintStatusAdopted     WarBlueprintStatus = "adopted"
	WarBlueprintStatusObsolete    WarBlueprintStatus = "obsolete"
)

// WarBlueprintIssueCode describes one structured validation or edit failure.
type WarBlueprintIssueCode string

const (
	WarBlueprintIssueBaseNotFound                  WarBlueprintIssueCode = "base_not_found"
	WarBlueprintIssueUnknownSlot                   WarBlueprintIssueCode = "unknown_slot"
	WarBlueprintIssueUnknownComponent              WarBlueprintIssueCode = "unknown_component"
	WarBlueprintIssueRequiredSlotMissing           WarBlueprintIssueCode = "required_slot_missing"
	WarBlueprintIssueComponentDomainMismatch       WarBlueprintIssueCode = "component_domain_mismatch"
	WarBlueprintIssueHardpointMismatch             WarBlueprintIssueCode = "hardpoint_mismatch"
	WarBlueprintIssuePowerBudgetExceeded           WarBlueprintIssueCode = "power_budget_exceeded"
	WarBlueprintIssueVolumeBudgetExceeded          WarBlueprintIssueCode = "volume_budget_exceeded"
	WarBlueprintIssueMassBudgetExceeded            WarBlueprintIssueCode = "mass_budget_exceeded"
	WarBlueprintIssueRigidityBudgetExceeded        WarBlueprintIssueCode = "rigidity_budget_exceeded"
	WarBlueprintIssueHeatDissipationInsufficient   WarBlueprintIssueCode = "heat_dissipation_insufficient"
	WarBlueprintIssueSignalSignatureExceeded       WarBlueprintIssueCode = "signal_signature_exceeded"
	WarBlueprintIssueMaintenanceBudgetExceeded     WarBlueprintIssueCode = "maintenance_budget_exceeded"
	WarBlueprintIssueVariantSlotLocked             WarBlueprintIssueCode = "variant_slot_locked"
	WarBlueprintIssueVariantParentStatusDisallowed WarBlueprintIssueCode = "variant_parent_status_disallowed"
)

// WarBlueprintValidationIssue is a stable, testable validation issue payload.
type WarBlueprintValidationIssue struct {
	Code        WarBlueprintIssueCode `json:"code"`
	SlotID      string                `json:"slot_id,omitempty"`
	ComponentID string                `json:"component_id,omitempty"`
	Limit       int                   `json:"limit,omitempty"`
	Actual      int                   `json:"actual,omitempty"`
	Message     string                `json:"message,omitempty"`
}

// WarBlueprintUsage captures aggregate blueprint budgets after validation.
type WarBlueprintUsage struct {
	PowerSupply     int `json:"power_supply"`
	PowerDemand     int `json:"power_demand"`
	Volume          int `json:"volume"`
	Mass            int `json:"mass"`
	Rigidity        int `json:"rigidity"`
	HeatGeneration  int `json:"heat_generation"`
	HeatDissipation int `json:"heat_dissipation"`
	SignalSignature int `json:"signal_signature"`
	Stealth         int `json:"stealth"`
	SignalExposure  int `json:"signal_exposure"`
	Maintenance     int `json:"maintenance"`
}

// WarBlueprintValidationResult captures the most recent blueprint validation.
type WarBlueprintValidationResult struct {
	Valid  bool                          `json:"valid"`
	Usage  WarBlueprintUsage             `json:"usage"`
	Issues []WarBlueprintValidationIssue `json:"issues,omitempty"`
}

// WarBlueprintDefinition is the authoritative stored blueprint object.
type WarBlueprintDefinition struct {
	ID                string                        `json:"id"`
	Name              string                        `json:"name"`
	OwnerID           string                        `json:"owner_id,omitempty"`
	Source            WarBlueprintSource            `json:"source"`
	ParentBlueprintID string                        `json:"parent_blueprint_id,omitempty"`
	ParentSource      WarBlueprintSource            `json:"parent_source,omitempty"`
	Domain            UnitDomain                    `json:"domain"`
	RuntimeClass      UnitRuntimeClass              `json:"runtime_class"`
	VisibleTechID     string                        `json:"visible_tech_id,omitempty"`
	BaseFrameID       string                        `json:"base_frame_id,omitempty"`
	BaseHullID        string                        `json:"base_hull_id,omitempty"`
	Status            WarBlueprintStatus            `json:"status"`
	SlotAssignments   map[string]string             `json:"slot_assignments,omitempty"`
	ModifiableSlots   []string                      `json:"modifiable_slots,omitempty"`
	LastValidation    *WarBlueprintValidationResult `json:"last_validation,omitempty"`
}

type warBlueprintSlotSpec struct {
	ID               string
	AllowedSlotTypes map[string]struct{}
	Required         bool
}

type warBlueprintBaseSpec struct {
	ID                string
	Domain            UnitDomain
	RuntimeClass      UnitRuntimeClass
	VisibleTechID     string
	VolumeBudget      int
	MassBudget        int
	RigidityBudget    int
	SignalBudget      int
	MaintenanceBudget int
	Slots             []warBlueprintSlotSpec
}

type warComponentTuning struct {
	PowerSupply     int
	PowerDemand     int
	Volume          int
	Mass            int
	Rigidity        int
	HeatGeneration  int
	HeatDissipation int
	SignalSignature int
	Stealth         int
	Maintenance     int
}

var warBlueprintBaseSpecs = map[string]warBlueprintBaseSpec{
	"light_frame": {
		ID:                "light_frame",
		Domain:            UnitDomainGround,
		RuntimeClass:      UnitRuntimeClassCombatSquad,
		VisibleTechID:     "prototype",
		VolumeBudget:      100,
		MassBudget:        100,
		RigidityBudget:    80,
		SignalBudget:      60,
		MaintenanceBudget: 70,
		Slots:             standardGroundBlueprintSlots(),
	},
	"aerial_frame": {
		ID:                "aerial_frame",
		Domain:            UnitDomainAir,
		RuntimeClass:      UnitRuntimeClassCombatSquad,
		VisibleTechID:     "precision_drone",
		VolumeBudget:      90,
		MassBudget:        70,
		RigidityBudget:    50,
		SignalBudget:      60,
		MaintenanceBudget: 60,
		Slots:             standardGroundBlueprintSlots(),
	},
	"corvette_hull": {
		ID:                "corvette_hull",
		Domain:            UnitDomainSpace,
		RuntimeClass:      UnitRuntimeClassFleet,
		VisibleTechID:     "corvette",
		VolumeBudget:      160,
		MassBudget:        180,
		RigidityBudget:    140,
		SignalBudget:      70,
		MaintenanceBudget: 100,
		Slots:             standardSpaceBlueprintSlots(),
	},
	"destroyer_hull": {
		ID:                "destroyer_hull",
		Domain:            UnitDomainSpace,
		RuntimeClass:      UnitRuntimeClassFleet,
		VisibleTechID:     "destroyer",
		VolumeBudget:      220,
		MassBudget:        260,
		RigidityBudget:    200,
		SignalBudget:      85,
		MaintenanceBudget: 130,
		Slots:             standardSpaceBlueprintSlots(),
	},
}

var warComponentTunings = map[string]warComponentTuning{
	"compact_reactor": {
		PowerSupply:     90,
		Volume:          10,
		Mass:            10,
		Rigidity:        5,
		HeatGeneration:  12,
		HeatDissipation: 28,
		SignalSignature: 12,
		Maintenance:     8,
	},
	"micro_fusion_core": {
		PowerSupply:     140,
		Volume:          14,
		Mass:            15,
		Rigidity:        6,
		HeatGeneration:  20,
		HeatDissipation: 40,
		SignalSignature: 15,
		Maintenance:     10,
	},
	"servo_actuator_pack": {
		PowerDemand:     18,
		Volume:          14,
		Mass:            12,
		Rigidity:        14,
		HeatGeneration:  10,
		HeatDissipation: 8,
		SignalSignature: 6,
		Maintenance:     10,
	},
	"vector_thruster_pack": {
		PowerDemand:     22,
		Volume:          12,
		Mass:            8,
		Rigidity:        10,
		HeatGeneration:  12,
		HeatDissipation: 10,
		SignalSignature: 8,
		Stealth:         4,
		Maintenance:     9,
	},
	"ion_drive_cluster": {
		PowerDemand:     30,
		Volume:          20,
		Mass:            18,
		Rigidity:        20,
		HeatGeneration:  15,
		HeatDissipation: 18,
		SignalSignature: 8,
		Maintenance:     12,
	},
	"composite_armor_plating": {
		PowerDemand:     6,
		Volume:          18,
		Mass:            20,
		Rigidity:        18,
		HeatGeneration:  4,
		HeatDissipation: 6,
		SignalSignature: 4,
		Maintenance:     12,
	},
	"deflector_shield_array": {
		PowerDemand:     18,
		Volume:          16,
		Mass:            12,
		Rigidity:        10,
		HeatGeneration:  8,
		HeatDissipation: 12,
		SignalSignature: 9,
		Maintenance:     10,
	},
	"battlefield_sensor_suite": {
		PowerDemand:     8,
		Volume:          10,
		Mass:            7,
		Rigidity:        6,
		HeatGeneration:  8,
		HeatDissipation: 10,
		SignalSignature: 16,
		Maintenance:     8,
	},
	"deep_space_radar": {
		PowerDemand:     12,
		Volume:          14,
		Mass:            9,
		Rigidity:        8,
		HeatGeneration:  10,
		HeatDissipation: 12,
		SignalSignature: 20,
		Maintenance:     10,
	},
	"pulse_laser_mount": {
		PowerDemand:     20,
		Volume:          12,
		Mass:            11,
		Rigidity:        12,
		HeatGeneration:  15,
		HeatDissipation: 4,
		SignalSignature: 7,
		Maintenance:     12,
	},
	"micro_missile_rack": {
		PowerDemand:     24,
		Volume:          14,
		Mass:            9,
		Rigidity:        10,
		HeatGeneration:  14,
		HeatDissipation: 6,
		SignalSignature: 10,
		Maintenance:     11,
	},
	"coilgun_battery": {
		PowerDemand:     35,
		Volume:          18,
		Mass:            18,
		Rigidity:        18,
		HeatGeneration:  20,
		HeatDissipation: 6,
		SignalSignature: 9,
		Maintenance:     16,
	},
	"command_uplink": {
		PowerDemand:     6,
		Volume:          8,
		Mass:            5,
		Rigidity:        4,
		HeatGeneration:  6,
		HeatDissipation: 10,
		SignalSignature: 10,
		Stealth:         4,
		Maintenance:     8,
	},
	"repair_drone_bay": {
		PowerDemand:     14,
		Volume:          16,
		Mass:            14,
		Rigidity:        12,
		HeatGeneration:  10,
		HeatDissipation: 18,
		SignalSignature: 6,
		Maintenance:     14,
	},
}

func standardGroundBlueprintSlots() []warBlueprintSlotSpec {
	return []warBlueprintSlotSpec{
		newWarBlueprintSlotSpec("power", true, "power_core"),
		newWarBlueprintSlotSpec("mobility", true, "mobility"),
		newWarBlueprintSlotSpec("defense", true, "armor", "shield"),
		newWarBlueprintSlotSpec("sensor", true, "sensor"),
		newWarBlueprintSlotSpec("primary_weapon", true, "primary_weapon"),
		newWarBlueprintSlotSpec("utility", true, "utility"),
	}
}

func standardSpaceBlueprintSlots() []warBlueprintSlotSpec {
	return []warBlueprintSlotSpec{
		newWarBlueprintSlotSpec("power", true, "power_core"),
		newWarBlueprintSlotSpec("engine", true, "engine"),
		newWarBlueprintSlotSpec("defense", true, "armor", "shield"),
		newWarBlueprintSlotSpec("sensor", true, "sensor"),
		newWarBlueprintSlotSpec("primary_weapon", true, "primary_weapon"),
		newWarBlueprintSlotSpec("utility", true, "utility"),
	}
}

func newWarBlueprintSlotSpec(id string, required bool, slotTypes ...string) warBlueprintSlotSpec {
	allowed := make(map[string]struct{}, len(slotTypes))
	for _, slotType := range slotTypes {
		allowed[slotType] = struct{}{}
	}
	return warBlueprintSlotSpec{
		ID:               id,
		AllowedSlotTypes: allowed,
		Required:         required,
	}
}

// EnsureWarBlueprints returns the writable blueprint store for a player.
func (ps *PlayerState) EnsureWarBlueprints() map[string]*WarBlueprintDefinition {
	if ps == nil {
		return nil
	}
	if ps.WarBlueprints == nil {
		ps.WarBlueprints = make(map[string]*WarBlueprintDefinition)
	}
	return ps.WarBlueprints
}

// Clone returns a deep copy of the blueprint definition.
func (bp WarBlueprintDefinition) Clone() WarBlueprintDefinition {
	if len(bp.SlotAssignments) > 0 {
		assignments := make(map[string]string, len(bp.SlotAssignments))
		for slotID, componentID := range bp.SlotAssignments {
			assignments[slotID] = componentID
		}
		bp.SlotAssignments = assignments
	}
	if len(bp.ModifiableSlots) > 0 {
		bp.ModifiableSlots = append([]string(nil), bp.ModifiableSlots...)
	}
	if bp.LastValidation != nil {
		copyValidation := bp.LastValidation.Clone()
		bp.LastValidation = &copyValidation
	}
	return bp
}

// Clone returns a deep copy of the validation result.
func (vr WarBlueprintValidationResult) Clone() WarBlueprintValidationResult {
	if len(vr.Issues) > 0 {
		vr.Issues = append([]WarBlueprintValidationIssue(nil), vr.Issues...)
	}
	return vr
}

// BaseID returns the selected chassis ID regardless of domain.
func (bp WarBlueprintDefinition) BaseID() string {
	if bp.BaseFrameID != "" {
		return bp.BaseFrameID
	}
	return bp.BaseHullID
}

// ApplyComponent installs or replaces one slot assignment.
func (bp *WarBlueprintDefinition) ApplyComponent(slotID, componentID string) error {
	if bp == nil {
		return fmt.Errorf("blueprint is nil")
	}
	baseSpec, ok := warBlueprintBaseSpecForID(bp.BaseID())
	if !ok {
		return fmt.Errorf("blueprint base %s not found", bp.BaseID())
	}
	if _, ok := baseSpec.slotSpec(slotID); !ok {
		return fmt.Errorf("slot %s not found on base %s", slotID, baseSpec.ID)
	}
	if bp.ParentBlueprintID != "" && !sliceContains(bp.ModifiableSlots, slotID) {
		return fmt.Errorf("%s", WarBlueprintIssueVariantSlotLocked)
	}
	if _, ok := warComponentCatalogEntryByID(componentID); !ok {
		return fmt.Errorf("component %s not found", componentID)
	}
	if bp.SlotAssignments == nil {
		bp.SlotAssignments = make(map[string]string)
	}
	bp.SlotAssignments[slotID] = componentID
	return nil
}

// NewPlayerWarBlueprintDraft creates a new player-owned blueprint draft for a base frame or hull.
func NewPlayerWarBlueprintDraft(ownerID, blueprintID, name, baseID string) (*WarBlueprintDefinition, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("owner_id required")
	}
	if blueprintID == "" {
		return nil, fmt.Errorf("blueprint_id required")
	}
	if name == "" {
		return nil, fmt.Errorf("name required")
	}
	baseSpec, ok := warBlueprintBaseSpecForID(baseID)
	if !ok {
		return nil, fmt.Errorf("base %s not found", baseID)
	}
	blueprint := &WarBlueprintDefinition{
		ID:              blueprintID,
		Name:            name,
		OwnerID:         ownerID,
		Source:          WarBlueprintSourcePlayer,
		Domain:          baseSpec.Domain,
		RuntimeClass:    baseSpec.RuntimeClass,
		VisibleTechID:   baseSpec.VisibleTechID,
		Status:          WarBlueprintStatusDraft,
		SlotAssignments: make(map[string]string),
	}
	if _, ok := baseFrameCatalogEntryByID(baseID); ok {
		blueprint.BaseFrameID = baseID
	} else {
		blueprint.BaseHullID = baseID
	}
	return blueprint, nil
}

// CreateWarBlueprintVariant creates a controlled child variant from a validated or preset parent.
func CreateWarBlueprintVariant(ownerID, blueprintID, name string, parent WarBlueprintDefinition) (*WarBlueprintDefinition, error) {
	if !WarBlueprintVariantParentAllowed(parent.Status) {
		return nil, fmt.Errorf("%s", WarBlueprintIssueVariantParentStatusDisallowed)
	}
	child, err := NewPlayerWarBlueprintDraft(ownerID, blueprintID, name, parent.BaseID())
	if err != nil {
		return nil, err
	}
	child.ParentBlueprintID = parent.ID
	child.ParentSource = parent.Source
	child.SlotAssignments = make(map[string]string, len(parent.SlotAssignments))
	for slotID, componentID := range parent.SlotAssignments {
		child.SlotAssignments[slotID] = componentID
	}
	child.ModifiableSlots = variantModifiableSlots(parent.BaseID())
	return child, nil
}

// PublicWarBlueprintDefinitionByID converts a preset catalog blueprint into the same authoritative definition.
func PublicWarBlueprintDefinitionByID(id string) (WarBlueprintDefinition, bool) {
	entry, ok := PublicWarBlueprintByID(id)
	if !ok {
		return WarBlueprintDefinition{}, false
	}
	bp, err := warBlueprintDefinitionFromPublic(entry)
	if err != nil {
		return WarBlueprintDefinition{}, false
	}
	return bp, true
}

// PublicWarComponentByID returns one public war component catalog entry.
func PublicWarComponentByID(id string) (WarComponentCatalogEntry, bool) {
	entry, ok := warComponentCatalogEntryByID(id)
	if !ok || !entry.Public {
		return WarComponentCatalogEntry{}, false
	}
	return entry, true
}

// ValidateWarBlueprint evaluates one blueprint definition using the shared authoritative rules.
func ValidateWarBlueprint(bp WarBlueprintDefinition) WarBlueprintValidationResult {
	result := WarBlueprintValidationResult{}
	baseSpec, ok := warBlueprintBaseSpecForID(bp.BaseID())
	if !ok {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueBaseNotFound,
			Message: fmt.Sprintf("base %s not found", bp.BaseID()),
		})
		return result
	}
	if len(baseSpec.Slots) == 0 {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueBaseNotFound,
			Message: fmt.Sprintf("base %s exposes no slots", bp.BaseID()),
		})
		return result
	}

	for _, slot := range baseSpec.Slots {
		componentID, assigned := bp.SlotAssignments[slot.ID]
		if slot.Required && !assigned {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:    WarBlueprintIssueRequiredSlotMissing,
				SlotID:  slot.ID,
				Message: fmt.Sprintf("slot %s must be assigned", slot.ID),
			})
			continue
		}
		if !assigned {
			continue
		}
		component, ok := warComponentCatalogEntryByID(componentID)
		if !ok {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:        WarBlueprintIssueUnknownComponent,
				SlotID:      slot.ID,
				ComponentID: componentID,
				Message:     fmt.Sprintf("component %s not found", componentID),
			})
			continue
		}
		tuning := warComponentTunings[componentID]
		result.Usage.PowerSupply += tuning.PowerSupply
		result.Usage.PowerDemand += tuning.PowerDemand
		result.Usage.Volume += tuning.Volume
		result.Usage.Mass += tuning.Mass
		result.Usage.Rigidity += tuning.Rigidity
		result.Usage.HeatGeneration += tuning.HeatGeneration
		result.Usage.HeatDissipation += tuning.HeatDissipation
		result.Usage.SignalSignature += tuning.SignalSignature
		result.Usage.Stealth += tuning.Stealth
		result.Usage.Maintenance += tuning.Maintenance

		if !componentSupportsDomain(component, bp.Domain) {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:        WarBlueprintIssueComponentDomainMismatch,
				SlotID:      slot.ID,
				ComponentID: componentID,
				Message:     fmt.Sprintf("component %s does not support domain %s", componentID, bp.Domain),
			})
		}
		if _, ok := slot.AllowedSlotTypes[component.SlotType]; !ok {
			result.Issues = append(result.Issues, WarBlueprintValidationIssue{
				Code:        WarBlueprintIssueHardpointMismatch,
				SlotID:      slot.ID,
				ComponentID: componentID,
				Message:     fmt.Sprintf("component %s cannot be mounted on slot %s", componentID, slot.ID),
			})
		}
	}

	result.Usage.SignalExposure = result.Usage.SignalSignature - result.Usage.Stealth
	if result.Usage.SignalExposure < 0 {
		result.Usage.SignalExposure = 0
	}

	if result.Usage.PowerDemand > result.Usage.PowerSupply {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssuePowerBudgetExceeded,
			Limit:   result.Usage.PowerSupply,
			Actual:  result.Usage.PowerDemand,
			Message: "power demand exceeds available supply",
		})
	}
	if result.Usage.Volume > baseSpec.VolumeBudget {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueVolumeBudgetExceeded,
			Limit:   baseSpec.VolumeBudget,
			Actual:  result.Usage.Volume,
			Message: "volume usage exceeds base budget",
		})
	}
	if result.Usage.Mass > baseSpec.MassBudget {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueMassBudgetExceeded,
			Limit:   baseSpec.MassBudget,
			Actual:  result.Usage.Mass,
			Message: "mass usage exceeds base budget",
		})
	}
	if result.Usage.Rigidity > baseSpec.RigidityBudget {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueRigidityBudgetExceeded,
			Limit:   baseSpec.RigidityBudget,
			Actual:  result.Usage.Rigidity,
			Message: "rigidity usage exceeds base budget",
		})
	}
	if result.Usage.HeatGeneration > result.Usage.HeatDissipation {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueHeatDissipationInsufficient,
			Limit:   result.Usage.HeatDissipation,
			Actual:  result.Usage.HeatGeneration,
			Message: "heat generation exceeds dissipation",
		})
	}
	if result.Usage.SignalExposure > baseSpec.SignalBudget {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueSignalSignatureExceeded,
			Limit:   baseSpec.SignalBudget,
			Actual:  result.Usage.SignalExposure,
			Message: "signal exposure exceeds chassis signature budget",
		})
	}
	if result.Usage.Maintenance > baseSpec.MaintenanceBudget {
		result.Issues = append(result.Issues, WarBlueprintValidationIssue{
			Code:    WarBlueprintIssueMaintenanceBudgetExceeded,
			Limit:   baseSpec.MaintenanceBudget,
			Actual:  result.Usage.Maintenance,
			Message: "maintenance burden exceeds chassis budget",
		})
	}

	sort.Slice(result.Issues, func(i, j int) bool {
		if result.Issues[i].Code != result.Issues[j].Code {
			return result.Issues[i].Code < result.Issues[j].Code
		}
		if result.Issues[i].SlotID != result.Issues[j].SlotID {
			return result.Issues[i].SlotID < result.Issues[j].SlotID
		}
		return result.Issues[i].ComponentID < result.Issues[j].ComponentID
	})
	result.Valid = len(result.Issues) == 0
	return result
}

// WarBlueprintEditable reports whether a blueprint can still be edited in-place.
func WarBlueprintEditable(status WarBlueprintStatus) bool {
	return status == WarBlueprintStatusDraft || status == WarBlueprintStatusValidated
}

// WarBlueprintVariantParentAllowed reports whether a blueprint can be used as a parent variant source.
func WarBlueprintVariantParentAllowed(status WarBlueprintStatus) bool {
	return status == WarBlueprintStatusPrototype || status == WarBlueprintStatusFieldTested || status == WarBlueprintStatusAdopted
}

// WarBlueprintCanTransition reports whether a manual lifecycle transition is legal.
func WarBlueprintCanTransition(current, target WarBlueprintStatus) bool {
	switch current {
	case WarBlueprintStatusPrototype:
		return target == WarBlueprintStatusFieldTested || target == WarBlueprintStatusObsolete
	case WarBlueprintStatusFieldTested:
		return target == WarBlueprintStatusAdopted || target == WarBlueprintStatusObsolete
	case WarBlueprintStatusAdopted:
		return target == WarBlueprintStatusObsolete
	default:
		return false
	}
}

// ParseWarBlueprintStatus validates and parses a lifecycle status string.
func ParseWarBlueprintStatus(raw string) (WarBlueprintStatus, bool) {
	status := WarBlueprintStatus(raw)
	switch status {
	case WarBlueprintStatusDraft,
		WarBlueprintStatusValidated,
		WarBlueprintStatusPrototype,
		WarBlueprintStatusFieldTested,
		WarBlueprintStatusAdopted,
		WarBlueprintStatusObsolete:
		return status, true
	default:
		return "", false
	}
}

// CloneWarBlueprintMap returns a deep copy of a player blueprint store.
func CloneWarBlueprintMap(src map[string]*WarBlueprintDefinition) map[string]*WarBlueprintDefinition {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]*WarBlueprintDefinition, len(src))
	for id, blueprint := range src {
		if blueprint == nil {
			continue
		}
		copyBlueprint := blueprint.Clone()
		out[id] = &copyBlueprint
	}
	return out
}

func componentSupportsDomain(component WarComponentCatalogEntry, domain UnitDomain) bool {
	for _, supported := range component.Domains {
		if supported == domain {
			return true
		}
	}
	return false
}

func warBlueprintBaseSpecForID(id string) (warBlueprintBaseSpec, bool) {
	spec, ok := warBlueprintBaseSpecs[id]
	return spec, ok
}

func (spec warBlueprintBaseSpec) slotSpec(slotID string) (warBlueprintSlotSpec, bool) {
	for _, slot := range spec.Slots {
		if slot.ID == slotID {
			return slot, true
		}
	}
	return warBlueprintSlotSpec{}, false
}

func warComponentCatalogEntryByID(id string) (WarComponentCatalogEntry, bool) {
	for _, entry := range warComponentCatalogEntries {
		if entry.ID == id {
			return cloneWarComponentCatalogEntry(entry), true
		}
	}
	return WarComponentCatalogEntry{}, false
}

func baseFrameCatalogEntryByID(id string) (BaseFrameCatalogEntry, bool) {
	for _, entry := range baseFrameCatalogEntries {
		if entry.ID == id {
			return cloneBaseFrameCatalogEntry(entry), true
		}
	}
	return BaseFrameCatalogEntry{}, false
}

func baseHullCatalogEntryByID(id string) (BaseHullCatalogEntry, bool) {
	for _, entry := range baseHullCatalogEntries {
		if entry.ID == id {
			return cloneBaseHullCatalogEntry(entry), true
		}
	}
	return BaseHullCatalogEntry{}, false
}

func warBlueprintDefinitionFromPublic(entry PublicBlueprintCatalogEntry) (WarBlueprintDefinition, error) {
	baseSpec, ok := warBlueprintBaseSpecForID(entry.BaseFrameID)
	if !ok && entry.BaseHullID != "" {
		baseSpec, ok = warBlueprintBaseSpecForID(entry.BaseHullID)
	}
	if !ok {
		return WarBlueprintDefinition{}, fmt.Errorf("public blueprint %s references unknown base", entry.ID)
	}
	slotAssignments := make(map[string]string, len(entry.ComponentIDs))
	for _, componentID := range entry.ComponentIDs {
		component, ok := warComponentCatalogEntryByID(componentID)
		if !ok {
			return WarBlueprintDefinition{}, fmt.Errorf("public blueprint %s references unknown component %s", entry.ID, componentID)
		}
		slotID := logicalSlotIDForComponent(component.SlotType)
		if slotID == "" {
			return WarBlueprintDefinition{}, fmt.Errorf("component %s has unmapped slot type %s", componentID, component.SlotType)
		}
		if _, exists := slotAssignments[slotID]; exists {
			return WarBlueprintDefinition{}, fmt.Errorf("public blueprint %s duplicates slot %s", entry.ID, slotID)
		}
		slotAssignments[slotID] = componentID
	}
	return WarBlueprintDefinition{
		ID:              entry.ID,
		Name:            entry.Name,
		Source:          entry.Source,
		Domain:          baseSpec.Domain,
		RuntimeClass:    entry.RuntimeClass,
		VisibleTechID:   entry.VisibleTechID,
		BaseFrameID:     entry.BaseFrameID,
		BaseHullID:      entry.BaseHullID,
		Status:          WarBlueprintStatusAdopted,
		SlotAssignments: slotAssignments,
	}, nil
}

func logicalSlotIDForComponent(slotType string) string {
	switch slotType {
	case "power_core":
		return "power"
	case "mobility":
		return "mobility"
	case "engine":
		return "engine"
	case "armor", "shield":
		return "defense"
	case "sensor":
		return "sensor"
	case "primary_weapon":
		return "primary_weapon"
	case "utility":
		return "utility"
	default:
		return ""
	}
}

func variantModifiableSlots(baseID string) []string {
	baseSpec, ok := warBlueprintBaseSpecForID(baseID)
	if !ok {
		return nil
	}
	allowed := map[string]struct{}{
		"defense":        {},
		"sensor":         {},
		"primary_weapon": {},
		"utility":        {},
	}
	out := make([]string, 0, len(allowed))
	for _, slot := range baseSpec.Slots {
		if _, ok := allowed[slot.ID]; ok {
			out = append(out, slot.ID)
		}
	}
	sort.Strings(out)
	return out
}

func sliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
