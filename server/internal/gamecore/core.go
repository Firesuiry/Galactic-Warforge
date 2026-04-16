package gamecore

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
)

// EventBus broadcasts game events to all subscribers
type EventBus struct {
	mu           sync.RWMutex
	subscribers  map[string]*eventSubscriber // key: subscriber ID
	droppedCount atomic.Uint64
}

type eventSubscriber struct {
	ch          chan *model.GameEvent
	eventFilter map[model.EventType]struct{}
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string]*eventSubscriber),
	}
}

func (eb *EventBus) Subscribe(id string, eventTypes []model.EventType) chan *model.GameEvent {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	ch := make(chan *model.GameEvent, 256)
	eb.subscribers[id] = &eventSubscriber{
		ch:          ch,
		eventFilter: buildEventFilterSet(eventTypes),
	}
	return ch
}

func (eb *EventBus) Unsubscribe(id string) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	if sub, ok := eb.subscribers[id]; ok {
		close(sub.ch)
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
		for _, sub := range eb.subscribers {
			if !matchesEventFilter(evt, sub.eventFilter) {
				continue
			}
			select {
			case sub.ch <- evt:
			default:
				eb.droppedCount.Add(1)
			}
		}
	}
}

func (eb *EventBus) DroppedCount() uint64 {
	if eb == nil {
		return 0
	}
	return eb.droppedCount.Load()
}

func buildEventFilterSet(eventTypes []model.EventType) map[model.EventType]struct{} {
	if len(eventTypes) == 0 {
		return nil
	}
	filter := make(map[model.EventType]struct{}, len(eventTypes))
	for _, eventType := range eventTypes {
		filter[eventType] = struct{}{}
	}
	return filter
}

func matchesEventFilter(evt *model.GameEvent, filter map[model.EventType]struct{}) bool {
	if evt == nil || len(filter) == 0 {
		return true
	}
	_, ok := filter[evt.EventType]
	return ok
}

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

// eventSlicePool pools event slices to reduce allocations
var eventSlicePool = sync.Pool{
	New: func() any {
		return make([]*model.GameEvent, 0, 64)
	},
}

// GetEventSlice gets a pooled event slice
func GetEventSlice() []*model.GameEvent {
	return eventSlicePool.Get().([]*model.GameEvent)
}

// PutEventSlice returns an event slice to the pool
func PutEventSlice(es []*model.GameEvent) {
	if cap(es) >= 64 { // Only pool reasonably sized slices
		eventSlicePool.Put(es[:0])
	}
}

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

// GameCore orchestrates the tick loop
type GameCore struct {
	cfg              *config.Config
	maps             *mapmodel.Universe
	discovery        *mapstate.Discovery
	world            *model.WorldState
	worlds           map[string]*model.WorldState
	queue            *queue.CommandQueue
	bus              *EventBus
	metrics          *Metrics
	cmdLog           *CommandLog
	eventHistory     *EventHistory
	alertHistory     *AlertHistory
	snapshotStore    *persistence.Store
	monitor          *productionMonitor
	rng              *rand.Rand
	stopCh           chan struct{}
	victory          model.VictoryState
	victoryMu        sync.RWMutex
	runtimeMu        sync.RWMutex
	activePlanetID   string
	executorUsage    map[string]int
	spaceRuntime     *model.SpaceRuntimeState
	combatUnits      *CombatUnitManager
	orbitalPlatforms *OrbitalPlatformManager
	saveMu           sync.Mutex
	gameDir          *gamedir.Dir
	saveMeta         *gamedir.MetaFile
	baseSnapshot     *snapshot.Snapshot
}

