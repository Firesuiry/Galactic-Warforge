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

// SorterTransfer records the latest completed movement, not a predicted animation.
type SorterTransfer struct {
	Tick           int64    `json:"tick"`
	Sequence       int64    `json:"sequence"`
	SourceID       string   `json:"source_id"`
	TargetID       string   `json:"target_id"`
	SourcePosition Position `json:"source_position"`
	TargetPosition Position `json:"target_position"`
	ItemID         string   `json:"item_id"`
	Quantity       int      `json:"quantity"`
}

// SorterState tracks runtime sorter configuration.
//
// 分拣器不再保存方向：取货端固定在建造朝向的背面、放货端在正面（见
// SorterFacing / ApplyBuildingRotation），沿该轴前后各扫 Range 格。配置命令
// 只能改 Filter。
type SorterState struct {
	// CycleTicks 是往返周期系数：往返周期 = CycleTicks × 两端点距离格数。
	CycleTicks int `json:"cycle_ticks"`
	Range      int `json:"range"`
	// NextTripTick 是下一次允许往返的最早 tick（0 表示随时可搬）。
	NextTripTick int64          `json:"next_trip_tick,omitempty"`
	Filter       SorterFilter   `json:"filter,omitempty"`
	LastTransfer *SorterTransfer `json:"last_transfer,omitempty"`
}

// Clone returns a deep copy of the sorter state.
func (s *SorterState) Clone() *SorterState {
	if s == nil {
		return nil
	}
	out := *s
	out.Filter.Items = append([]string(nil), s.Filter.Items...)
	out.Filter.Tags = append([]string(nil), s.Filter.Tags...)
	if s.LastTransfer != nil {
		transfer := *s.LastTransfer
		out.LastTransfer = &transfer
	}
	return &out
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
	if s.CycleTicks <= 0 {
		s.CycleTicks = defaultSorterCycleTicks
	}
	if s.Range <= 0 {
		s.Range = 1
	}
	if s.NextTripTick < 0 {
		s.NextTripTick = 0
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

// defaultSorterCycleTicks 是未配置 cycle_ticks 时的往返周期系数（= Mk.I 的节拍）。
const defaultSorterCycleTicks = 6

// SorterFacing 返回分拣器的放货端方向：建造朝向 rotation 的「正面」。
// 与 rotateOffset 同向：0°=北、90°=东、180°=南、270°=西。
func SorterFacing(rotation PlanRotation) ConveyorDirection {
	switch normalizePlanRotation(rotation) {
	case PlanRotation90:
		return ConveyorEast
	case PlanRotation180:
		return ConveyorSouth
	case PlanRotation270:
		return ConveyorWest
	default:
		return ConveyorNorth
	}
}

// SorterFacingAxis 返回分拣器沿朝向轴的 (取货端, 放货端)：背面取货、正面放货。
func SorterFacingAxis(rotation PlanRotation) (ConveyorDirection, ConveyorDirection) {
	front := SorterFacing(rotation)
	return front.Opposite(), front
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
