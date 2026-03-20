package model

import (
	"fmt"
	"math"
)

// RayReceiverMode controls how a ray receiver outputs energy and photons.
type RayReceiverMode string

const (
	RayReceiverModePower  RayReceiverMode = "power"
	RayReceiverModePhoton RayReceiverMode = "photon"
	RayReceiverModeHybrid RayReceiverMode = "hybrid"
)

var validRayReceiverModes = map[RayReceiverMode]struct{}{
	RayReceiverModePower:  {},
	RayReceiverModePhoton: {},
	RayReceiverModeHybrid: {},
}

// RayReceiverModule defines Dyson energy reception and conversion rules.
type RayReceiverModule struct {
	InputPerTick        int             `json:"input_per_tick" yaml:"input_per_tick"`
	ReceiveEfficiency   float64         `json:"receive_efficiency" yaml:"receive_efficiency"`
	PowerOutputPerTick  int             `json:"power_output_per_tick" yaml:"power_output_per_tick"`
	PowerEfficiency     float64         `json:"power_efficiency" yaml:"power_efficiency"`
	PhotonOutputPerTick int             `json:"photon_output_per_tick" yaml:"photon_output_per_tick"`
	PhotonEnergyCost    int             `json:"photon_energy_cost" yaml:"photon_energy_cost"`
	PhotonEfficiency    float64         `json:"photon_efficiency" yaml:"photon_efficiency"`
	PhotonItemID        string          `json:"photon_item_id,omitempty" yaml:"photon_item_id,omitempty"`
	Mode                RayReceiverMode `json:"mode,omitempty" yaml:"mode,omitempty"`
}

// RayReceiverRequest describes inputs for resolving a ray receiver tick.
type RayReceiverRequest struct {
	Module        *RayReceiverModule
	PowerCapacity int
}

// RayReceiverResult captures energy and photon outputs for a tick.
type RayReceiverResult struct {
	PowerOutput  int
	PhotonOutput int
	PhotonItemID string
}

// ResolveRayReceiver computes ray receiver outputs based on module rules.
func ResolveRayReceiver(req RayReceiverRequest) (RayReceiverResult, error) {
	result := RayReceiverResult{}
	if req.Module == nil {
		return result, nil
	}
	module := *req.Module
	mode := module.Mode
	if mode == "" {
		mode = RayReceiverModeHybrid
	}
	if !IsRayReceiverMode(mode) {
		return result, fmt.Errorf("invalid ray receiver mode %s", mode)
	}
	if module.InputPerTick <= 0 {
		return result, nil
	}
	if module.ReceiveEfficiency <= 0 || module.ReceiveEfficiency > 1 {
		return result, fmt.Errorf("ray receiver receive efficiency invalid")
	}
	if module.PowerEfficiency <= 0 || module.PowerEfficiency > 1 {
		return result, fmt.Errorf("ray receiver power efficiency invalid")
	}
	if module.PhotonOutputPerTick > 0 {
		if module.PhotonEnergyCost <= 0 {
			return result, fmt.Errorf("ray receiver photon energy cost invalid")
		}
		if module.PhotonEfficiency <= 0 || module.PhotonEfficiency > 1 {
			return result, fmt.Errorf("ray receiver photon efficiency invalid")
		}
	}

	usableEnergy := float64(module.InputPerTick) * module.ReceiveEfficiency
	if usableEnergy <= 0 {
		return result, nil
	}

	powerOutput := 0
	if mode != RayReceiverModePhoton && module.PowerOutputPerTick > 0 && req.PowerCapacity > 0 {
		maxFromEnergy := int(math.Floor(usableEnergy * module.PowerEfficiency))
		if maxFromEnergy < 0 {
			maxFromEnergy = 0
		}
		powerLimit := module.PowerOutputPerTick
		if req.PowerCapacity < powerLimit {
			powerLimit = req.PowerCapacity
		}
		powerOutput = minInt(powerLimit, maxFromEnergy)
	}

	energyUsed := 0.0
	if powerOutput > 0 {
		energyUsed = float64(powerOutput) / module.PowerEfficiency
	}
	remainingEnergy := usableEnergy - energyUsed
	if remainingEnergy < 0 {
		remainingEnergy = 0
	}

	photonOutput := 0
	if mode != RayReceiverModePower && module.PhotonOutputPerTick > 0 && remainingEnergy > 0 {
		maxFromEnergy := int(math.Floor(remainingEnergy * module.PhotonEfficiency / float64(module.PhotonEnergyCost)))
		if maxFromEnergy < 0 {
			maxFromEnergy = 0
		}
		if module.PhotonOutputPerTick < maxFromEnergy {
			maxFromEnergy = module.PhotonOutputPerTick
		}
		photonOutput = maxFromEnergy
	}

	result.PowerOutput = powerOutput
	result.PhotonOutput = photonOutput
	if module.PhotonItemID != "" {
		result.PhotonItemID = module.PhotonItemID
	} else {
		result.PhotonItemID = ItemCriticalPhoton
	}
	return result, nil
}

// IsRayReceiverMode validates ray receiver mode.
func IsRayReceiverMode(mode RayReceiverMode) bool {
	_, ok := validRayReceiverModes[mode]
	return ok
}