// New creates a new GameCore, initialises the world map, and places player bases
func New(cfg *config.Config, maps *mapmodel.Universe, q *queue.CommandQueue, bus *EventBus, store *persistence.Store) *GameCore {
	if err := config.ApplyDefaults(cfg); err != nil {
		log.Fatalf("invalid config: %v", err)
	}
	if maps.PrimaryPlanet() == nil {
		log.Fatalf("map model has no planets")
	}
	registry, err := bootstrapInitialRuntimeRegistry(cfg, maps)
	if err != nil {
		log.Fatalf("invalid scenario bootstrap: %v", err)
	}
	activeWorld := registry.Worlds[registry.ActivePlanetID]
	if activeWorld == nil {
		log.Fatalf("active planet runtime %s missing", registry.ActivePlanetID)
	}
	activePlanet, _ := maps.Planet(registry.ActivePlanetID)
	rngSeed := int64(1)
	if activePlanet != nil {
		rngSeed = activePlanet.Seed
	}
	rng := rand.New(rand.NewSource(rngSeed))

	core := &GameCore{
		cfg:              cfg,
		maps:             maps,
		discovery:        mapstate.NewDiscovery(cfg.Players, maps),
		world:            activeWorld,
		worlds:           registry.Worlds,
		queue:            q,
		bus:              bus,
		metrics:          NewMetrics(),
		cmdLog:           &CommandLog{},
		eventHistory:     NewEventHistory(cfg.Server.EventHistoryLimit),
		alertHistory:     NewAlertHistory(cfg.Server.AlertHistoryLimit),
		monitor:          newProductionMonitor(cfg.Server.ProductionMonitor),
		snapshotStore:    store,
		rng:              rng,
		stopCh:           make(chan struct{}),
		activePlanetID:   registry.ActivePlanetID,
		executorUsage:    make(map[string]int),
		spaceRuntime:     registry.SpaceRuntime,
		combatUnits:      NewCombatUnitManager(),
		orbitalPlatforms: NewOrbitalPlatformManager(),
	}
	if core.spaceRuntime == nil {
		core.spaceRuntime = model.NewSpaceRuntimeState()
	}
	for _, planetID := range core.sortedPlanetIDs() {
		planet, _ := maps.Planet(planetID)
		systemID := ""
		galaxyID := ""
		if planet != nil {
			systemID = planet.SystemID
			if system, ok := maps.System(planet.SystemID); ok && system != nil {
				galaxyID = system.GalaxyID
			}
		}
		for _, player := range cfg.Players {
			if galaxyID != "" {
				core.discovery.DiscoverGalaxy(player.PlayerID, galaxyID)
			}
			if systemID != "" {
				core.discovery.DiscoverSystem(player.PlayerID, systemID)
			}
			core.discovery.DiscoverPlanet(player.PlayerID, planetID)
		}
	}
	if store != nil {
		snap := snapshot.CaptureRuntime(core.worlds, core.activePlanetID, core.discovery, core.spaceRuntime)
		store.SaveSnapshot(snap)
	}
	return core
}

func applyPlayerBootstrap(ps *model.PlayerState, bootstrap config.PlayerBootstrapConfig) {
	if ps == nil {
		return
	}
	if !hasBootstrap(bootstrap) {
		return
	}
	ps.Resources.Minerals = bootstrap.Minerals
	ps.Resources.Energy = bootstrap.Energy
	for _, item := range bootstrap.Inventory {
		if item.ItemID == "" || item.Quantity <= 0 {
			continue
		}
		ps.EnsureInventory()[item.ItemID] += item.Quantity
	}
	for _, techID := range bootstrap.CompletedTechs {
		if techID == "" || ps.Tech == nil {
			continue
		}
		ps.Tech.CompletedTechs[techID] = 1
	}
}

func hasBootstrap(bootstrap config.PlayerBootstrapConfig) bool {
	return bootstrap.Minerals != 0 ||
		bootstrap.Energy != 0 ||
		len(bootstrap.Inventory) > 0 ||
		len(bootstrap.CompletedTechs) > 0
}

// World returns the world state (caller must use RLock/RUnlock)
func (gc *GameCore) World() *model.WorldState {
	if gc == nil {
		return nil
	}
	gc.runtimeMu.RLock()
	defer gc.runtimeMu.RUnlock()
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

// SpaceRuntime returns the authoritative shared space runtime.
func (gc *GameCore) SpaceRuntime() *model.SpaceRuntimeState {
	return gc.spaceRuntime
}

// CanIssueCommand checks whether a player can issue a given command type.
func (gc *GameCore) CanIssueCommand(playerID string, cmdType model.CommandType) bool {
	ws := gc.World()
	if ws == nil {
		return false
	}
	ws.RLock()
	defer ws.RUnlock()
	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		return false
	}
	return player.HasPermission(cmdType)
}

// ActivePlanetID returns the currently simulated planet ID.
func (gc *GameCore) ActivePlanetID() string {
	if gc == nil {
		return ""
	}
	gc.runtimeMu.RLock()
	defer gc.runtimeMu.RUnlock()
	return gc.activePlanetID
}

// CurrentTick returns the current tick of the active world.
func (gc *GameCore) CurrentTick() int64 {
	ws := gc.World()
	if ws == nil {
		return 0
	}
	ws.RLock()
	defer ws.RUnlock()
	return ws.Tick
}

