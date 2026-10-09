package gamecore

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// tickProfile 单 tick 的分段计时：慢 tick 告警时写出最耗时的几段，
// 区分「结算本身慢」与「等世界锁（查询协程长时间占读锁）」。
// 每段只是一次 time.Now()，整 tick 几十次，开销可忽略。
type tickProfile struct {
	last  time.Time
	spans []tickSpan
}

type tickSpan struct {
	name string
	dur  time.Duration
}

func (p *tickProfile) reset(now time.Time) {
	p.last = now
	p.spans = p.spans[:0]
}

// mark 把距上一次 mark 的耗时记到 name 名下（同名累加：多颗行星共用一段名）。
func (p *tickProfile) mark(name string) {
	now := time.Now()
	dur := now.Sub(p.last)
	p.last = now
	for i := range p.spans {
		if p.spans[i].name == name {
			p.spans[i].dur += dur
			return
		}
	}
	p.spans = append(p.spans, tickSpan{name: name, dur: dur})
}

// top 最耗时的 n 段，形如 "unit_combat=80.1ms unit_movement=12.0ms"。
func (p *tickProfile) top(n int) string {
	spans := append([]tickSpan(nil), p.spans...)
	sort.SliceStable(spans, func(i, j int) bool { return spans[i].dur > spans[j].dur })
	if len(spans) > n {
		spans = spans[:n]
	}
	parts := make([]string, 0, len(spans))
	for _, span := range spans {
		parts = append(parts, fmt.Sprintf("%s=%.1fms", span.name, float64(span.dur.Microseconds())/1000))
	}
	return strings.Join(parts, " ")
}
