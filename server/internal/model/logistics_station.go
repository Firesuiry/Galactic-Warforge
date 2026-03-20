package model

import "fmt"

// LogisticsStationMode describes supply/demand behavior for an item.
type LogisticsStationMode string

const (
	LogisticsStationModeNone   LogisticsStationMode = "none"
	LogisticsStationModeSupply LogisticsStationMode = "supply"
	LogisticsStationModeDemand LogisticsStationMode = "demand"
	LogisticsStationModeBoth   LogisticsStationMode = "both"
)

// LogisticsStationPriority configures inbound/outbound priority for a station.
type LogisticsStationPriority struct {
	Input  int `json:"input" yaml:"input"`
	Output int `json:"output" yaml:"output"`
}

// LogisticsStationInterstellarConfig configures interstellar logistics behavior.
type LogisticsStationInterstellarConfig struct {
	Enabled              bool   `json:"enabled"`
	WarpEnabled          bool   `json:"warp_enabled"`
	ShipSlots            int    `json:"ship_slots"`
	ShipCapacity         int    `json:"ship_capacity"`
	ShipSpeed            int    `json:"ship_speed"`
	WarpSpeed            int    `json:"warp_speed"`
	WarpDistance         int    `json:"warp_distance"`
	EnergyPerDistance    int    `json:"energy_per_distance"`
	WarpEnergyMultiplier int    `json:"warp_energy_multiplier"`
	WarpItemID           string `json:"warp_item_id,omitempty"`
	WarpItemCost         int    `json:"warp_item_cost"`
}

// LogisticsStationItemSetting configures supply/demand and local storage for an item.
type LogisticsStationItemSetting struct {
	ItemID       string               `json:"item_id"`
	Mode         LogisticsStationMode `json:"mode"`
	LocalStorage int                  `json:"local_storage"`
}

// LogisticsStationCapacityCache tracks computed supply/demand capacity per item.
type LogisticsStationCapacityCache struct {
	Supply ItemInventory `json:"supply,omitempty"`
	Demand ItemInventory `json:"demand,omitempty"`
	Local  ItemInventory `json:"local,omitempty"`
}

// LogisticsStationState tracks a logistics station configuration and cached capacity.
type LogisticsStationState struct {
	Priority             LogisticsStationPriority               `json:"priority"`
	Settings             map[string]LogisticsStationItemSetting `json:"settings,omitempty"`
	Inventory            ItemInventory                          `json:"inventory,omitempty"`
	DroneCapacity        int                                    `json:"drone_capacity"`
	Interstellar         LogisticsStationInterstellarConfig     `json:"interstellar"`
	InterstellarSettings map[string]LogisticsStationItemSetting `json:"interstellar_settings,omitempty"`
	Cache                LogisticsStationCapacityCache          `json:"cache,omitempty"`
	InterstellarCache    LogisticsStationCapacityCache          `json:"interstellar_cache,omitempty"`
}

// NewLogisticsStationState builds a default station state.
func NewLogisticsStationState() *LogisticsStationState {
	state := &LogisticsStationState{
		Priority:      LogisticsStationPriority{Input: 1, Output: 1},
		DroneCapacity: DefaultLogisticsStationDroneCapacity,
	}
	state.Normalize()
	return state
}

// Clone returns a deep copy of the logistics station state.
func (s *LogisticsStationState) Clone() *LogisticsStationState {
	if s == nil {
		return nil
	}
	out := *s
	if len(s.Settings) > 0 {
		out.Settings = make(map[string]LogisticsStationItemSetting, len(s.Settings))
		for key, setting := range s.Settings {
			out.Settings[key] = setting
		}
	}
	if len(s.InterstellarSettings) > 0 {
		out.InterstellarSettings = make(map[string]LogisticsStationItemSetting, len(s.InterstellarSettings))
		for key, setting := range s.InterstellarSettings {
			out.InterstellarSettings[key] = setting
		}
	}
	out.Inventory = s.Inventory.Clone()
	out.Cache = LogisticsStationCapacityCache{
		Supply: s.Cache.Supply.Clone(),
		Demand: s.Cache.Demand.Clone(),
		Local:  s.Cache.Local.Clone(),
	}
	out.InterstellarCache = LogisticsStationCapacityCache{
		Supply: s.InterstellarCache.Supply.Clone(),
		Demand: s.InterstellarCache.Demand.Clone(),
		Local:  s.InterstellarCache.Local.Clone(),
	}
	return &out
}

