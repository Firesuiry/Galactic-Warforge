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
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
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
		"tick_count":       m.TickCount,
		"last_tick_dur_ms": m.LastTickDur.Milliseconds(),
		"commands_total":   m.CommandsTotal,
		"sse_connections":  m.SSEConnections,
		"queue_backlog":    m.QueueBacklog,
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
	cfg            *config.Config
	maps           *mapmodel.Universe
	discovery      *mapstate.Discovery
	world          *model.WorldState
	queue          *queue.CommandQueue
	bus            *EventBus
	metrics        *Metrics
	cmdLog         *CommandLog
	eventHistory   *EventHistory
	alertHistory   *AlertHistory
	snapshotStore  *persistence.Store
	monitor        *productionMonitor
	rng            *rand.Rand
	stopCh         chan struct{}
	winner         string
	winnerMu       sync.RWMutex
	activePlanetID string
	executorUsage  map[string]int
	combatUnits    *CombatUnitManager
	orbitalPlatforms *OrbitalPlatformManager
}

// New creates a new GameCore, initialises the world map, and places player bases
func New(cfg *config.Config, maps *mapmodel.Universe, q *queue.CommandQueue, bus *EventBus, store *persistence.Store) *GameCore {
	if err := config.ApplyDefaults(cfg); err != nil {
		log.Fatalf("invalid config: %v", err)
	}
	primary := maps.PrimaryPlanet()
	if primary == nil {
		log.Fatalf("map model has no planets")
	}
	rng := rand.New(rand.NewSource(primary.Seed))

	ws := model.NewWorldState(primary.ID, primary.Width, primary.Height)
	applyPlanetTerrain(ws, primary)
	applyPlanetResources(ws, primary)

	// Initialise player state and base buildings
	basePositions := computeStartPositions(cfg, primary.Width, primary.Height)
	for i := range basePositions {
		basePositions[i] = findNearestBuildable(ws, basePositions[i])
	}
	for i, p := range cfg.Players {
		ps := &model.PlayerState{
			PlayerID:    p.PlayerID,
			TeamID:      p.TeamID,
			Role:        p.Role,
			Resources:   model.Resources{Minerals: 200, Energy: 100},
			IsAlive:     true,
			CombatTech:  &model.PlayerCombatTechState{PlayerID: p.PlayerID, UnlockedTechs: make(map[string]*model.CombatTech)},
		}
		ps.SetPermissions(p.Permissions)
		ws.Players[p.PlayerID] = ps

		pos := basePositions[i%len(basePositions)]
		profile := model.BuildingProfileFor(model.BuildingTypeBattlefieldAnalysisBase, 1)
		id := ws.NextEntityID("b")
		base := &model.Building{
			ID:          id,
			Type:        model.BuildingTypeBattlefieldAnalysisBase,
			OwnerID:     p.PlayerID,
			Position:    pos,
			HP:          profile.MaxHP,
			MaxHP:       profile.MaxHP,
			Level:       1,
			VisionRange: profile.VisionRange,
			Runtime:     profile.Runtime,
		}
		model.InitBuildingStorage(base)
		model.InitBuildingConveyor(base)
		model.InitBuildingSorter(base)
		model.InitBuildingLogisticsStation(base)
		model.RegisterLogisticsStation(ws, base)
		ws.Buildings[id] = base
		tileKey := model.TileKey(pos.X, pos.Y)
		ws.TileBuilding[tileKey] = id
		ws.Grid[pos.Y][pos.X].BuildingID = id

		execPos := findNearestOpenTile(ws, pos)
		execStats := model.UnitStats(model.UnitTypeExecutor)
		execID := ws.NextEntityID("u")
		executor := &model.Unit{
			ID:          execID,
			Type:        model.UnitTypeExecutor,
			OwnerID:     p.PlayerID,
			Position:    execPos,
			HP:          execStats.HP,
			MaxHP:       execStats.MaxHP,
			Attack:      execStats.Attack,
			Defense:     execStats.Defense,
			AttackRange: execStats.AttackRange,
			MoveRange:   execStats.MoveRange,
			VisionRange: execStats.VisionRange,
		}
		ws.Units[execID] = executor
		execKey := model.TileKey(execPos.X, execPos.Y)
		ws.TileUnits[execKey] = append(ws.TileUnits[execKey], execID)
		ps.Executor = model.NewExecutorState(execID, p.Executor.BuildEfficiency, p.Executor.OperateRange, p.Executor.ConcurrentTasks, p.Executor.ResearchBoost)
	}

	core := &GameCore{
		cfg:              cfg,
		maps:             maps,
		discovery:        mapstate.NewDiscovery(cfg.Players, maps),
		world:            ws,
		queue:            q,
		bus:              bus,
		metrics:          &Metrics{},
		cmdLog:           &CommandLog{},
		eventHistory:     NewEventHistory(cfg.Server.EventHistoryLimit),
		alertHistory:     NewAlertHistory(cfg.Server.AlertHistoryLimit),
		monitor:          newProductionMonitor(cfg.Server.ProductionMonitor),
		snapshotStore:    store,
		rng:              rng,
		stopCh:           make(chan struct{}),
		activePlanetID:   primary.ID,
		executorUsage:    make(map[string]int),
		combatUnits:      NewCombatUnitManager(),
		orbitalPlatforms: NewOrbitalPlatformManager(),
	}
	if store != nil {
		snap := snapshot.Capture(core.world, core.discovery)
		store.SaveSnapshot(snap)
	}
	return core
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

// CanIssueCommand checks whether a player can issue a given command type.
func (gc *GameCore) CanIssueCommand(playerID string, cmdType model.CommandType) bool {
	if gc == nil || gc.world == nil {
		return false
	}
	gc.world.RLock()
	defer gc.world.RUnlock()
	player := gc.world.Players[playerID]
	if player == nil || !player.IsAlive {
		return false
	}
	return player.HasPermission(cmdType)
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

	gc.world.Tick++
	currentTick := gc.world.Tick
	gc.executorUsage = countActiveExecutorUsage(gc.world)

	var allEvents []*model.GameEvent

	// 1. Drain command queue
	batch := gc.queue.Drain()
	gc.metrics.QueueBacklog = gc.queue.Len()

	// 2. Execute commands
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

	// 3. Progress construction queue
	constructionEvts := gc.settleConstructionQueue(gc.world)
	allEvents = append(allEvents, constructionEvts...)

	// 4. Progress building jobs
	jobEvts := settleBuildingJobs(gc.world)
	allEvents = append(allEvents, jobEvts...)

	// 4.5 Settle research
	researchEvts := settleResearch(gc.world)
	allEvents = append(allEvents, researchEvts...)

	// 5. Settle power generation
	env := currentPlanetEnvironment(gc.maps, gc.world.PlanetID)
	powerEvts := settlePowerGeneration(gc.world, env)
	allEvents = append(allEvents, powerEvts...)

	// 6. Settle ray receivers
	rayEvts := settleRayReceivers(gc.world)
	allEvents = append(allEvents, rayEvts...)

	// 6.5 Settle solar sails (orbit decay and energy production)
	solarSailEvts := settleSolarSails(gc.world.Tick)
	allEvents = append(allEvents, solarSailEvts...)

	// 7. Settle resources
	resEvts := settleResources(gc.world)
	allEvents = append(allEvents, resEvts...)

	// 8. Settle orbital collectors
	settleOrbitalCollectors(gc.world, gc.maps)

	// 9. Settle conveyors
	settleConveyors(gc.world)

	// 10. Settle sorters
	settleSorters(gc.world)

	// 11. Settle building IO
	settleBuildingIO(gc.world)

	// 11.5 Settle pipeline flow
	settlePipelineFlow(gc.world)

	// 12. Settle pipeline IO
	settlePipelineIO(gc.world)

	// 13. Settle storage buffers
	settleStorage(gc.world)

	// 13.5 Production monitoring
	if gc.monitor != nil {
		monEvts, alerts := gc.monitor.settleProductionMonitoring(gc.world, currentTick)
		allEvents = append(allEvents, monEvts...)
		if gc.alertHistory != nil && len(alerts) > 0 {
			gc.alertHistory.Record(alerts)
		}
	}

	// 14. Dispatch interstellar logistics
	settleInterstellarDispatch(gc.world)

	// 15. Settle logistics ships
	settleLogisticsShips(gc.world)

	// 16. Dispatch logistics
	settleLogisticsDispatch(gc.world)

	// 17. Settle logistics drones
	settleLogisticsDrones(gc.world)

	// 18. Turret auto-attack
	turretEvts := settleTurrets(gc.world)
	allEvents = append(allEvents, turretEvts...)

	// 18.5 Enemy forces (spawn, spread, attack)
	enemyEvts := gc.settleEnemyForces()
	allEvents = append(allEvents, enemyEvts...)

	// 18.6 Combat units (combat between units)
	combatEvts := gc.settleCombat()
	allEvents = append(allEvents, combatEvts...)

	// 18.7 Orbital combat (orbital platforms vs enemy forces)
	orbitalEvts := gc.settleOrbitalCombat()
	allEvents = append(allEvents, orbitalEvts...)

	// 18.8 Drone control
	droneEvts := gc.settleDroneControl()
	allEvents = append(allEvents, droneEvts...)

	// 19. Check victory
	winner := checkVictory(gc.world)
	if winner != "" {
		gc.winnerMu.Lock()
		gc.winner = winner
		gc.winnerMu.Unlock()
		log.Printf("[GameCore] player %s wins at tick %d", winner, currentTick)
	}

	// 20. Stamp tick and event IDs
	evtCounter := int64(0)
	for _, evt := range allEvents {
		evtCounter++
		evt.Tick = currentTick
		evt.EventID = fmt.Sprintf("evt-%d-%d", currentTick, evtCounter)
	}

	gc.world.Unlock()

	// 21. Publish events
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

	if gc.eventHistory != nil {
		gc.eventHistory.Record(allEvents)
	}

	if gc.snapshotStore != nil {
		policy := gc.snapshotStore.SnapshotPolicy()
		if policy.ShouldSnapshot(currentTick) {
			snap := snapshot.Capture(gc.world, gc.discovery)
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
		case model.CmdUpgrade:
			res, evts = gc.execUpgrade(gc.world, qr.PlayerID, cmd)
		case model.CmdDemolish:
			res, evts = gc.execDemolish(gc.world, qr.PlayerID, cmd)
		case model.CmdCancelConstruction:
			res, evts = gc.execCancelConstruction(gc.world, qr.PlayerID, cmd)
		case model.CmdRestoreConstruction:
			res, evts = gc.execRestoreConstruction(gc.world, qr.PlayerID, cmd)
		case model.CmdStartResearch:
			res, evts = gc.execStartResearch(gc.world, qr.PlayerID, cmd)
		case model.CmdCancelResearch:
			res, evts = gc.execCancelResearch(gc.world, qr.PlayerID, cmd)
		case model.CmdLaunchSolarSail:
			res, evts = gc.execLaunchSolarSail(gc.world, qr.PlayerID, cmd)
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
			angle := float64(i) / float64(n) * 2 * 3.14159
			cx := w/2 + int(float64(w/2-margin)*cosApprox(angle))
			cy := h/2 + int(float64(h/2-margin)*sinApprox(angle))
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