func (gc *GameCore) setCurrentWorld(planetID string, ws *model.WorldState) {
	if gc == nil || ws == nil {
		return
	}
	gc.runtimeMu.Lock()
	defer gc.runtimeMu.Unlock()
	gc.activePlanetID = planetID
	gc.world = ws
}

// Metrics returns the metrics object
func (gc *GameCore) GetMetrics() *Metrics {
	return gc.metrics
}

// CommandLog returns the audit log
func (gc *GameCore) GetCommandLog() *CommandLog {
	return gc.cmdLog
}

// EventHistory returns the in-memory event history store.
func (gc *GameCore) EventHistory() *EventHistory {
	return gc.eventHistory
}

// AlertHistory returns the in-memory production alert history store.
func (gc *GameCore) AlertHistory() *AlertHistory {
	return gc.alertHistory
}

// Winner returns the winning player ID, or empty string if game is ongoing
func (gc *GameCore) Winner() string {
	return gc.Victory().WinnerID
}

// Victory returns the resolved victory payload, or zero value while ongoing.
func (gc *GameCore) Victory() model.VictoryState {
	gc.victoryMu.RLock()
	defer gc.victoryMu.RUnlock()
	return gc.victory
}

func (gc *GameCore) declareVictory(victory model.VictoryState) bool {
	if !victory.Declared() {
		return false
	}
	gc.victoryMu.Lock()
	defer gc.victoryMu.Unlock()
	if gc.victory.Declared() {
		return false
	}
	gc.victory = victory
	return true
}

func (gc *GameCore) setVictoryState(victory model.VictoryState) {
	gc.victoryMu.Lock()
	defer gc.victoryMu.Unlock()
	gc.victory = victory
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

	var allEvents []*model.GameEvent
	batch := gc.queue.Drain()
	gc.metrics.QueueBacklog = gc.queue.Len()
	currentTick := int64(0)
	gc.withLockedWorlds(func() {
		frame := gc.advanceWorldsOneTick()
		currentTick = frame.currentTick

		for _, qr := range batch {
			results, evts := gc.executeRequest(qr)
			allEvents = append(allEvents, evts...)
			gc.cmdLog.Append(commandLogEntry{
				Tick:        currentTick,
				PlayerID:    qr.PlayerID,
				RequestID:   qr.Request.RequestID,
				IssuerType:  qr.Request.IssuerType,
				IssuerID:    qr.Request.IssuerID,
				EnqueueTick: qr.EnqueueTick,
				Commands:    qr.Request.Commands,
				Results:     results,
			})
		}

		phaseEvents := gc.runSettlementPipeline(frame)
		allEvents = append(allEvents, phaseEvents...)

		if hasVictoryDeclaredEvent(phaseEvents) {
			victory := gc.Victory()
			log.Printf("[GameCore] player %s wins at tick %d (%s)", victory.WinnerID, currentTick, victory.Reason)
		}

		evtCounter := int64(0)
		for _, evt := range allEvents {
			evtCounter++
			evt.Tick = currentTick
			evt.EventID = fmt.Sprintf("evt-%d-%d", currentTick, evtCounter)
		}
	})

	// 21. Publish events
	dur := time.Since(start)
	gc.metrics.RecordTick(dur, len(batch))
	gc.metrics.SSEConnections = gc.bus.SubscriberCount()

	// Warn if tick is slow (p95 target: <100ms)
	if dur > 100*time.Millisecond {
		log.Printf("[WARN] slow tick %d: %v (p95: %.2fms, p99: %.2fms)",
			currentTick, dur, gc.metrics.p95(), gc.metrics.p99())
	}

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

	if gc.eventHistory != nil {
		gc.eventHistory.Record(allEvents)
	}

	if gc.snapshotStore != nil {
		policy := gc.snapshotStore.SnapshotPolicy()
		if policy.ShouldSnapshot(currentTick) {
			snap := snapshot.CaptureRuntime(gc.worlds, gc.activePlanetID, gc.discovery, gc.spaceRuntime)
			gc.snapshotStore.SaveSnapshot(snap)
			if oldest := gc.snapshotStore.OldestSnapshotTick(); oldest > 0 {
				gc.cmdLog.TrimBefore(oldest)
				gc.snapshotStore.TrimAuditBeforeTick(oldest)
			}
		}
	}

	gc.bus.Publish(allEvents)
}

