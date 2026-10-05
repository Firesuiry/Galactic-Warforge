package gamecore

import (
	"sync"

	"siliconworld/internal/model"
)

// CommandLog records processed commands for audit and replay
type CommandLog struct {
	mu      sync.Mutex
	entries []commandLogEntry
}

type commandLogEntry struct {
	Tick        int64
	PlayerID    string
	RequestID   string
	IssuerType  string
	IssuerID    string
	EnqueueTick int64
	Commands    []model.Command
	Results     []model.CommandResult
}

func (cl *CommandLog) Append(entry commandLogEntry) {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	cl.entries = append(cl.entries, entry)
}

func (cl *CommandLog) All() []commandLogEntry {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	cp := make([]commandLogEntry, len(cl.entries))
	copy(cp, cl.entries)
	return cp
}

func (cl *CommandLog) ReplaceAll(entries []commandLogEntry) {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	cl.entries = append([]commandLogEntry(nil), entries...)
}

// Range returns a copy of log entries in the tick window [fromTick, toTick].
func (cl *CommandLog) Range(fromTick, toTick int64) []commandLogEntry {
	if toTick < fromTick {
		return nil
	}
	cl.mu.Lock()
	defer cl.mu.Unlock()
	var out []commandLogEntry
	for _, entry := range cl.entries {
		if entry.Tick < fromTick {
			continue
		}
		if entry.Tick > toTick {
			break
		}
		out = append(out, entry)
	}
	return out
}

// TrimBefore drops entries strictly before the given tick.
func (cl *CommandLog) TrimBefore(tick int64) int {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	if len(cl.entries) == 0 {
		return 0
	}
	cut := 0
	for cut < len(cl.entries) && cl.entries[cut].Tick < tick {
		cut++
	}
	if cut == 0 {
		return 0
	}
	cl.entries = cl.entries[cut:]
	return cut
}

// TrimAfter drops entries strictly after the given tick.
func (cl *CommandLog) TrimAfter(tick int64) int {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	if len(cl.entries) == 0 {
		return 0
	}
	keep := len(cl.entries)
	for keep > 0 && cl.entries[keep-1].Tick > tick {
		keep--
	}
	if keep == len(cl.entries) {
		return 0
	}
	removed := len(cl.entries) - keep
	cl.entries = cl.entries[:keep]
	return removed
}