// Normalize clamps negative values and ensures defaults are set.
func (s *LogisticsStationState) Normalize() {
	if s == nil {
		return
	}
	input, output := normalizePriority(s.Priority.Input, s.Priority.Output)
	s.Priority.Input = input
	s.Priority.Output = output
	s.DroneCapacity = normalizeNonNegative(s.DroneCapacity)
	if s.DroneCapacity == 0 {
		s.DroneCapacity = DefaultLogisticsStationDroneCapacity
	}
	s.Interstellar.Normalize()
	for key, setting := range s.Settings {
		setting.LocalStorage = normalizeNonNegative(setting.LocalStorage)
		if !setting.Mode.Valid() {
			setting.Mode = LogisticsStationModeNone
		}
		if setting.ItemID == "" {
			setting.ItemID = key
		}
		s.Settings[key] = setting
	}
	for key, setting := range s.InterstellarSettings {
		setting.LocalStorage = normalizeNonNegative(setting.LocalStorage)
		if !setting.Mode.Valid() {
			setting.Mode = LogisticsStationModeNone
		}
		if setting.ItemID == "" {
			setting.ItemID = key
		}
		s.InterstellarSettings[key] = setting
	}
}

// UpsertSetting adds or updates an item setting.
func (s *LogisticsStationState) UpsertSetting(setting LogisticsStationItemSetting) error {
	if s == nil {
		return fmt.Errorf("station required")
	}
	if setting.ItemID == "" {
		return fmt.Errorf("item_id required")
	}
	if _, ok := Item(setting.ItemID); !ok {
		return fmt.Errorf("unknown item: %s", setting.ItemID)
	}
	setting.LocalStorage = normalizeNonNegative(setting.LocalStorage)
	if !setting.Mode.Valid() {
		setting.Mode = LogisticsStationModeNone
	}
	if s.Settings == nil {
		s.Settings = make(map[string]LogisticsStationItemSetting)
	}
	s.Settings[setting.ItemID] = setting
	s.RefreshCapacityCache()
	return nil
}

// RemoveSetting deletes the item setting if present.
func (s *LogisticsStationState) RemoveSetting(itemID string) {
	if s == nil || itemID == "" {
		return
	}
	delete(s.Settings, itemID)
	s.RefreshCapacityCache()
}

// UpsertInterstellarSetting adds or updates an interstellar item setting.
func (s *LogisticsStationState) UpsertInterstellarSetting(setting LogisticsStationItemSetting) error {
	if s == nil {
		return fmt.Errorf("station required")
	}
	if setting.ItemID == "" {
		return fmt.Errorf("item_id required")
	}
	if _, ok := Item(setting.ItemID); !ok {
		return fmt.Errorf("unknown item: %s", setting.ItemID)
	}
	setting.LocalStorage = normalizeNonNegative(setting.LocalStorage)
	if !setting.Mode.Valid() {
		setting.Mode = LogisticsStationModeNone
	}
	if s.InterstellarSettings == nil {
		s.InterstellarSettings = make(map[string]LogisticsStationItemSetting)
	}
	s.InterstellarSettings[setting.ItemID] = setting
	s.RefreshCapacityCache()
	return nil
}

// RemoveInterstellarSetting deletes the interstellar item setting if present.
func (s *LogisticsStationState) RemoveInterstellarSetting(itemID string) {
	if s == nil || itemID == "" {
		return
	}
	delete(s.InterstellarSettings, itemID)
	s.RefreshCapacityCache()
}

// SettingFor returns the setting for an item.
func (s *LogisticsStationState) SettingFor(itemID string) (LogisticsStationItemSetting, bool) {
	if s == nil || itemID == "" {
		return LogisticsStationItemSetting{}, false
	}
	setting, ok := s.Settings[itemID]
	return setting, ok
}

// InterstellarSettingFor returns the interstellar setting for an item.
func (s *LogisticsStationState) InterstellarSettingFor(itemID string) (LogisticsStationItemSetting, bool) {
	if s == nil || itemID == "" {
		return LogisticsStationItemSetting{}, false
	}
	setting, ok := s.InterstellarSettings[itemID]
	return setting, ok
}

// SetInventory replaces the station inventory and refreshes caches.
func (s *LogisticsStationState) SetInventory(inv ItemInventory) {
	if s == nil {
		return
	}
	s.Inventory = inv.Clone()
	s.RefreshCapacityCache()
}

// InputPriorityValue returns normalized input priority.
func (s *LogisticsStationState) InputPriorityValue() int {
	input, _ := normalizePriority(s.Priority.Input, s.Priority.Output)
	return input
}

// OutputPriorityValue returns normalized output priority.
func (s *LogisticsStationState) OutputPriorityValue() int {
	_, output := normalizePriority(s.Priority.Input, s.Priority.Output)
	return output
}

// DroneCapacityValue returns normalized drone slot capacity.
func (s *LogisticsStationState) DroneCapacityValue() int {
	if s == nil {
		return DefaultLogisticsStationDroneCapacity
	}
	if s.DroneCapacity <= 0 {
		return DefaultLogisticsStationDroneCapacity
	}
	return s.DroneCapacity
}

