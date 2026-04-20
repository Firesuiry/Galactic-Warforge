package model

import "math"

type SensorContactLevel string

const (
	SensorContactLevelUnknownSignal     SensorContactLevel = "unknown_signal"
	SensorContactLevelClassifiedContact SensorContactLevel = "classified_contact"
	SensorContactLevelConfirmedType     SensorContactLevel = "confirmed_type"
	SensorContactLevelFullyResolved     SensorContactLevel = "fully_resolved"
)

type SensorContactScope string

const (
	SensorContactScopePlanet SensorContactScope = "planet"
	SensorContactScopeSystem SensorContactScope = "system"
)

type SensorContactKind string

const (
	SensorContactKindEnemyForce   SensorContactKind = "enemy_force"
	SensorContactKindFleet        SensorContactKind = "fleet"
	SensorContactKindFalseContact SensorContactKind = "false_contact"
)

type SensorSourceType string

const (
	SensorSourceVision      SensorSourceType = "vision"
	SensorSourceActiveRadar SensorSourceType = "active_radar"
	SensorSourcePassiveEM   SensorSourceType = "passive_em"
	SensorSourceInfrared    SensorSourceType = "infrared"
	SensorSourceSignalTower SensorSourceType = "signal_tower"
	SensorSourceReconUnit   SensorSourceType = "recon_unit"
)

type SensorContactSourceInput struct {
	SourceType SensorSourceType `json:"source_type"`
	SourceID   string           `json:"source_id"`
	SourceKind string           `json:"source_kind,omitempty"`
	Strength   float64          `json:"strength,omitempty"`
}

type SensorContactSource struct {
	SourceType SensorSourceType `json:"source_type"`
	SourceID   string           `json:"source_id"`
	SourceKind string           `json:"source_kind,omitempty"`
	Strength   float64          `json:"strength,omitempty"`
}

type SensorContactTargetProfile struct {
	Classification   string  `json:"classification,omitempty"`
	ResolvedType     string  `json:"resolved_type,omitempty"`
	StrengthEstimate int     `json:"strength_estimate,omitempty"`
	SignalSignature  float64 `json:"signal_signature,omitempty"`
	HeatSignature    float64 `json:"heat_signature,omitempty"`
	StealthRating    float64 `json:"stealth_rating,omitempty"`
	JammingStrength  float64 `json:"jamming_strength,omitempty"`
	ThreatLevel      float64 `json:"threat_level,omitempty"`
}

type SensorContactEvaluation struct {
	ScopeType       SensorContactScope         `json:"scope_type"`
	ScopeID         string                     `json:"scope_id"`
	ContactKind     SensorContactKind          `json:"contact_kind"`
	EntityID        string                     `json:"entity_id,omitempty"`
	EntityType      string                     `json:"entity_type,omitempty"`
	Domain          UnitDomain                 `json:"domain,omitempty"`
	PlanetID        string                     `json:"planet_id,omitempty"`
	SystemID        string                     `json:"system_id,omitempty"`
	Position        *Position                  `json:"position,omitempty"`
	LastUpdated     int64                      `json:"last_updated"`
	DistancePenalty float64                    `json:"distance_penalty,omitempty"`
	Target          SensorContactTargetProfile `json:"target"`
	Sources         []SensorContactSourceInput `json:"sources,omitempty"`
}

type SensorContact struct {
	ID               string                `json:"id"`
	ScopeType        SensorContactScope    `json:"scope_type"`
	ScopeID          string                `json:"scope_id"`
	ContactKind      SensorContactKind     `json:"contact_kind"`
	EntityID         string                `json:"entity_id,omitempty"`
	EntityType       string                `json:"entity_type,omitempty"`
	Domain           UnitDomain            `json:"domain,omitempty"`
	PlanetID         string                `json:"planet_id,omitempty"`
	SystemID         string                `json:"system_id,omitempty"`
	Position         *Position             `json:"position,omitempty"`
	Level            SensorContactLevel    `json:"level"`
	Classification   string                `json:"classification,omitempty"`
	ConfirmedType    string                `json:"confirmed_type,omitempty"`
	StrengthEstimate int                   `json:"strength_estimate,omitempty"`
	ThreatLevel      float64               `json:"threat_level,omitempty"`
	LastUpdatedTick  int64                 `json:"last_updated_tick"`
	SignalStrength   float64               `json:"signal_strength,omitempty"`
	LockQuality      float64               `json:"lock_quality,omitempty"`
	JammingPenalty   float64               `json:"jamming_penalty,omitempty"`
	MissileDriftRisk float64               `json:"missile_drift_risk,omitempty"`
	FalseContact     bool                  `json:"false_contact,omitempty"`
	Sources          []SensorContactSource `json:"sources,omitempty"`
}

