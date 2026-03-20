package model

import "fmt"

// IsFluidForm reports whether the resource form is a liquid or gas.
func IsFluidForm(form ResourceForm) bool {
	switch form {
	case ResourceLiquid, ResourceGas:
		return true
	default:
		return false
	}
}

// FluidDefinition describes a liquid or gas type.
type FluidDefinition struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Form       ResourceForm `json:"form"`
	UnitVolume int          `json:"unit_volume"`
	Density    float64      `json:"density,omitempty"`
	Grade      int          `json:"grade,omitempty"`
}

// Validate ensures the fluid definition is usable.
func (d FluidDefinition) Validate() error {
	if d.ID == "" {
		return fmt.Errorf("fluid id required")
	}
	if !IsFluidForm(d.Form) {
		return fmt.Errorf("invalid fluid form: %s", d.Form)
	}
	if d.UnitVolume <= 0 {
		return fmt.Errorf("fluid unit_volume must be positive")
	}
	if d.Density < 0 {
		return fmt.Errorf("fluid density cannot be negative")
	}
	if d.Grade < 0 {
		return fmt.Errorf("fluid grade cannot be negative")
	}
	return nil
}

// FluidState captures the current amount of a fluid in capacity units.
type FluidState struct {
	FluidID string `json:"fluid_id"`
	Volume  int    `json:"volume"`
}
