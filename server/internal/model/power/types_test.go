package power

import "testing"

func TestPowerSourceValidationHelpers(t *testing.T) {
	if !IsPowerSourceKind(PowerSourceWind) {
		t.Fatal("expected wind to be a valid power source")
	}
	if IsPowerSourceKind(PowerSourceKind("unknown")) {
		t.Fatal("expected unknown power source to be invalid")
	}
	if !IsFuelBasedPowerSource(PowerSourceThermal) {
		t.Fatal("expected thermal to require fuel")
	}
	if IsFuelBasedPowerSource(PowerSourceWind) {
		t.Fatal("expected wind to be non-fuel-based")
	}
	if !IsPowerGeneratorModule(&EnergyModule{SourceKind: PowerSourceSolar}) {
		t.Fatal("expected populated energy module to be treated as generator")
	}
}