type SensorContactState struct {
	PlayerID  string                    `json:"player_id"`
	ScopeType SensorContactScope        `json:"scope_type"`
	ScopeID   string                    `json:"scope_id"`
	Contacts  map[string]*SensorContact `json:"contacts,omitempty"`
}

type WarSensorProfile struct {
	ActiveRadar     float64 `json:"active_radar,omitempty"`
	PassiveEM       float64 `json:"passive_em,omitempty"`
	Infrared        float64 `json:"infrared,omitempty"`
	SignalSupport   float64 `json:"signal_support,omitempty"`
	ReconStrength   float64 `json:"recon_strength,omitempty"`
	JammingStrength float64 `json:"jamming_strength,omitempty"`
	StealthRating   float64 `json:"stealth_rating,omitempty"`
	SignalSignature float64 `json:"signal_signature,omitempty"`
	HeatSignature   float64 `json:"heat_signature,omitempty"`
}

func SensorContactLevelRank(level SensorContactLevel) int {
	switch level {
	case SensorContactLevelUnknownSignal:
		return 1
	case SensorContactLevelClassifiedContact:
		return 2
	case SensorContactLevelConfirmedType:
		return 3
	case SensorContactLevelFullyResolved:
		return 4
	default:
		return 0
	}
}

func EvaluateSensorContact(eval SensorContactEvaluation) (*SensorContact, *SensorContact) {
	if eval.EntityID == "" || len(eval.Sources) == 0 {
		return nil, nil
	}

	score := 0.0
	activeResolution := false
	passiveSourceCount := 0
	sources := make([]SensorContactSource, 0, len(eval.Sources))
	for _, source := range eval.Sources {
		if source.SourceID == "" || source.Strength <= 0 {
			continue
		}
		contribution := source.Strength
		switch source.SourceType {
		case SensorSourceVision:
			contribution += 2
			activeResolution = true
		case SensorSourceActiveRadar:
			contribution += eval.Target.SignalSignature * 0.45
			activeResolution = true
		case SensorSourcePassiveEM:
			contribution += eval.Target.SignalSignature * 0.25
			passiveSourceCount++
		case SensorSourceInfrared:
			contribution += eval.Target.HeatSignature * 0.35
			passiveSourceCount++
		case SensorSourceSignalTower:
			contribution += eval.Target.SignalSignature * 0.20
			passiveSourceCount++
		case SensorSourceReconUnit:
			contribution += 2.5 + eval.Target.HeatSignature*0.1
			activeResolution = true
		}
		score += contribution
		sources = append(sources, SensorContactSource{
			SourceType: source.SourceType,
			SourceID:   source.SourceID,
			SourceKind: source.SourceKind,
			Strength:   source.Strength,
		})
	}
	if len(sources) == 0 {
		return nil, nil
	}

	score -= eval.DistancePenalty * 1.5
	score -= eval.Target.StealthRating * 0.9
	effectiveScore := score - eval.Target.JammingStrength*0.85
	level := scoreToSensorContactLevel(effectiveScore, activeResolution)
	if level == "" {
		return nil, buildFalseContact(eval, sources, passiveSourceCount, effectiveScore)
	}

	contact := &SensorContact{
		ID:               eval.EntityID,
		ScopeType:        eval.ScopeType,
		ScopeID:          eval.ScopeID,
		ContactKind:      eval.ContactKind,
		EntityID:         eval.EntityID,
		EntityType:       eval.EntityType,
		Domain:           eval.Domain,
		PlanetID:         eval.PlanetID,
		SystemID:         eval.SystemID,
		Position:         cloneSensorContactPosition(eval.Position),
		Level:            level,
		Classification:   eval.Target.Classification,
		ThreatLevel:      eval.Target.ThreatLevel,
		LastUpdatedTick:  eval.LastUpdated,
		SignalStrength:   clampSensorValue(effectiveScore, 0, 99),
		LockQuality:      clampSensorValue((effectiveScore-eval.Target.JammingStrength+4)/30, 0.05, 1),
		JammingPenalty:   eval.Target.JammingStrength,
		MissileDriftRisk: clampSensorValue(eval.Target.JammingStrength/maxSensorValue(1, score), 0, 1),
		Sources:          sources,
	}
	if SensorContactLevelRank(level) >= SensorContactLevelRank(SensorContactLevelClassifiedContact) {
		contact.StrengthEstimate = maxSensorInt(1, eval.Target.StrengthEstimate)
	}
	if SensorContactLevelRank(level) >= SensorContactLevelRank(SensorContactLevelConfirmedType) {
		contact.ConfirmedType = eval.Target.ResolvedType
	}

	return contact, buildFalseContact(eval, sources, passiveSourceCount, effectiveScore)
}

