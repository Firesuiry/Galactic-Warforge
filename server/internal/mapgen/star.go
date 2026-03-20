package mapgen

import "siliconworld/internal/mapmodel"

type starSpec struct {
	Type      string
	Weight    float64
	MassMin   float64
	MassMax   float64
	RadiusMin float64
	RadiusMax float64
	LumMin    float64
	LumMax    float64
	TempMin   float64
	TempMax   float64
}

var starCatalog = []starSpec{
	{Type: "O", Weight: 0.00003, MassMin: 16, MassMax: 60, RadiusMin: 6.6, RadiusMax: 15, LumMin: 30000, LumMax: 1000000, TempMin: 30000, TempMax: 50000},
	{Type: "B", Weight: 0.0013, MassMin: 2.1, MassMax: 16, RadiusMin: 1.8, RadiusMax: 6.6, LumMin: 25, LumMax: 30000, TempMin: 10000, TempMax: 30000},
	{Type: "A", Weight: 0.006, MassMin: 1.4, MassMax: 2.1, RadiusMin: 1.4, RadiusMax: 1.8, LumMin: 5, LumMax: 25, TempMin: 7500, TempMax: 10000},
	{Type: "F", Weight: 0.03, MassMin: 1.04, MassMax: 1.4, RadiusMin: 1.15, RadiusMax: 1.4, LumMin: 1.5, LumMax: 5, TempMin: 6000, TempMax: 7500},
	{Type: "G", Weight: 0.08, MassMin: 0.8, MassMax: 1.04, RadiusMin: 0.9, RadiusMax: 1.15, LumMin: 0.6, LumMax: 1.5, TempMin: 5200, TempMax: 6000},
	{Type: "K", Weight: 0.12, MassMin: 0.45, MassMax: 0.8, RadiusMin: 0.7, RadiusMax: 0.9, LumMin: 0.08, LumMax: 0.6, TempMin: 3700, TempMax: 5200},
	{Type: "M", Weight: 0.76, MassMin: 0.08, MassMax: 0.45, RadiusMin: 0.1, RadiusMax: 0.7, LumMin: 0.001, LumMax: 0.08, TempMin: 2400, TempMax: 3700},
}

func generateStar(r *rng) mapmodel.Star {
	weights := make([]float64, len(starCatalog))
	for i, spec := range starCatalog {
		weights[i] = spec.Weight
	}
	idx := pickWeighted(r, weights)
	if idx < 0 {
		idx = 0
	}
	spec := starCatalog[idx]
	return mapmodel.Star{
		Type:        spec.Type,
		Mass:        r.RangeFloat(spec.MassMin, spec.MassMax),
		Radius:      r.RangeFloat(spec.RadiusMin, spec.RadiusMax),
		Luminosity:  r.RangeFloat(spec.LumMin, spec.LumMax),
		Temperature: r.RangeFloat(spec.TempMin, spec.TempMax),
	}
}
