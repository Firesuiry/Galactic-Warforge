package gamecore

import (
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// EventBus broadcasts game events to all subscribers
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string]chan *model.GameEvent // key: subscriber ID
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string]chan *model.GameEvent),
	}
}

func (eb *EventBus) Subscribe(id string) chan *model.GameEvent {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	ch := make(chan *model.GameEvent, 256)
	eb.subscribers[id] = ch
	return ch
}

func (eb *EventBus) Unsubscribe(id string) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	if ch, ok := eb.subscribers[id]; ok {
		close(ch)
		delete(eb.subscribers, id)
	}
}

func (eb *EventBus) SubscriberCount() int {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	return len(eb.subscribers)
}

func (eb *EventBus) Publish(events []*model.GameEvent) {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	for _, evt := range events {
		for _, ch := range eb.subscribers {
			select {
			case ch <- evt:
			default:
				// drop if subscriber is slow
			}
		}
	}
}

// Metrics captures per-tick performance data
type Metrics struct {
	mu             sync.Mutex
	TickCount      int64
	LastTickDur    time.Duration
	CommandsTotal  int64
	SSEConnections int
	QueueBacklog   int
}

func (m *Metrics) RecordTick(dur time.Duration, cmds int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.TickCount++
	m.LastTickDur = dur
	m.CommandsTotal += int64(cmds)
}

func (m *Metrics) Snapshot() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	return map[string]any{
		"tick_count":      m.TickCount,
		"last_tick_dur_ms": m.LastTickDur.Milliseconds(),
		"commands_total":  m.CommandsTotal,
		"sse_connections": m.SSEConnections,
		"queue_backlog":   m.QueueBacklog,
	}
}

// CommandLog records processed commands for audit and replay
type CommandLog struct {
	mu      sync.Mutex
	entries []commandLogEntry
}

