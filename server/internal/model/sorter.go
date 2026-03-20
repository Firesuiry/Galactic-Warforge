package model

import "strings"

// SorterFilterMode defines how the sorter filter list is interpreted.
type SorterFilterMode string

const (
	SorterFilterAllow SorterFilterMode = "allow"
	SorterFilterDeny  SorterFilterMode = "deny"
)

var validSorterFilterModes = map[SorterFilterMode]struct{}{
	SorterFilterAllow: {},
	SorterFilterDeny:  {},
}

// SorterFilter controls which items are accepted or rejected.
type SorterFilter struct {
	Mode  SorterFilterMode `json:"mode,omitempty" yaml:"mode,omitempty"`
	Items []string         `json:"items,omitempty" yaml:"items,omitempty"`
	Tags  []string         `json:"tags,omitempty" yaml:"tags,omitempty"`
}

// SorterState tracks runtime sorter configuration.
type SorterState struct {
	InputDirections  []ConveyorDirection `json:"input_directions,omitempty"`
	OutputDirections []ConveyorDirection `json:"output_directions,omitempty"`
	Speed            int                 `json:"speed"`
	Range            int                 `json:"range"`
	Filter           SorterFilter        `json:"filter,omitempty"`
}

// IsSorterBuilding returns true for sorter buildings.
func IsSorterBuilding(btype BuildingType) bool {
	switch btype {
	case BuildingTypeSorterMk1, BuildingTypeSorterMk2, BuildingTypeSorterMk3, BuildingTypePileSorter:
		return true
	default:
		return false
	}
}

// Normalize ensures defaults and removes invalid data.
func (s *SorterState) Normalize() {
	if s == nil {
		return
	}
	s.InputDirections = normalizeSorterDirections(s.InputDirections)
	s.OutputDirections = normalizeSorterDirections(s.OutputDirections)
	if s.Speed <= 0 {
		s.Speed = 1
	}
	if s.Range <= 0 {
		s.Range = 1
	}
	s.Filter.normalize()
}

// Allows returns true if the filter permits the item.
func (f SorterFilter) Allows(itemID string) bool {
	if itemID == "" {
		return false
	}
	if len(f.Items) == 0 && len(f.Tags) == 0 {
		return true
	}
	match := containsString(f.Items, itemID) || f.matchTags(itemID)
	if f.Mode == SorterFilterDeny {
		return !match
	}
	return match
}

func (f *SorterFilter) normalize() {
	if f == nil {
		return
	}
	if f.Mode == "" {
		f.Mode = SorterFilterAllow
	}
	if _, ok := validSorterFilterModes[f.Mode]; !ok {
		f.Mode = SorterFilterAllow
	}
	f.Items = normalizeStringList(f.Items)
	f.Tags = normalizeStringList(f.Tags)
}

func (f SorterFilter) matchTags(itemID string) bool {
	if len(f.Tags) == 0 {
		return false
	}
	def, ok := Item(itemID)
	if !ok {
		return false
	}
	category := strings.ToLower(string(def.Category))
	for _, tag := range f.Tags {
		if normalizeSorterTag(tag) == category {
			return true
		}
	}
	return false
}

func normalizeSorterTag(tag string) string {
	tag = strings.TrimSpace(strings.ToLower(tag))
	tag = strings.TrimPrefix(tag, "tag:")
	tag = strings.TrimPrefix(tag, "category:")
	return tag
}

var defaultSorterDirections = []ConveyorDirection{
	ConveyorNorth,
	ConveyorEast,
	ConveyorSouth,
	ConveyorWest,
}

func normalizeSorterDirections(dirs []ConveyorDirection) []ConveyorDirection {
	seen := make(map[ConveyorDirection]struct{}, len(dirs))
	normalized := make([]ConveyorDirection, 0, len(dirs))
	for _, dir := range dirs {
		if !dir.Valid() || dir == ConveyorAuto {
			continue
		}
		if _, ok := seen[dir]; ok {
			continue
		}
		seen[dir] = struct{}{}
		normalized = append(normalized, dir)
	}
	if len(normalized) == 0 {
		normalized = append([]ConveyorDirection(nil), defaultSorterDirections...)
	}
	return normalized
}

func normalizeStringList(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