// executeRequest processes all commands in a queued request
func (gc *GameCore) executeRequest(qr *model.QueuedRequest) ([]model.CommandResult, []*model.GameEvent) {
	var results []model.CommandResult
	var allEvts []*model.GameEvent

	player, ok := gc.world.Players[qr.PlayerID]
	if !ok || !player.IsAlive {
		for i, cmd := range qr.Request.Commands {
			res := model.CommandResult{
				CommandIndex: i,
				Status:       model.StatusRejected,
				Code:         model.CodeValidationFailed,
				Message:      "player not found or eliminated",
			}
			results = append(results, res)
			allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
			gc.recordCommandAudit(qr, cmd, res, nil, "execute", boolPtr(false))
		}
		return results, allEvts
	}

	for i, cmd := range qr.Request.Commands {
		var res model.CommandResult
		var evts []*model.GameEvent

		res.CommandIndex = i

		if !player.HasPermission(cmd.Type) {
			res.Status = model.StatusFailed
			res.Code = model.CodeUnauthorized
			res.Message = fmt.Sprintf("permission denied for command %s", cmd.Type)
			results = append(results, res)
			allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
			gc.recordCommandAudit(qr, cmd, res, player, "execute", boolPtr(false))
			continue
		}

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
		case model.CmdDeploySquad:
			res, evts = gc.execDeploySquad(gc.world, qr.PlayerID, cmd)
		case model.CmdCommissionFleet:
			res, evts = gc.execCommissionFleet(gc.world, qr.PlayerID, cmd)
		case model.CmdFleetAssign:
			res, evts = gc.execFleetAssign(gc.world, qr.PlayerID, cmd)
		case model.CmdFleetAttack:
			res, evts = gc.execFleetAttack(gc.world, qr.PlayerID, cmd)
		case model.CmdFleetDisband:
			res, evts = gc.execFleetDisband(gc.world, qr.PlayerID, cmd)
		case model.CmdUpgrade:
			res, evts = gc.execUpgrade(gc.world, qr.PlayerID, cmd)
		case model.CmdDemolish:
			res, evts = gc.execDemolish(gc.world, qr.PlayerID, cmd)
		case model.CmdConfigureLogisticsStation:
			res, evts = gc.execConfigureLogisticsStation(gc.world, qr.PlayerID, cmd)
		case model.CmdConfigureLogisticsSlot:
			res, evts = gc.execConfigureLogisticsSlot(gc.world, qr.PlayerID, cmd)
		case model.CmdCancelConstruction:
			res, evts = gc.execCancelConstruction(gc.world, qr.PlayerID, cmd)
		case model.CmdRestoreConstruction:
			res, evts = gc.execRestoreConstruction(gc.world, qr.PlayerID, cmd)
		case model.CmdStartResearch:
			res, evts = gc.execStartResearch(gc.world, qr.PlayerID, cmd)
		case model.CmdCancelResearch:
			res, evts = gc.execCancelResearch(gc.world, qr.PlayerID, cmd)
		case model.CmdTransferItem:
			res, evts = gc.execTransferItem(gc.world, qr.PlayerID, cmd)
		case model.CmdSwitchActivePlanet:
			res, evts = gc.execSwitchActivePlanet(qr.PlayerID, cmd)
		case model.CmdLaunchSolarSail:
			res, evts = gc.execLaunchSolarSail(gc.world, qr.PlayerID, cmd)
		case model.CmdLaunchRocket:
			res, evts = gc.execLaunchRocket(gc.world, qr.PlayerID, cmd)
		case model.CmdBuildDysonNode:
			res, evts = gc.execBuildDysonNode(gc.world, qr.PlayerID, cmd)
		case model.CmdBuildDysonFrame:
			res, evts = gc.execBuildDysonFrame(gc.world, qr.PlayerID, cmd)
		case model.CmdBuildDysonShell:
			res, evts = gc.execBuildDysonShell(gc.world, qr.PlayerID, cmd)
		case model.CmdDemolishDyson:
			res, evts = gc.execDemolishDyson(gc.world, qr.PlayerID, cmd)
		case model.CmdSetRayReceiverMode:
			res, evts = gc.execSetRayReceiverMode(gc.world, qr.PlayerID, cmd)
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
		allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
		gc.recordCommandAudit(qr, cmd, res, player, "execute", boolPtr(true))
	}

	return results, allEvts
}

