package model

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