func ResolveWarBlueprintSensorProfile(blueprint WarBlueprint) WarSensorProfile {
	index := PublicWarBlueprintCatalogIndex()
	profile := WarSensorProfile{}

	for _, slot := range blueprint.Components {
		component, ok := index.ComponentByID(slot.ComponentID)
		if !ok {
			continue
		}
		profile.SignalSignature += float64(maxSensorInt(1, component.SignalLoad))
		profile.HeatSignature += float64(component.HeatLoad) + float64(component.PowerDraw)/12
		profile.StealthRating += float64(component.StealthRating)
		switch component.Category {
		case WarComponentCategorySensor:
			profile.PassiveEM += 2.5 + float64(component.SignalLoad)/2
			profile.Infrared += 1 + float64(component.HeatLoad)/4
			if hasWarComponentTag(component, "active_sensor") {
				profile.ActiveRadar += 4 + float64(component.SignalLoad)/2
			}
			if hasWarComponentTag(component, "datalink") {
				profile.SignalSupport += 3
			}
		case WarComponentCategoryUtility:
			if hasWarComponentTag(component, "ecm") {
				profile.JammingStrength += 4
				profile.StealthRating += 1
			}
			if hasWarComponentTag(component, "hangar") {
				profile.ReconStrength += 1.5
			}
		case WarComponentCategoryWeapon:
			profile.HeatSignature += float64(component.HeatLoad) / 2
		case WarComponentCategoryPropulsion:
			profile.HeatSignature += float64(component.HeatLoad) / 3
		}
	}

	switch {
	case blueprint.BaseHullID != "":
		if hull, ok := index.BaseHullByID(blueprint.BaseHullID); ok {
			profile.SignalSignature += float64(hull.Budgets.SignalCapacity) / 5
			profile.HeatSignature += float64(hull.Budgets.HeatCapacity) / 18
			if containsRoleKeyword(hull.Role, "recon") {
				profile.ReconStrength += 2
			}
		}
	case blueprint.BaseFrameID != "":
		if frame, ok := index.BaseFrameByID(blueprint.BaseFrameID); ok {
			profile.SignalSignature += float64(frame.Budgets.SignalCapacity) / 5
			profile.HeatSignature += float64(frame.Budgets.HeatCapacity) / 18
			if containsRoleKeyword(frame.Role, "recon") {
				profile.ReconStrength += 2
			}
		}
	}

	return profile
}

func containsRoleKeyword(role, keyword string) bool {
	if role == "" || keyword == "" {
		return false
	}
	return role == keyword || len(role) > len(keyword) && (containsSubstring(role, keyword))
}

func containsSubstring(value, target string) bool {
	if len(target) == 0 {
		return true
	}
	for i := 0; i+len(target) <= len(value); i++ {
		if value[i:i+len(target)] == target {
			return true
		}
	}
	return false
}

