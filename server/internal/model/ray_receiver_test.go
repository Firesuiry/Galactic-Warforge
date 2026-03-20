package model

import "testing"

func TestResolveRayReceiverPowerConversion(t *testing.T) {
	module := &RayReceiverModule{
		InputPerTick:       100,
		ReceiveEfficiency:  0.5,
		PowerOutputPerTick: 100,
		PowerEfficiency:    0.8,
		Mode:               RayReceiverModePower,
	}
	result, err := ResolveRayReceiver(RayReceiverRequest{
		Module:        module,
		PowerCapacity: 100,
	})
	if err != nil {
		t.Fatalf("resolve ray receiver: %v", err)
	}
	if result.PowerOutput != 40 {
		t.Fatalf("expected power output 40, got %d", result.PowerOutput)
	}
	if result.PhotonOutput != 0 {
		t.Fatalf("expected no photon output, got %d", result.PhotonOutput)
	}
}

func TestResolveRayReceiverPhotonOutputHybrid(t *testing.T) {
	module := &RayReceiverModule{
		InputPerTick:        100,
		ReceiveEfficiency:   1,
		PowerOutputPerTick:  30,
		PowerEfficiency:     1,
		PhotonOutputPerTick: 10,
		PhotonEnergyCost:    5,
		PhotonEfficiency:    1,
		Mode:                RayReceiverModeHybrid,
	}
	result, err := ResolveRayReceiver(RayReceiverRequest{
		Module:        module,
		PowerCapacity: 30,
	})
	if err != nil {
		t.Fatalf("resolve ray receiver: %v", err)
	}
	if result.PowerOutput != 30 {
		t.Fatalf("expected power output 30, got %d", result.PowerOutput)
	}
	if result.PhotonOutput != 10 {
		t.Fatalf("expected photon output 10, got %d", result.PhotonOutput)
	}
}

func TestResolveRayReceiverOverflowToPhotonWhenPowerLimited(t *testing.T) {
	module := &RayReceiverModule{
		InputPerTick:        50,
		ReceiveEfficiency:   1,
		PowerOutputPerTick:  50,
		PowerEfficiency:     1,
		PhotonOutputPerTick: 10,
		PhotonEnergyCost:    5,
		PhotonEfficiency:    1,
		Mode:                RayReceiverModeHybrid,
	}
	result, err := ResolveRayReceiver(RayReceiverRequest{
		Module:        module,
		PowerCapacity: 10,
	})
	if err != nil {
		t.Fatalf("resolve ray receiver: %v", err)
	}
	if result.PowerOutput != 10 {
		t.Fatalf("expected power output 10, got %d", result.PowerOutput)
	}
	if result.PhotonOutput != 8 {
		t.Fatalf("expected photon output 8, got %d", result.PhotonOutput)
	}
}