// ShipSlotCapacityValue returns normalized ship slot capacity.
func (s *LogisticsStationState) ShipSlotCapacityValue() int {
	if s == nil {
		return DefaultLogisticsStationShipSlots
	}
	if s.Interstellar.ShipSlots <= 0 {
		return DefaultLogisticsStationShipSlots
	}
	return s.Interstellar.ShipSlots
}

// ShipCapacityValue returns normalized ship cargo capacity.
func (s *LogisticsStationState) ShipCapacityValue() int {
	if s == nil {
		return DefaultLogisticsShipCapacity
	}
	if s.Interstellar.ShipCapacity <= 0 {
		return DefaultLogisticsShipCapacity
	}
	return s.Interstellar.ShipCapacity
}

// ShipSpeedValue returns normalized ship speed.
func (s *LogisticsStationState) ShipSpeedValue() int {
	if s == nil {
		return DefaultLogisticsShipSpeed
	}
	if s.Interstellar.ShipSpeed <= 0 {
		return DefaultLogisticsShipSpeed
	}
	return s.Interstellar.ShipSpeed
}

// WarpSpeedValue returns normalized warp speed.
func (s *LogisticsStationState) WarpSpeedValue() int {
	if s == nil {
		return DefaultLogisticsShipWarpSpeed
	}
	if s.Interstellar.WarpSpeed <= 0 {
		return DefaultLogisticsShipWarpSpeed
	}
	return s.Interstellar.WarpSpeed
}

// WarpDistanceValue returns normalized warp distance threshold.
func (s *LogisticsStationState) WarpDistanceValue() int {
	if s == nil {
		return DefaultLogisticsShipWarpDistance
	}
	if s.Interstellar.WarpDistance <= 0 {
		return DefaultLogisticsShipWarpDistance
	}
	return s.Interstellar.WarpDistance
}

// EnergyPerDistanceValue returns normalized energy per distance.
func (s *LogisticsStationState) EnergyPerDistanceValue() int {
	if s == nil {
		return DefaultLogisticsShipEnergyPerDistance
	}
	if s.Interstellar.EnergyPerDistance <= 0 {
		return DefaultLogisticsShipEnergyPerDistance
	}
	return s.Interstellar.EnergyPerDistance
}

// WarpEnergyMultiplierValue returns normalized warp energy multiplier.
func (s *LogisticsStationState) WarpEnergyMultiplierValue() int {
	if s == nil {
		return DefaultLogisticsShipWarpEnergyMultiplier
	}
	if s.Interstellar.WarpEnergyMultiplier <= 0 {
		return DefaultLogisticsShipWarpEnergyMultiplier
	}
	return s.Interstellar.WarpEnergyMultiplier
}

// WarpItemIDValue returns normalized warp item id.
func (s *LogisticsStationState) WarpItemIDValue() string {
	if s == nil || s.Interstellar.WarpItemID == "" {
		return DefaultLogisticsShipWarpItemID
	}
	return s.Interstellar.WarpItemID
}

// WarpItemCostValue returns normalized warp item cost.
func (s *LogisticsStationState) WarpItemCostValue() int {
	if s == nil {
		return DefaultLogisticsShipWarpItemCost
	}
	if s.Interstellar.WarpItemCost <= 0 {
		return DefaultLogisticsShipWarpItemCost
	}
	return s.Interstellar.WarpItemCost
}

// RefreshCapacityCache recomputes cached supply/demand/local capacities.
func (s *LogisticsStationState) RefreshCapacityCache() {
	if s == nil {
		return
	}
	s.Cache = buildCapacityCache(s.Settings, s.Inventory)
	s.InterstellarCache = buildCapacityCache(s.InterstellarSettings, s.Inventory)
}

// SupplyCapacity returns cached supply capacity for an item.
func (s *LogisticsStationState) SupplyCapacity(itemID string) int {
	if s == nil || itemID == "" || s.Cache.Supply == nil {
		return 0
	}
	if qty := s.Cache.Supply[itemID]; qty > 0 {
		return qty
	}
	return 0
}

// DemandCapacity returns cached demand capacity for an item.
func (s *LogisticsStationState) DemandCapacity(itemID string) int {
	if s == nil || itemID == "" || s.Cache.Demand == nil {
		return 0
	}
	if qty := s.Cache.Demand[itemID]; qty > 0 {
		return qty
	}
	return 0
}

// LocalCapacity returns cached local storage capacity for an item.
func (s *LogisticsStationState) LocalCapacity(itemID string) int {
	if s == nil || itemID == "" || s.Cache.Local == nil {
		return 0
	}
	if qty := s.Cache.Local[itemID]; qty > 0 {
		return qty
	}
	return 0
}

