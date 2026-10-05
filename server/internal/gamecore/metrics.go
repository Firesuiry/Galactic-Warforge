package gamecore

import (
	"sort"
	"sync"
	"time"
)

// Metrics captures per-tick performance data
type Metrics struct {
	mu              sync.Mutex
	TickCount       int64
	LastTickDur     time.Duration
	CommandsTotal   int64
	SSEConnections  int
	QueueBacklog    int
	TickDurationsMs []float64 // Rolling window for p95/p99
	maxDurWindow    int
}

func NewMetrics() *Metrics {
	return &Metrics{
		maxDurWindow:    1000, // Keep last 1000 ticks for percentile calculation
		TickDurationsMs: make([]float64, 0, 1000),
	}
}

func (m *Metrics) RecordTick(dur time.Duration, cmds int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.TickCount++
	m.LastTickDur = dur
	m.CommandsTotal += int64(cmds)

	// Store duration in rolling window
	m.TickDurationsMs = append(m.TickDurationsMs, float64(dur.Milliseconds()))
	if len(m.TickDurationsMs) > m.maxDurWindow {
		m.TickDurationsMs = m.TickDurationsMs[len(m.TickDurationsMs)-m.maxDurWindow:]
	}
}

// p95 returns the 95th percentile tick duration
func (m *Metrics) p95() float64 {
	m.mu.Lock()
	sorted := make([]float64, len(m.TickDurationsMs))
	copy(sorted, m.TickDurationsMs)
	m.mu.Unlock()
	return percentile(sorted, 0.95)
}

// p99 returns the 99th percentile tick duration
func (m *Metrics) p99() float64 {
	m.mu.Lock()
	sorted := make([]float64, len(m.TickDurationsMs))
	copy(sorted, m.TickDurationsMs)
	m.mu.Unlock()
	return percentile(sorted, 0.99)
}

func percentile(values []float64, ratio float64) float64 {
	if len(values) == 0 {
		return 0
	}
	n := int(float64(len(values)) * ratio)
	if n < 1 {
		n = 1
	}
	if n > len(values) {
		n = len(values)
	}
	sort.Float64s(values)
	return values[n-1]
}

func (m *Metrics) Snapshot() map[string]any {
	m.mu.Lock()
	tickCount := m.TickCount
	lastTickDur := m.LastTickDur
	commandsTotal := m.CommandsTotal
	sseConnections := m.SSEConnections
	queueBacklog := m.QueueBacklog
	durations := make([]float64, len(m.TickDurationsMs))
	copy(durations, m.TickDurationsMs)
	m.mu.Unlock()
	return map[string]any{
		"tick_count":       tickCount,
		"last_tick_dur_ms": lastTickDur.Milliseconds(),
		"commands_total":   commandsTotal,
		"sse_connections":  sseConnections,
		"queue_backlog":    queueBacklog,
		"tick_p95_ms":      percentile(durations, 0.95),
		"tick_p99_ms":      percentile(durations, 0.99),
	}
}
