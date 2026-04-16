package power

// PowerSourceKind identifies the energy generation source.
type PowerSourceKind string

const (
	PowerSourceWind           PowerSourceKind = "wind"
	PowerSourceSolar          PowerSourceKind = "solar"
	PowerSourceThermal        PowerSourceKind = "thermal"
	PowerSourceFusion         PowerSourceKind = "fusion"
	PowerSourceArtificialStar PowerSourceKind = "artificial_star"
	PowerSourceRayReceiver    PowerSourceKind = "ray_receiver"
	PowerSourceStorage        PowerSourceKind = "storage"
)

var validPowerSourceKinds = map[PowerSourceKind]struct{}{
	PowerSourceWind:           {},
	PowerSourceSolar:          {},
	PowerSourceThermal:        {},
	PowerSourceFusion:         {},
	PowerSourceArtificialStar: {},
	PowerSourceRayReceiver:    {},
}

// FuelRule defines a fuel consumption rule for power generation.
type FuelRule struct {
	ItemID           string  `json:"item_id" yaml:"item_id"`
	ConsumePerTick   int     `json:"consume_per_tick" yaml:"consume_per_tick"`
	OutputMultiplier float64 `json:"output_multiplier" yaml:"output_multiplier"`
}

// EnergyModule handles energy conversion/output.
type EnergyModule struct {
	OutputPerTick  int             `json:"output_per_tick" yaml:"output_per_tick"`
	ConsumePerTick int             `json:"consume_per_tick" yaml:"consume_per_tick"`
	Buffer         int             `json:"buffer" yaml:"buffer"`
	SourceKind     PowerSourceKind `json:"source_kind,omitempty" yaml:"source_kind,omitempty"`
	FuelRules      []FuelRule      `json:"fuel_rules,omitempty" yaml:"fuel_rules,omitempty"`
}

// IsPowerSourceKind validates a power source kind.
func IsPowerSourceKind(kind PowerSourceKind) bool {
	_, ok := validPowerSourceKinds[kind]
	return ok
}

// IsFuelBasedPowerSource returns true for generators that consume fuel.
func IsFuelBasedPowerSource(kind PowerSourceKind) bool {
	return kind == PowerSourceThermal || kind == PowerSourceFusion || kind == PowerSourceArtificialStar
}

// IsPowerGeneratorModule returns true when the energy module describes a generator.
func IsPowerGeneratorModule(module *EnergyModule) bool {
	if module == nil {
		return false
	}
	if module.SourceKind == "" {
		return false
	}
	return IsPowerSourceKind(module.SourceKind)
}
