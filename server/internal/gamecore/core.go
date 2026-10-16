package gamecore

import (
	"fmt"
	"log"
	"math/rand"
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

// GameCore orchestrates the tick loop
type GameCore struct {
	cfg            *config.Config
	maps           *mapmodel.Universe
	discovery      *mapstate.Discovery
	world          *model.WorldState
	worlds         map[string]*model.WorldState
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
	stopOnce       sync.Once
	victory        model.VictoryState
	settlement     *model.SettlementReport // F2：宣判时冻结的终局结算报告（随 victory 同锁）
	victoryMu      sync.RWMutex
	runtimeMu      sync.RWMutex
	activePlanetID string
	executorUsage  map[string]int
	spaceRuntime   *model.SpaceRuntimeState
	saveMu         sync.Mutex
	gameDir        *gamedir.Dir
	saveMeta       *gamedir.MetaFile
	baseSnapshot   *snapshot.Snapshot
	// recorder 战况录制器（recorder.go）：随 runtimeMu 保护，nil = 未录制。
	recorder *BattleRecorder
	// botReachCache 本 tick 的"目标是否可达"缓存（键 = 目标格，见 botTargetReachable）。
	botReachCache     map[string]bool
	botReachCacheTick int64
	// prof 本 tick 的分段计时（只在 tick 协程里读写），慢 tick 告警时输出。
	prof tickProfile
	// tickRateOverride 进程级 tick 速率覆盖（server.tick_rate_override，0 = 不覆盖）：
	// 只影响 tick 循环调度与对外汇报，不写回存档。
	tickRateOverride int
	// 狂飙模式（advance.go）：advanceMu 保护下面两个惰性初始化字段；
	// tickMutex 串行化定时 tick 与快进；fastForwarding 是 SSE 降采样的开关。
	advanceMu      sync.Mutex
	advanceRun     *advanceState
	tickMutex      *sync.Mutex
	fastForwarding atomic.Bool
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
		cfg:            cfg,
		maps:           maps,
		discovery:      mapstate.NewDiscovery(cfg.Players, maps),
		world:          activeWorld,
		worlds:         registry.Worlds,
		queue:          q,
		bus:            bus,
		metrics:        NewMetrics(),
		cmdLog:         &CommandLog{},
		eventHistory:   NewEventHistory(cfg.Server.EventHistoryLimit),
		alertHistory:   NewAlertHistory(cfg.Server.AlertHistoryLimit),
		monitor:        newProductionMonitor(cfg.Server.ProductionMonitor),
		snapshotStore:  store,
		rng:            rng,
		stopCh:         make(chan struct{}),
		activePlanetID: registry.ActivePlanetID,
		executorUsage:  make(map[string]int),
		spaceRuntime:   registry.SpaceRuntime,
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
	// 开局物资包绕过 inventory_capacity：预设（如 config-war 的 2090 件）本来就是
	// 为战争预设准备的，按机甲背包上限裁剪会让 bot/玩家一开局就缺料、整局卡死
	// （实测 bot 的基建决策链直接停摆）。这是配置作者明确给出的开局库存，
	// 不是游戏内产出，不适用「任何入包路径都不超上限」的运行时约束。
	items := make([]model.ItemAmount, 0, len(bootstrap.Items))
	for _, item := range bootstrap.Items {
		if item.ItemID == "" || item.Quantity <= 0 {
			continue
		}
		items = append(items, model.ItemAmount{ItemID: item.ItemID, Quantity: item.Quantity})
	}
	ps.AddItems(items, 0)
	for _, techID := range bootstrap.CompletedTechs {
		if techID == "" || ps.Tech == nil {
			continue
		}
		ps.Tech.CompletedTechs[techID] = 1
	}
}

func hasBootstrap(bootstrap config.PlayerBootstrapConfig) bool {
	return len(bootstrap.Items) > 0 ||
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

// ResearchPace 返回本局研究消耗倍率（归一化后，缺省 1）。
func (gc *GameCore) ResearchPace() float64 {
	return gc.researchPace()
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

// Run starts the tick loop (blocking); call in a goroutine
func (gc *GameCore) Run() {
	tickRate := gc.TickRate()
	tickInterval := time.Second / time.Duration(tickRate)

	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	log.Printf("[GameCore] starting tick loop at %d tick/s", tickRate)

	for {
		select {
		case <-gc.stopCh:
			log.Println("[GameCore] tick loop stopped")
			return
		case <-ticker.C:
			// runScheduledTick 先抢 tickMu：快进（advance.go）整段持有该锁，
			// 期间定时 tick 被丢弃（Ticker 在接收端阻塞时自动丢节拍）。
			gc.runScheduledTick()
		}
	}
}

// TickRate 返回本局实际使用的 tick 速率：进程级覆盖优先，否则取对局配置的
// battlefield.max_tick_rate（<=0 时兜底 10）。
func (gc *GameCore) TickRate() int {
	if gc == nil {
		return 0
	}
	if gc.tickRateOverride > 0 {
		return gc.tickRateOverride
	}
	if rate := gc.cfg.Battlefield.MaxTickRate; rate > 0 {
		return rate
	}
	return 10
}

// ApplyTickRateOverride 设置进程级 tick 速率覆盖（server.tick_rate_override）：
// 0 或负数表示不覆盖，沿用对局配置的 battlefield.max_tick_rate。
func (gc *GameCore) ApplyTickRateOverride(override int) {
	gc.applyTickRateOverride(override)
}

// applyTickRateOverride 记下进程级 tick 速率覆盖（server.tick_rate_override）。
// 覆盖只作用于本进程的 tick 循环调度与对外汇报（Session.Summary 走 TickRate），
// 不改对局配置，因此不会随存档写进 meta.json。
func (gc *GameCore) applyTickRateOverride(override int) {
	if gc == nil || override <= 0 {
		return
	}
	gc.tickRateOverride = override
}

// Stop signals the tick loop to stop; it is idempotent (F1: hot reset and
// shutdown paths may converge on the same core).
func (gc *GameCore) Stop() {
	if gc == nil || gc.stopCh == nil {
		return
	}
	gc.stopOnce.Do(func() {
		close(gc.stopCh)
	})
}

// processTick runs a single tick
func (gc *GameCore) processTick() {
	gc.runTick()
}

// runTick 执行一个 tick 并返回本 tick 的当前 tick 号与对外事件（含 tick_completed）。
// 快进（advance.go）需要逐 tick 检查停止条件，所以事件在这里返回而不是直接丢弃。
func (gc *GameCore) runTick() (int64, []*model.GameEvent) {
	start := time.Now()
	gc.prof.reset(start)

	var allEvents []*model.GameEvent
	batch := gc.queue.Drain()
	gc.metrics.QueueBacklog = gc.queue.Len()
	currentTick := int64(0)
	gc.withLockedWorlds(func() {
		// 等锁耗时单列：查询协程长时间持有读锁时，慢的是它而不是结算。
		gc.prof.mark("lock_wait")
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

		gc.prof.mark("commands")
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
		log.Printf("[WARN] slow tick %d: %v (p95: %.2fms, p99: %.2fms) top: %s",
			currentTick, dur, gc.metrics.p95(), gc.metrics.p99(), gc.prof.top(4))
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
				if cutoff := gc.auditTrimTick(currentTick, oldest); cutoff > 0 {
					gc.cmdLog.TrimBefore(cutoff)
					gc.snapshotStore.TrimAuditBeforeTick(cutoff)
				}
			}
		}
	}

	// 快进期间对外发布的事件做降采样（事件历史已记全量）：客户端不会被
	// 每 tick 的事件风暴刷屏，快进结束另有 fast_forward_finished 全量刷新。
	published := allEvents
	if gc.fastForwarding.Load() {
		published = downsampleAdvanceEvents(allEvents, currentTick)
	}
	gc.bus.Publish(published)
	return currentTick, allEvents
}

// auditTrimTick 返回审计/命令日志该裁到哪个 tick：返回 0 表示不裁剪
// （整局全留）。currentTick 由调用方传入（runTick 里读世界 tick 要再抢锁）。
//
// 默认（server.audit_retention_ticks = 0）**不裁**：审计日志是 checkpointbuild
// -export 导出「可执行构建记录」的唯一来源，裁掉开局建造段就再也导不出来
//（试玩 1016 报告 B3）。配置里给了非 0 值时，保留窗口与快照保留窗口取较大者，
// 所以旧配置（只写 snapshot_retention_ticks）的行为不变。
func (gc *GameCore) auditTrimTick(currentTick, oldestSnapshotTick int64) int64 {
	if gc == nil || gc.cfg == nil || oldestSnapshotTick <= 0 {
		return 0
	}
	window := gc.cfg.Server.AuditRetentionTicks
	if window <= 0 {
		return 0
	}
	byWindow := currentTick - window + 1
	if byWindow < oldestSnapshotTick {
		return oldestSnapshotTick
	}
	return byWindow
}

// executeRequest processes all commands in a queued request
func (gc *GameCore) executeRequest(qr *model.QueuedRequest) ([]model.CommandResult, []*model.GameEvent) {
	var results []model.CommandResult
	var allEvts []*model.GameEvent

	// F2 终局拒令：victory 宣判后对局进入 finished，常规游戏命令统一拒绝
	//（对所有玩家一致，优先于存活/权限校验；管理面 /save、/games/new、
	// /games/current 与查询类接口不走这里，不受限）。
	if gc.Finished() {
		player := gc.world.Players[qr.PlayerID]
		for i, cmd := range qr.Request.Commands {
			res := model.CommandResult{
				CommandIndex: i,
				Status:       model.StatusRejected,
				Code:         model.CodeGameFinished,
				Message:      "游戏已结束：胜负已定，不再接受命令",
			}
			results = append(results, res)
			allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
			gc.recordCommandAudit(qr, cmd, res, player, "execute", boolPtr(false))
		}
		return results, allEvts
	}

	player, ok := gc.world.Players[qr.PlayerID]
	if !ok || !player.IsAlive {
		for i, cmd := range qr.Request.Commands {
			res := model.CommandResult{
				CommandIndex: i,
				Status:       model.StatusRejected,
				Code:         model.CodeValidationFailed,
				Message:      "玩家不存在或已被淘汰",
			}
			results = append(results, res)
			allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
			gc.recordCommandAudit(qr, cmd, res, nil, "execute", boolPtr(false))
		}
		return results, allEvts
	}

	for i, cmd := range qr.Request.Commands {
		if !player.HasPermission(cmd.Type) {
			res := model.CommandResult{
				CommandIndex: i,
				Status:       model.StatusFailed,
				Code:         model.CodeUnauthorized,
				Message:      fmt.Sprintf("无权执行命令 %s", cmd.Type),
			}
			results = append(results, res)
			allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
			gc.recordCommandAudit(qr, cmd, res, player, "execute", boolPtr(false))
			continue
		}

		res, evts, executed := gc.dispatchCommand(qr.PlayerID, player, cmd)
		if !executed {
			res.CommandIndex = i
			results = append(results, res)
			allEvts = append(allEvts, commandResultEvent(qr, cmd, res))
			gc.recordCommandAudit(qr, cmd, res, player, "execute", boolPtr(false))
			continue
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
	payload := map[string]any{
		"request_id":    qr.Request.RequestID,
		"command_index": res.CommandIndex,
		"command_type":  cmd.Type,
		"status":        res.Status,
		"code":          res.Code,
		"message":       res.Message,
	}
	if res.Validation != nil {
		payload["validation"] = res.Validation
	}
	return &model.GameEvent{
		EventType:       model.EvtCommandResult,
		VisibilityScope: qr.PlayerID,
		Payload:         payload,
	}
}
