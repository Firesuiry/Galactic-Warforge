package mapgen

type rng struct {
	state uint64
}

func newRNG(seed string) *rng {
	return &rng{state: hashString(seed)}
}

func (r *rng) next() uint64 {
	r.state += 0x9E3779B97F4A7C15
	z := r.state
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}

func (r *rng) Float64() float64 {
	return float64(r.next()>>11) / (1 << 53)
}

func (r *rng) Intn(n int) int {
	if n <= 0 {
		return 0
	}
	return int(r.next() % uint64(n))
}

func (r *rng) RangeFloat(min, max float64) float64 {
	if max <= min {
		return min
	}
	return min + (max-min)*r.Float64()
}

func (r *rng) RangeInt(min, max int) int {
	if max <= min {
		return min
	}
	return min + r.Intn(max-min+1)
}

func pickWeighted(r *rng, weights []float64) int {
	if len(weights) == 0 {
		return -1
	}
	total := 0.0
	for _, w := range weights {
		if w > 0 {
			total += w
		}
	}
	if total == 0 {
		return 0
	}
	pick := r.Float64() * total
	for i, w := range weights {
		if w <= 0 {
			continue
		}
		pick -= w
		if pick <= 0 {
			return i
		}
	}
	return len(weights) - 1
}

func hashString(s string) uint64 {
	var h uint64 = 14695981039346656037
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}
