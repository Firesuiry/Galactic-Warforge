package model

import (
	"fmt"
	"sync"
)

// LogisticsSchedulingStrategy defines how logistics routes are chosen.
type LogisticsSchedulingStrategy string

const (
	LogisticsSchedulingStrategyShortestPath LogisticsSchedulingStrategy = "shortest_path"
	LogisticsSchedulingStrategyLowestCost   LogisticsSchedulingStrategy = "lowest_cost"
)

// LogisticsSchedulingMode distinguishes planetary vs interstellar scheduling.
type LogisticsSchedulingMode string

const (
	LogisticsSchedulingPlanetary    LogisticsSchedulingMode = "planetary"
	LogisticsSchedulingInterstellar LogisticsSchedulingMode = "interstellar"
)

// LogisticsSchedulingConfig controls logistics scheduling behavior.
type LogisticsSchedulingConfig struct {
	PlanetaryStrategy        LogisticsSchedulingStrategy `json:"planetary_strategy" yaml:"planetary_strategy"`
	InterstellarStrategy     LogisticsSchedulingStrategy `json:"interstellar_strategy" yaml:"interstellar_strategy"`
	DemandForecastMultiplier float64                     `json:"demand_forecast_multiplier" yaml:"demand_forecast_multiplier"`
	OversupplyRatio          float64                     `json:"oversupply_ratio" yaml:"oversupply_ratio"`
	OversupplyMax            int                         `json:"oversupply_max" yaml:"oversupply_max"`
}

// LogisticsSchedulingObservation captures one dispatch decision for observability.
type LogisticsSchedulingObservation struct {
	Tick             int64                       `json:"tick"`
	Mode             LogisticsSchedulingMode     `json:"mode"`
	Strategy         LogisticsSchedulingStrategy `json:"strategy"`
	OriginID         string                      `json:"origin_id"`
	TargetID         string                      `json:"target_id"`
	ItemID           string                      `json:"item_id"`
	Quantity         int                         `json:"quantity"`
	Distance         int                         `json:"distance"`
	TravelTicks      int                         `json:"travel_ticks"`
	RouteCost        int                         `json:"route_cost"`
	WarpItemCost     int                         `json:"warp_item_cost,omitempty"`
	DemandBase       int                         `json:"demand_base"`
	DemandForecast   int                         `json:"demand_forecast"`
	OversupplyBuffer int                         `json:"oversupply_buffer"`
}

const DefaultLogisticsSchedulingObservationLimit = 200

var (
	logisticsSchedulingMu    sync.RWMutex
	logisticsSchedulingStore LogisticsSchedulingConfig

	logisticsSchedulingObsMu    sync.RWMutex
	logisticsSchedulingObsLimit = DefaultLogisticsSchedulingObservationLimit
	logisticsSchedulingObsStore []LogisticsSchedulingObservation
)

func init() {
	logisticsSchedulingStore = DefaultLogisticsSchedulingConfig()
}

// DefaultLogisticsSchedulingConfig returns default scheduling configuration.
func DefaultLogisticsSchedulingConfig() LogisticsSchedulingConfig {
	return LogisticsSchedulingConfig{
		PlanetaryStrategy:        LogisticsSchedulingStrategyShortestPath,
		InterstellarStrategy:     LogisticsSchedulingStrategyLowestCost,
		DemandForecastMultiplier: 1,
		OversupplyRatio:          0,
		OversupplyMax:            0,
	}
}

// SetLogisticsSchedulingConfig replaces the current scheduling configuration.
func SetLogisticsSchedulingConfig(cfg LogisticsSchedulingConfig) error {
	normalized, err := normalizeLogisticsSchedulingConfig(cfg)
	if err != nil {
		return err
	}
	logisticsSchedulingMu.Lock()
	logisticsSchedulingStore = normalized
	logisticsSchedulingMu.Unlock()
	return nil
}

// CurrentLogisticsSchedulingConfig returns a copy of the current scheduling configuration.
func CurrentLogisticsSchedulingConfig() LogisticsSchedulingConfig {
	logisticsSchedulingMu.RLock()
	defer logisticsSchedulingMu.RUnlock()
	return logisticsSchedulingStore
}

// RecordLogisticsSchedulingObservation appends a new scheduling observation.
func RecordLogisticsSchedulingObservation(obs LogisticsSchedulingObservation) {
	logisticsSchedulingObsMu.Lock()
	defer logisticsSchedulingObsMu.Unlock()
	logisticsSchedulingObsStore = append(logisticsSchedulingObsStore, obs)
	if logisticsSchedulingObsLimit > 0 && len(logisticsSchedulingObsStore) > logisticsSchedulingObsLimit {
		start := len(logisticsSchedulingObsStore) - logisticsSchedulingObsLimit
		if start < 0 {
			start = 0
		}
		logisticsSchedulingObsStore = append([]LogisticsSchedulingObservation(nil), logisticsSchedulingObsStore[start:]...)
	}
}

// CurrentLogisticsSchedulingObservations returns a snapshot of recent observations.
func CurrentLogisticsSchedulingObservations() []LogisticsSchedulingObservation {
	logisticsSchedulingObsMu.RLock()
	defer logisticsSchedulingObsMu.RUnlock()
	if len(logisticsSchedulingObsStore) == 0 {
		return nil
	}
	out := make([]LogisticsSchedulingObservation, len(logisticsSchedulingObsStore))
	copy(out, logisticsSchedulingObsStore)
	return out
}

// ResetLogisticsSchedulingObservations clears stored observations.
func ResetLogisticsSchedulingObservations() {
	logisticsSchedulingObsMu.Lock()
	logisticsSchedulingObsStore = nil
	logisticsSchedulingObsMu.Unlock()
}

func normalizeLogisticsSchedulingConfig(cfg LogisticsSchedulingConfig) (LogisticsSchedulingConfig, error) {
	out := cfg
	if !out.PlanetaryStrategy.Valid() {
		return LogisticsSchedulingConfig{}, fmt.Errorf("invalid planetary strategy: %s", out.PlanetaryStrategy)
	}
	if !out.InterstellarStrategy.Valid() {
		return LogisticsSchedulingConfig{}, fmt.Errorf("invalid interstellar strategy: %s", out.InterstellarStrategy)
	}
	if out.DemandForecastMultiplier < 1 {
		out.DemandForecastMultiplier = 1
	}
	if out.OversupplyRatio < 0 {
		out.OversupplyRatio = 0
	}
	if out.OversupplyMax < 0 {
		out.OversupplyMax = 0
	}
	return out, nil
}

// Valid reports whether the strategy is supported.
func (s LogisticsSchedulingStrategy) Valid() bool {
	switch s {
	case LogisticsSchedulingStrategyShortestPath, LogisticsSchedulingStrategyLowestCost:
		return true
	default:
		return false
	}
}