// InterstellarSupplyCapacity returns cached interstellar supply capacity for an item.
func (s *LogisticsStationState) InterstellarSupplyCapacity(itemID string) int {
	if s == nil || itemID == "" || s.InterstellarCache.Supply == nil {
		return 0
	}
	if qty := s.InterstellarCache.Supply[itemID]; qty > 0 {
		return qty
	}
	return 0
}

// InterstellarDemandCapacity returns cached interstellar demand capacity for an item.
func (s *LogisticsStationState) InterstellarDemandCapacity(itemID string) int {
	if s == nil || itemID == "" || s.InterstellarCache.Demand == nil {
		return 0
	}
	if qty := s.InterstellarCache.Demand[itemID]; qty > 0 {
		return qty
	}
	return 0
}

// InterstellarLocalCapacity returns cached interstellar local storage capacity for an item.
func (s *LogisticsStationState) InterstellarLocalCapacity(itemID string) int {
	if s == nil || itemID == "" || s.InterstellarCache.Local == nil {
		return 0
	}
	if qty := s.InterstellarCache.Local[itemID]; qty > 0 {
		return qty
	}
	return 0
}

// Valid reports whether the mode is supported.
func (m LogisticsStationMode) Valid() bool {
	switch m {
	case LogisticsStationModeNone, LogisticsStationModeSupply, LogisticsStationModeDemand, LogisticsStationModeBoth:
		return true
	default:
		return false
	}
}

// SupplyEnabled returns true if the mode allows supplying.
func (m LogisticsStationMode) SupplyEnabled() bool {
	return m == LogisticsStationModeSupply || m == LogisticsStationModeBoth
}

// DemandEnabled returns true if the mode allows demanding.
func (m LogisticsStationMode) DemandEnabled() bool {
	return m == LogisticsStationModeDemand || m == LogisticsStationModeBoth
}

// Normalize clamps invalid values and fills defaults for interstellar config.
func (c *LogisticsStationInterstellarConfig) Normalize() {
	if c == nil {
		return
	}
	if c.ShipSlots <= 0 {
		c.ShipSlots = DefaultLogisticsStationShipSlots
	}
	if c.ShipCapacity <= 0 {
		c.ShipCapacity = DefaultLogisticsShipCapacity
	}
	if c.ShipSpeed <= 0 {
		c.ShipSpeed = DefaultLogisticsShipSpeed
	}
	if c.WarpSpeed <= 0 {
		c.WarpSpeed = DefaultLogisticsShipWarpSpeed
	}
	if c.WarpDistance <= 0 {
		c.WarpDistance = DefaultLogisticsShipWarpDistance
	}
	if c.EnergyPerDistance <= 0 {
		c.EnergyPerDistance = DefaultLogisticsShipEnergyPerDistance
	}
	if c.WarpEnergyMultiplier <= 0 {
		c.WarpEnergyMultiplier = DefaultLogisticsShipWarpEnergyMultiplier
	}
	if c.WarpItemCost <= 0 {
		c.WarpItemCost = DefaultLogisticsShipWarpItemCost
	}
	if c.WarpItemID == "" {
		c.WarpItemID = DefaultLogisticsShipWarpItemID
	}
}

func normalizeNonNegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func buildCapacityCache(settings map[string]LogisticsStationItemSetting, inventory ItemInventory) LogisticsStationCapacityCache {
	cache := LogisticsStationCapacityCache{}
	if len(settings) == 0 {
		return cache
	}
	for itemID, setting := range settings {
		if itemID == "" {
			continue
		}
		local := normalizeNonNegative(setting.LocalStorage)
		stored := inventory[itemID]
		if stored < 0 {
			stored = 0
		}
		if local > 0 {
			if cache.Local == nil {
				cache.Local = make(ItemInventory)
			}
			cache.Local[itemID] = local
		}
		if setting.Mode.SupplyEnabled() {
			supply := stored - local
			if supply > 0 {
				if cache.Supply == nil {
					cache.Supply = make(ItemInventory)
				}
				cache.Supply[itemID] = supply
			}
		}
		if setting.Mode.DemandEnabled() {
			demand := local - stored
			if demand > 0 {
				if cache.Demand == nil {
					cache.Demand = make(ItemInventory)
				}
				cache.Demand[itemID] = demand
			}
		}
	}
	return cache
}

// IsLogisticsStationBuilding returns true for logistics station buildings.
func IsLogisticsStationBuilding(btype BuildingType) bool {
	switch btype {
	case BuildingTypePlanetaryLogisticsStation, BuildingTypeInterstellarLogisticsStation, BuildingTypeOrbitalCollector:
		return true
	default:
		return false
	}
}

// IsInterstellarLogisticsBuilding returns true for buildings that can run interstellar logistics.
func IsInterstellarLogisticsBuilding(btype BuildingType) bool {
	switch btype {
	case BuildingTypeInterstellarLogisticsStation, BuildingTypeOrbitalCollector:
		return true
	default:
		return false
	}
}