func cloneSensorContactState(state *SensorContactState) *SensorContactState {
	if state == nil {
		return nil
	}
	out := *state
	out.Contacts = cloneSensorContactMap(state.Contacts)
	return &out
}

func cloneSensorContactStateMap(states map[string]*SensorContactState) map[string]*SensorContactState {
	if len(states) == 0 {
		return nil
	}
	out := make(map[string]*SensorContactState, len(states))
	for playerID, state := range states {
		if state == nil {
			continue
		}
		out[playerID] = cloneSensorContactState(state)
	}
	return out
}

func cloneSensorContactMap(contacts map[string]*SensorContact) map[string]*SensorContact {
	if len(contacts) == 0 {
		return nil
	}
	out := make(map[string]*SensorContact, len(contacts))
	for id, contact := range contacts {
		if contact == nil {
			continue
		}
		copy := *contact
		copy.Position = cloneSensorContactPosition(contact.Position)
		copy.Sources = append([]SensorContactSource(nil), contact.Sources...)
		out[id] = &copy
	}
	return out
}

func buildFalseContact(
	eval SensorContactEvaluation,
	sources []SensorContactSource,
	passiveSourceCount int,
	effectiveScore float64,
) *SensorContact {
	if eval.Target.JammingStrength < 4 || passiveSourceCount == 0 {
		return nil
	}
	ghostScore := eval.Target.JammingStrength + float64(passiveSourceCount)*1.5 - eval.DistancePenalty*0.3
	if ghostScore < 2 {
		return nil
	}
	ghostSources := make([]SensorContactSource, 0, passiveSourceCount)
	for _, source := range sources {
		switch source.SourceType {
		case SensorSourcePassiveEM, SensorSourceInfrared, SensorSourceSignalTower:
			ghostSources = append(ghostSources, source)
		}
	}
	if len(ghostSources) == 0 {
		return nil
	}
	level := SensorContactLevelUnknownSignal
	if ghostScore >= 6 {
		level = SensorContactLevelClassifiedContact
	}
	return &SensorContact{
		ID:               eval.EntityID + "-ghost",
		ScopeType:        eval.ScopeType,
		ScopeID:          eval.ScopeID,
		ContactKind:      SensorContactKindFalseContact,
		EntityType:       eval.EntityType,
		Domain:           eval.Domain,
		PlanetID:         eval.PlanetID,
		SystemID:         eval.SystemID,
		Level:            level,
		Classification:   "ghost_signature",
		LastUpdatedTick:  eval.LastUpdated,
		SignalStrength:   clampSensorValue(ghostScore, 0, 99),
		LockQuality:      clampSensorValue(ghostScore/12, 0.05, 0.55),
		JammingPenalty:   eval.Target.JammingStrength,
		MissileDriftRisk: clampSensorValue(eval.Target.JammingStrength/maxSensorValue(1, effectiveScore), 0.2, 1),
		FalseContact:     true,
		Sources:          ghostSources,
	}
}

func scoreToSensorContactLevel(score float64, activeResolution bool) SensorContactLevel {
	level := SensorContactLevel("")
	switch {
	case score >= 18:
		level = SensorContactLevelFullyResolved
	case score >= 12:
		level = SensorContactLevelConfirmedType
	case score >= 6:
		level = SensorContactLevelClassifiedContact
	case score >= 2:
		level = SensorContactLevelUnknownSignal
	}
	if !activeResolution && SensorContactLevelRank(level) > SensorContactLevelRank(SensorContactLevelClassifiedContact) {
		return SensorContactLevelClassifiedContact
	}
	return level
}

func cloneSensorContactPosition(position *Position) *Position {
	if position == nil {
		return nil
	}
	copy := *position
	return &copy
}

func clampSensorValue(value, minValue, maxValue float64) float64 {
	return math.Max(minValue, math.Min(maxValue, value))
}

func maxSensorValue(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func maxSensorInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func CloneSensorContactStateMap(states map[string]*SensorContactState) map[string]*SensorContactState {
	return cloneSensorContactStateMap(states)
}