type commandLogEntry struct {
	Tick      int64
	PlayerID  string
	RequestID string
	Commands  []model.Command
	Results   []model.CommandResult
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

// GameCore orchestrates the tick loop
type GameCore struct {
	cfg      *config.Config
	maps     *mapmodel.Universe
	discovery *mapstate.Discovery
	world    *model.WorldState
	queue    *queue.CommandQueue
	bus      *EventBus
	metrics  *Metrics
	cmdLog   *CommandLog
	rng      *rand.Rand
	stopCh   chan struct{}
	winner   string
	winnerMu sync.RWMutex
	activePlanetID string
}

// New creates a new GameCore, initialises the world map, and places player bases
func New(cfg *config.Config, maps *mapmodel.Universe, q *queue.CommandQueue, bus *EventBus) *GameCore {
	primary := maps.PrimaryPlanet()
	if primary == nil {
		log.Fatalf("map model has no planets")
	}
	rng := rand.New(rand.NewSource(primary.Seed))

	ws := model.NewWorldState(primary.ID, primary.Width, primary.Height)

	// Place resource deposits pseudo-randomly
	numDeposits := (primary.Width * primary.Height * primary.ResourceDensity) / 100
	for i := 0; i < numDeposits; i++ {
		x := rng.Intn(primary.Width)
		y := rng.Intn(primary.Height)
		ws.Grid[y][x].ResourceDeposit = 50 + rng.Intn(150)
	}

	// Initialise player state and base buildings
	basePositions := computeStartPositions(cfg, primary.Width, primary.Height)
	for i, p := range cfg.Players {
		ws.Players[p.PlayerID] = &model.PlayerState{
			PlayerID:  p.PlayerID,
			Resources: model.Resources{Minerals: 200, Energy: 100},
			IsAlive:   true,
		}

		pos := basePositions[i%len(basePositions)]
		stats := model.BuildingStats(model.BuildingTypeBase, 1)
		id := ws.NextEntityID("b")
		base := &model.Building{
			ID:          id,
			Type:        model.BuildingTypeBase,
			OwnerID:     p.PlayerID,
			Position:    pos,
			HP:          stats.HP,
			MaxHP:       stats.MaxHP,
			Level:       1,
			VisionRange: stats.VisionRange,
			MineralRate: stats.MineralRate,
			EnergyRate:  stats.EnergyRate,
			IsActive:    true,
		}
		ws.Buildings[id] = base
		tileKey := model.TileKey(pos.X, pos.Y)
		ws.TileBuilding[tileKey] = id
		ws.Grid[pos.Y][pos.X].BuildingID = id
	}

	return &GameCore{
		cfg:    cfg,
		maps:   maps,
		discovery: mapstate.NewDiscovery(cfg.Players, maps),
		world:  ws,
		queue:  q,
		bus:    bus,
		metrics: &Metrics{},
		cmdLog: &CommandLog{},
		rng:    rng,
		stopCh: make(chan struct{}),
		activePlanetID: primary.ID,
	}
}

// World returns the world state (caller must use RLock/RUnlock)
func (gc *GameCore) World() *model.WorldState {
	return gc.world
}

// Maps returns the immutable map model.
func (gc *GameCore) Maps() *mapmodel.Universe {
	return gc.maps
}

// Discovery returns the discovery state.
func (gc *GameCore) Discovery() *mapstate.Discovery {
	return gc.discovery
}

// ActivePlanetID returns the currently simulated planet ID.
func (gc *GameCore) ActivePlanetID() string {
	return gc.activePlanetID
}

// Metrics returns the metrics object
func (gc *GameCore) GetMetrics() *Metrics {
	return gc.metrics
}

// CommandLog returns the audit log
func (gc *GameCore) GetCommandLog() *CommandLog {
	return gc.cmdLog
}

// Winner returns the winning player ID, or empty string if game is ongoing
func (gc *GameCore) Winner() string {
	gc.winnerMu.RLock()
	defer gc.winnerMu.RUnlock()
	return gc.winner
}

// Run starts the tick loop (blocking); call in a goroutine
func (gc *GameCore) Run() {
	tickRate := gc.cfg.Battlefield.MaxTickRate
	if tickRate <= 0 {
		tickRate = 10
	}
	tickInterval := time.Duration(1000/tickRate) * time.Millisecond

	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	log.Printf("[GameCore] starting tick loop at %d tick/s", tickRate)

	for {
		select {
		case <-gc.stopCh:
			log.Println("[GameCore] tick loop stopped")
			return
		case <-ticker.C:
			gc.processTick()
		}
	}
}

// Stop signals the tick loop to stop
func (gc *GameCore) Stop() {
	close(gc.stopCh)
}

// processTick runs a single tick
func (gc *GameCore) processTick() {
	start := time.Now()

	gc.world.Lock()
	defer gc.world.Unlock()

	gc.world.Tick++
	currentTick := gc.world.Tick

	var allEvents []*model.GameEvent

	// 1. Drain command queue
	batch := gc.queue.Drain()
	gc.metrics.QueueBacklog = gc.queue.Len()

	// 2. Execute commands
	for _, qr := range batch {
		results, evts := gc.executeRequest(qr)
		allEvents = append(allEvents, evts...)
		gc.cmdLog.Append(commandLogEntry{
			Tick:      currentTick,
			PlayerID:  qr.PlayerID,
			RequestID: qr.Request.RequestID,
			Commands:  qr.Request.Commands,
			Results:   results,
		})
	}

	// 3. Settle resources
	resEvts := settleResources(gc.world)
	allEvents = append(allEvents, resEvts...)

	// 4. Turret auto-attack
	turretEvts := settleTurrets(gc.world)
	allEvents = append(allEvents, turretEvts...)

	// 5. Check victory
	winner := checkVictory(gc.world)
	if winner != "" {
		gc.winnerMu.Lock()
		gc.winner = winner
		gc.winnerMu.Unlock()
		log.Printf("[GameCore] player %s wins at tick %d", winner, currentTick)
	}

	// 6. Stamp tick and event IDs
	evtCounter := int64(0)
	for _, evt := range allEvents {
		evtCounter++
		evt.Tick = currentTick
		evt.EventID = fmt.Sprintf("evt-%d-%d", currentTick, evtCounter)
	}

	// 7. Publish events
	dur := time.Since(start)
	gc.metrics.RecordTick(dur, len(batch))
	gc.metrics.SSEConnections = gc.bus.SubscriberCount()

	allEvents = append(allEvents, &model.GameEvent{
		EventID:         fmt.Sprintf("evt-%d-tick", currentTick),
		Tick:            currentTick,
		EventType:       model.EvtTickCompleted,
		VisibilityScope: "all",
		Payload: map[string]any{
			"tick":        currentTick,
			"duration_ms": dur.Milliseconds(),
		},
	})

	gc.bus.Publish(allEvents)
}

// executeRequest processes all commands in a queued request
func (gc *GameCore) executeRequest(qr *model.QueuedRequest) ([]model.CommandResult, []*model.GameEvent) {
	var results []model.CommandResult
	var allEvts []*model.GameEvent

	player, ok := gc.world.Players[qr.PlayerID]
	if !ok || !player.IsAlive {
		for i := range qr.Request.Commands {
			results = append(results, model.CommandResult{
				CommandIndex: i,
				Status:       model.StatusRejected,
				Code:         model.CodeValidationFailed,
				Message:      "player not found or eliminated",
			})
		}
		return results, nil
	}

	for i, cmd := range qr.Request.Commands {
		var res model.CommandResult
		var evts []*model.GameEvent

		res.CommandIndex = i

		switch cmd.Type {
		case model.CmdScanGalaxy:
			res, evts = gc.execScanGalaxy(qr.PlayerID, cmd)
		case model.CmdScanSystem:
			res, evts = gc.execScanSystem(qr.PlayerID, cmd)
		case model.CmdScanPlanet:
			res, evts = gc.execScanPlanet(qr.PlayerID, cmd)
		case model.CmdBuild:
			res, evts = gc.execBuild(gc.world, qr.PlayerID, cmd)
		case model.CmdMove:
			res, evts = gc.execMove(gc.world, qr.PlayerID, cmd)
		case model.CmdAttack:
			res, evts = gc.execAttack(gc.world, qr.PlayerID, cmd)
		case model.CmdProduce:
			res, evts = gc.execProduce(gc.world, qr.PlayerID, cmd)
		case model.CmdUpgrade:
			res, evts = gc.execUpgrade(gc.world, qr.PlayerID, cmd)
		case model.CmdDemolish:
			res, evts = gc.execDemolish(gc.world, qr.PlayerID, cmd)
		default:
			res = model.CommandResult{
				Status:  model.StatusRejected,
				Code:    model.CodeValidationFailed,
				Message: fmt.Sprintf("unknown command type: %s", cmd.Type),
			}
		}

		res.CommandIndex = i
		results = append(results, res)
		allEvts = append(allEvts, evts...)
	}

	return results, allEvts
}

// computeStartPositions returns N spread-out starting positions
func computeStartPositions(cfg *config.Config, w, h int) []model.Position {
	n := len(cfg.Players)
	positions := make([]model.Position, n)
	margin := 3
	switch n {
	case 1:
		positions[0] = model.Position{X: w / 2, Y: h / 2}
	case 2:
		positions[0] = model.Position{X: margin, Y: margin}
		positions[1] = model.Position{X: w - margin - 1, Y: h - margin - 1}
	default:
		for i := 0; i < n; i++ {
			angle := float64(i) / float64(n) * 2 * 3.14159
			cx := w/2 + int(float64(w/2-margin)*cosApprox(angle))
			cy := h/2 + int(float64(h/2-margin)*sinApprox(angle))
			positions[i] = model.Position{X: cx, Y: cy}
		}
	}
	return positions
}

func hashString(s string) uint64 {
	var h uint64 = 14695981039346656037
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}

// Approximations to avoid importing math
func cosApprox(angle float64) float64 {
	// Taylor series cos(x) ≈ 1 - x^2/2 + x^4/24 (rough)
	x := angle
	for x > 3.14159 {
		x -= 2 * 3.14159
	}
	for x < -3.14159 {
		x += 2 * 3.14159
	}
	return 1 - x*x/2 + x*x*x*x/24
}

func sinApprox(angle float64) float64 {
	return cosApprox(angle - 3.14159/2)
}