func commandResultEvent(qr *model.QueuedRequest, cmd model.Command, res model.CommandResult) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtCommandResult,
		VisibilityScope: qr.PlayerID,
		Payload: map[string]any{
			"request_id":    qr.Request.RequestID,
			"command_index": res.CommandIndex,
			"command_type":  cmd.Type,
			"status":        res.Status,
			"code":          res.Code,
			"message":       res.Message,
		},
	}
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
			angle := float64(i) / float64(n) * 2 * math.Pi
			cx := w/2 + int(float64(w/2-margin)*math.Cos(angle))
			cy := h/2 + int(float64(h/2-margin)*math.Sin(angle))
			positions[i] = model.Position{X: cx, Y: cy}
		}
	}
	return positions
}

func applyPlanetTerrain(ws *model.WorldState, planet *mapmodel.Planet) {
	if ws == nil || planet == nil || len(planet.Terrain) == 0 {
		return
	}
	if len(planet.Terrain) != ws.MapHeight {
		return
	}
	for y := 0; y < ws.MapHeight; y++ {
		row := planet.Terrain[y]
		if len(row) != ws.MapWidth {
			return
		}
		for x := 0; x < ws.MapWidth; x++ {
			ws.Grid[y][x].Terrain = row[x]
		}
	}
}

func applyPlanetResources(ws *model.WorldState, planet *mapmodel.Planet) {
	if ws == nil || planet == nil || len(planet.Resources) == 0 {
		return
	}
	if ws.Resources == nil {
		ws.Resources = make(map[string]*model.ResourceNodeState)
	}
	for _, node := range planet.Resources {
		pos := model.Position{X: node.Position.X, Y: node.Position.Y}
		if !ws.InBounds(pos.X, pos.Y) {
			continue
		}
		state := &model.ResourceNodeState{
			ID:           node.ID,
			PlanetID:     node.PlanetID,
			Kind:         string(node.Kind),
			Behavior:     string(node.Behavior),
			Position:     pos,
			ClusterID:    node.ClusterID,
			MaxAmount:    node.Total,
			Remaining:    node.Total,
			BaseYield:    node.BaseYield,
			CurrentYield: node.BaseYield,
			MinYield:     node.MinYield,
			RegenPerTick: node.RegenPerTick,
			DecayPerTick: node.DecayPerTick,
			IsRare:       node.IsRare,
		}
		ws.Resources[node.ID] = state
		ws.Grid[pos.Y][pos.X].ResourceNodeID = node.ID
	}
}

func findNearestBuildable(ws *model.WorldState, start model.Position) model.Position {
	if ws == nil {
		return start
	}
	if ws.InBounds(start.X, start.Y) && ws.Grid[start.Y][start.X].Terrain.Buildable() {
		return start
	}
	limit := max(ws.MapWidth, ws.MapHeight)
	for r := 1; r <= limit; r++ {
		for dy := -r; dy <= r; dy++ {
			y := start.Y + dy
			if y < 0 || y >= ws.MapHeight {
				continue
			}
			for dx := -r; dx <= r; dx++ {
				x := start.X + dx
				if x < 0 || x >= ws.MapWidth {
					continue
				}
				if ws.Grid[y][x].Terrain.Buildable() {
					return model.Position{X: x, Y: y}
				}
			}
		}
	}
	return start
}

func findNearestOpenTile(ws *model.WorldState, start model.Position) model.Position {
	if ws == nil {
		return start
	}
	if ws.InBounds(start.X, start.Y) && ws.Grid[start.Y][start.X].Terrain.Buildable() {
		tileKey := model.TileKey(start.X, start.Y)
		if _, occupied := ws.TileBuilding[tileKey]; !occupied {
			return start
		}
	}
	limit := max(ws.MapWidth, ws.MapHeight)
	for r := 1; r <= limit; r++ {
		for dy := -r; dy <= r; dy++ {
			y := start.Y + dy
			if y < 0 || y >= ws.MapHeight {
				continue
			}
			for dx := -r; dx <= r; dx++ {
				x := start.X + dx
				if x < 0 || x >= ws.MapWidth {
					continue
				}
				if !ws.Grid[y][x].Terrain.Buildable() {
					continue
				}
				tileKey := model.TileKey(x, y)
				if _, occupied := ws.TileBuilding[tileKey]; occupied {
					continue
				}
				return model.Position{X: x, Y: y}
			}
		}
	}
	return start
}

func hashString(s string) uint64 {
	var h uint64 = 14695981039346656037
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}
