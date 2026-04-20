package model_test

import (
	"testing"

	"siliconworld/internal/model"
)

func sensorContactLevelRank(level model.SensorContactLevel) int {
	switch level {
	case model.SensorContactLevelUnknownSignal:
		return 1
	case model.SensorContactLevelClassifiedContact:
		return 2
	case model.SensorContactLevelConfirmedType:
		return 3
	case model.SensorContactLevelFullyResolved:
		return 4
	default:
		return 0
	}
}

func TestT115EvaluateSensorContactAppliesActivePassiveDistanceAndJamming(t *testing.T) {
	base := model.SensorContactEvaluation{
		ScopeType:   model.SensorContactScopeSystem,
		ScopeID:     "sys-1",
		ContactKind: model.SensorContactKindFleet,
		EntityID:    "fleet-enemy",
		EntityType:  "fleet",
		Domain:      model.UnitDomainSpace,
		LastUpdated: 64,
		Target: model.SensorContactTargetProfile{
			Classification:   "space_fleet",
			ResolvedType:     "corvette",
			StrengthEstimate: 2,
			SignalSignature:  11,
			HeatSignature:    7,
			StealthRating:    2,
		},
		Sources: []model.SensorContactSourceInput{
			{SourceType: model.SensorSourcePassiveEM, SourceID: "fleet-scout", SourceKind: "fleet", Strength: 4},
			{SourceType: model.SensorSourceSignalTower, SourceID: "tower-1", SourceKind: "building", Strength: 3},
		},
	}

	passive, ghost := model.EvaluateSensorContact(base)
	if passive == nil {
		t.Fatal("expected passive contact result")
	}
	if passive.Level != model.SensorContactLevelClassifiedContact {
		t.Fatalf("expected passive-only sensors to classify without fully resolving, got %+v", passive)
	}
	if ghost != nil {
		t.Fatalf("expected no false contact without jamming, got %+v", ghost)
	}

	activeEval := base
	activeEval.Sources = append(activeEval.Sources,
		model.SensorContactSourceInput{SourceType: model.SensorSourceActiveRadar, SourceID: "radar-1", SourceKind: "fleet", Strength: 6},
		model.SensorContactSourceInput{SourceType: model.SensorSourceReconUnit, SourceID: "recon-1", SourceKind: "fleet", Strength: 2},
	)
	active, ghost := model.EvaluateSensorContact(activeEval)
	if active == nil {
		t.Fatal("expected active radar contact result")
	}
	if sensorContactLevelRank(active.Level) <= sensorContactLevelRank(passive.Level) {
		t.Fatalf("expected active radar to improve contact level, passive=%s active=%s", passive.Level, active.Level)
	}
	if active.Level != model.SensorContactLevelFullyResolved {
		t.Fatalf("expected active radar + recon to fully resolve close target, got %+v", active)
	}
	if ghost != nil {
		t.Fatalf("expected no false contact without jamming, got %+v", ghost)
	}

	farEval := activeEval
	farEval.DistancePenalty = 8
	far, _ := model.EvaluateSensorContact(farEval)
	if far == nil {
		t.Fatal("expected far-distance contact result")
	}
	if sensorContactLevelRank(far.Level) >= sensorContactLevelRank(active.Level) {
		t.Fatalf("expected distance penalty to reduce contact fidelity, active=%s far=%s", active.Level, far.Level)
	}

	jammedEval := activeEval
	jammedEval.Target.JammingStrength = 5
	jammed, ghost := model.EvaluateSensorContact(jammedEval)
	if jammed == nil {
		t.Fatal("expected jammed contact result")
	}
	if jammed.LockQuality >= active.LockQuality {
		t.Fatalf("expected jamming to reduce lock quality, active=%f jammed=%f", active.LockQuality, jammed.LockQuality)
	}
	if jammed.MissileDriftRisk <= 0 {
		t.Fatalf("expected jamming to introduce missile drift risk, got %+v", jammed)
	}
	if ghost == nil || !ghost.FalseContact {
		t.Fatalf("expected strong jamming to create a false contact, got real=%+v ghost=%+v", jammed, ghost)
	}
	if ghost.Level != model.SensorContactLevelUnknownSignal && ghost.Level != model.SensorContactLevelClassifiedContact {
		t.Fatalf("expected false contact to stay low-confidence, got %+v", ghost)
	}
}
