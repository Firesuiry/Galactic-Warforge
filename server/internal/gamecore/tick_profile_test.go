package gamecore

import (
	"strings"
	"testing"
	"time"
)

func TestTickProfileTopMergesAndSorts(t *testing.T) {
	var p tickProfile
	base := time.Now()
	p.reset(base)
	p.spans = append(p.spans,
		tickSpan{name: "unit_movement", dur: 12 * time.Millisecond},
		tickSpan{name: "unit_combat", dur: 80 * time.Millisecond},
		tickSpan{name: "bots", dur: 3 * time.Millisecond},
	)
	p.last = base
	p.mark("unit_movement") // 同名累加，不新增条目
	if len(p.spans) != 3 {
		t.Fatalf("mark with an existing name must merge, got %d spans", len(p.spans))
	}
	top := p.top(2)
	if !strings.HasPrefix(top, "unit_combat=80.0ms unit_movement=") || strings.Contains(top, "bots") {
		t.Fatalf("top(2) = %q, want the two slowest spans, slowest first", top)
	}
	p.reset(time.Now())
	if p.top(4) != "" {
		t.Fatalf("reset must clear spans, got %q", p.top(4))
	}
}
