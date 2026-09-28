package startup

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gamedir"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/query"
	"siliconworld/internal/queue"
	"siliconworld/internal/snapshot"
	"siliconworld/internal/visibility"
)

// Session 是一局完整装配好的对局：配置、地图、核心、事件总线、命令队列与查询层。
// F1 热重置以 Session 为原子单位整体替换；任何请求处理路径都应先取当前
// Session 再访问其中的 core/bus/queue，禁止跨 handler 长期缓存。
type Session struct {
	Config    *config.Config
	Maps      *mapmodel.Universe
	Core      *gamecore.GameCore
	Bus       *gamecore.EventBus
	Queue     *queue.CommandQueue
	Query     *query.Layer
	Vis       *visibility.Engine
	KeyMap    map[string]string // bearer key -> player_id
	StartedAt time.Time
}

// NewSession 装配一个完整对局 session（查询层/可视化引擎/键映射在这里一次性构建）。
func NewSession(cfg *config.Config, maps *mapmodel.Universe, core *gamecore.GameCore, bus *gamecore.EventBus, q *queue.CommandQueue) *Session {
	vis := visibility.New()
	return &Session{
		Config:    cfg,
		Maps:      maps,
		Core:      core,
		Bus:       bus,
		Queue:     q,
		Query:     query.New(vis, maps, core.Discovery()),
		Vis:       vis,
		KeyMap:    cfg.KeyToPlayer(),
		StartedAt: time.Now().UTC(),
	}
}

// shutdown 停止 tick 循环并断开旧事件总线上的全部订阅（幂等）。
func (sess *Session) shutdown() {
	if sess == nil {
		return
	}
	if sess.Core != nil {
		sess.Core.Stop()
	}
	if sess.Bus != nil {
		sess.Bus.CloseAll()
	}
}

// GamePlayerSummary 是 /games/current 与 /games/new 响应中的玩家概要（绝不含 key）。
type GamePlayerSummary struct {
	PlayerID      string `json:"player_id"`
	Role          string `json:"role"`
	TeamID        string `json:"team_id"`
	Bot           string `json:"bot,omitempty"`
	IsAlive       bool   `json:"is_alive"`
	FocusPlanetID string `json:"focus_planet_id,omitempty"` // F4：玩家自己的视图焦点行星
}

// GameVictorySummary 是当前对局的胜利判定概要。
type GameVictorySummary struct {
	Declared bool   `json:"declared"`
	WinnerID string `json:"winner_id,omitempty"`
	TeamID   string `json:"team_id,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// GameSummary 描述当前对局概况，供大厅 UI / CLI 使用。
type GameSummary struct {
	MapSeed         string              `json:"map_seed"`
	EnemyDifficulty string              `json:"enemy_difficulty"`
	VictoryMode     string              `json:"victory_mode"`
	MaxTickRate     int                 `json:"max_tick_rate"`
	ActivePlanetID  string              `json:"active_planet_id"`
	Tick            int64               `json:"tick"`
	StartedAt       time.Time           `json:"started_at"`
	Players         []GamePlayerSummary `json:"players"`
	Victory         GameVictorySummary  `json:"victory"`
}

// Summary 采集当前对局概要。
func (sess *Session) Summary() GameSummary {
	cfg := sess.Config
	sum := GameSummary{
		MapSeed:         cfg.Battlefield.MapSeed,
		EnemyDifficulty: cfg.Battlefield.EnemyDifficulty,
		VictoryMode:     model.NormalizeVictoryRule(cfg.Battlefield.VictoryRule),
		MaxTickRate:     cfg.Battlefield.MaxTickRate,
		StartedAt:       sess.StartedAt,
	}
	if sess.Core != nil {
		sum.ActivePlanetID = sess.Core.ActivePlanetID()
		sum.Tick = sess.Core.CurrentTick()
		victory := sess.Core.Victory()
		sum.Victory = GameVictorySummary{
			Declared: victory.Declared(),
			WinnerID: victory.WinnerID,
			TeamID:   victory.TeamID,
			Reason:   victory.Reason,
		}
	}
	alive := make(map[string]bool, len(cfg.Players))
	focus := make(map[string]string, len(cfg.Players))
	if ws := sess.Core.World(); ws != nil {
		ws.RLock()
		for pid, player := range ws.Players {
			if player != nil {
				alive[pid] = player.IsAlive
				focus[pid] = player.FocusPlanetID
			}
		}
		ws.RUnlock()
	}
	players := make([]GamePlayerSummary, 0, len(cfg.Players))
	for _, p := range cfg.Players {
		players = append(players, GamePlayerSummary{
			PlayerID:      p.PlayerID,
			Role:          p.Role,
			TeamID:        p.TeamID,
			Bot:           p.Bot,
			IsAlive:       alive[p.PlayerID],
			FocusPlanetID: focus[p.PlayerID],
		})
	}
	sort.Slice(players, func(i, j int) bool { return players[i].PlayerID < players[j].PlayerID })
	sum.Players = players
	return sum
}

// NewGamePlayer 是 POST /games/new 请求体中的玩家定义，字段沿用 config.PlayerConfig 语义。
type NewGamePlayer struct {
	PlayerID  string                          `json:"player_id"`
	Key       string                          `json:"key"`
	Role      string                          `json:"role,omitempty"`      // admin|commander|observer，空默认 commander
	TeamID    string                          `json:"team_id,omitempty"`   // 空默认 player_id
	Bot       string                          `json:"bot,omitempty"`       // easy|normal|hard，空为人类玩家
	Bootstrap *config.PlayerBootstrapConfig   `json:"bootstrap,omitempty"` // 可选，沿用现有 config 结构
}

// NewGameRequest 是 POST /games/new 的请求体。
// 地图规则沿用服务端启动时的 mapconfig 文件，仅允许通过 map_seed 换地图。
type NewGameRequest struct {
	MapSeed         string          `json:"map_seed,omitempty"`         // 空则随机生成
	EnemyDifficulty string          `json:"enemy_difficulty,omitempty"` // off|easy|normal|hard，空默认 normal
	VictoryMode     string          `json:"victory_mode,omitempty"`     // elimination|mission_complete|hybrid|sandbox，空默认 elimination
	Players         []NewGamePlayer `json:"players"`
}

// ErrInvalidNewGame 标记新局请求的字段校验失败（HTTP 层映射为 400）。
var ErrInvalidNewGame = errors.New("invalid new game request")

// Runtime 持有"当前对局"并支持热重置（F1）：重建 GameCore/事件总线/命令队列，
// 旧局状态全部清理后原子切换到新局。服务端进程仍是一局一世界，但不再一局一生。
type Runtime struct {
	serverCfg config.ServerConfig
	mapCfg    *mapconfig.Config
	dir       *gamedir.Dir

	current atomic.Pointer[Session]

	resetMu sync.Mutex // 串行化 Reset/Save/Start/Stop：存档写入热重置间隙不允许交叉
	started bool       // Start 之后 adopt 新局才会拉起 tick 循环与 autosave

	autosaveStop chan struct{}
	autosaveDone chan struct{}

	stopOnce sync.Once
}

// NewRuntime 构建热重置能力的运行时（仅装配依赖，不 boot 对局）。
// serverCfg 中的端口/快照策略/autosave 间隔等 server 段在热重置后保持不变。
func NewRuntime(serverCfg config.ServerConfig, mapCfg *mapconfig.Config) (*Runtime, error) {
	if mapCfg != nil {
		cp := *mapCfg
		mapCfg = &cp
	}
	return &Runtime{
		serverCfg: serverCfg,
		mapCfg:    mapCfg,
		dir:       gamedir.Open(serverCfg.DataDir),
	}, nil
}

// NewStaticRuntime 包装一个已装配好的 session：不启动任何 goroutine，也不支持 Reset。
// 供手动构建 core 的测试使用；生产路径一律走 NewRuntime/LoadRuntime。
func NewStaticRuntime(sess *Session) *Runtime {
	rt := &Runtime{}
	if sess != nil && sess.Config != nil {
		rt.serverCfg = sess.Config.Server
	}
	rt.current.Store(sess)
	return rt
}

// Current 返回当前对局 session（可能为 nil，尚未 boot 时）。
func (rt *Runtime) Current() *Session {
	if rt == nil {
		return nil
	}
	return rt.current.Load()
}

// ServerConfig 返回热重置后保持不变的 server 段配置。
func (rt *Runtime) ServerConfig() config.ServerConfig {
	return rt.serverCfg
}

// Start 拉起当前对局的 tick 循环与 autosave（由 main 在 HTTP 监听前调用一次）。
// 之后的 Reset 会自动为新局拉起同样的 goroutine。
func (rt *Runtime) Start() {
	if rt == nil {
		return
	}
	rt.resetMu.Lock()
	defer rt.resetMu.Unlock()
	if rt.started {
		return
	}
	rt.started = true
	rt.startSessionLocked(rt.current.Load())
}

// Stop 停止 autosave 与当前对局（幂等）。
func (rt *Runtime) Stop() {
	if rt == nil {
		return
	}
	rt.stopOnce.Do(func() {
		rt.resetMu.Lock()
		defer rt.resetMu.Unlock()
		rt.stopAutosaveLocked()
		rt.current.Load().shutdown()
	})
}

// Save 在与热重置互斥的前提下执行一次手动存档（F1：避免旧局晚到的写入覆盖新局存档）。
func (rt *Runtime) Save(trigger string) (*gamecore.SaveResult, error) {
	rt.resetMu.Lock()
	defer rt.resetMu.Unlock()
	sess := rt.current.Load()
	if sess == nil || sess.Core == nil {
		return nil, fmt.Errorf("no active game session")
	}
	return sess.Core.Save(trigger)
}

// Reset 校验并开一局全新的游戏，原子替换当前对局（F1）。
// 并发调用按到达顺序排队执行（resetMu），后到的请求覆盖先到的对局。
func (rt *Runtime) Reset(req NewGameRequest) (*Session, error) {
	if rt == nil {
		return nil, fmt.Errorf("runtime is nil")
	}
	rt.resetMu.Lock()
	defer rt.resetMu.Unlock()

	if rt.dir == nil || rt.mapCfg == nil {
		return nil, fmt.Errorf("hot reset is not available on this runtime")
	}

	cfg, err := rt.buildConfig(&req)
	if err != nil {
		return nil, err
	}
	sess, err := rt.assemble(cfg)
	if err != nil {
		return nil, err
	}

	// 先停 autosave 并等待收尾，保证新局初始存档写入期间没有旧局落盘。
	rt.stopAutosaveLocked()
	if _, err := sess.Core.Save("new_game"); err != nil {
		// 新局没落盘成功：恢复旧局 autosave，当前对局保持不变。
		rt.startAutosaveLocked(rt.current.Load())
		return nil, fmt.Errorf("new game initial save: %w", err)
	}

	old := rt.current.Swap(sess)
	old.shutdown()
	if rt.started {
		rt.startSessionLocked(sess)
	}
	return sess, nil
}

// assemble 由配置构建完整 session 并挂载 game dir（尚未写初始存档，见 Reset）。
// 快照 store 按局新建：旧局的 tick 快照/命令增量不能混入新局，
// 否则新局 rollback/replay 会捡到旧局存档（tick 键空间是共享的）。
func (rt *Runtime) assemble(cfg *config.Config) (*Session, error) {
	if err := config.ApplyDefaults(cfg); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidNewGame, err)
	}
	maps := mapgen.Generate(rt.mapCfg, cfg.Battlefield.MapSeed)
	if maps == nil || maps.PrimaryPlanet() == nil {
		return nil, fmt.Errorf("%w: map config produces no planets", ErrInvalidNewGame)
	}
	store, err := newSnapshotStore(rt.serverCfg)
	if err != nil {
		return nil, err
	}
	q := queue.New()
	bus := gamecore.NewEventBus()
	core := gamecore.New(cfg, maps, q, bus, store)
	meta := gamedir.NewMetaFile(cfg, rt.mapCfg)
	core.AttachGameDir(rt.dir, meta, snapshot.Capture(core.World(), core.Discovery()))
	return NewSession(cfg, maps, core, bus, q), nil
}

// newSnapshotStore 按 server 段的快照策略创建一局一个的内存快照 store。
func newSnapshotStore(serverCfg config.ServerConfig) (*persistence.Store, error) {
	return persistence.New(serverCfg.DataDir, persistence.SnapshotPolicy{
		IntervalTicks:    serverCfg.SnapshotIntervalTicks,
		RetentionTicks:   serverCfg.SnapshotRetentionTicks,
		RetentionCount:   serverCfg.SnapshotRetentionCount,
		MaxSnapshotBytes: serverCfg.SnapshotMaxBytes,
		MaxDeltaBytes:    serverCfg.SnapshotDeltaMaxBytes,
	})
}

// buildConfig 校验请求并构建新局配置：server 段保留，battlefield/players 由请求给出。
func (rt *Runtime) buildConfig(req *NewGameRequest) (*config.Config, error) {
	if req == nil {
		return nil, fmt.Errorf("%w: request body is required", ErrInvalidNewGame)
	}
	cfg := &config.Config{Server: rt.serverCfg}
	if cur := rt.current.Load(); cur != nil && cur.Config != nil {
		// tick 速率与施工并发上限视作进程级旋钮，沿用当前对局的取值。
		cfg.Battlefield.MaxTickRate = cur.Config.Battlefield.MaxTickRate
		cfg.Battlefield.ConstructionRegionConcurrentLimit = cur.Config.Battlefield.ConstructionRegionConcurrentLimit
	}

	seed := req.MapSeed
	if seed == "" {
		seed = randomMapSeed()
	}
	cfg.Battlefield.MapSeed = seed

	switch req.EnemyDifficulty {
	case "", "off", "easy", "normal", "hard":
		cfg.Battlefield.EnemyDifficulty = req.EnemyDifficulty
	default:
		return nil, fmt.Errorf("%w: enemy_difficulty must be off|easy|normal|hard", ErrInvalidNewGame)
	}

	switch model.NormalizeVictoryRule(req.VictoryMode) {
	case model.VictoryRuleElimination:
		if req.VictoryMode != "" && req.VictoryMode != model.VictoryRuleElimination {
			return nil, fmt.Errorf("%w: victory_mode must be elimination|mission_complete|hybrid|sandbox", ErrInvalidNewGame)
		}
		cfg.Battlefield.VictoryRule = model.VictoryRuleElimination
	case model.VictoryRuleMissionComplete, model.VictoryRuleHybrid, model.VictoryRuleSandbox:
		cfg.Battlefield.VictoryRule = model.NormalizeVictoryRule(req.VictoryMode)
	}

	if len(req.Players) == 0 {
		return nil, fmt.Errorf("%w: players must not be empty", ErrInvalidNewGame)
	}
	seenIDs := make(map[string]bool, len(req.Players))
	seenKeys := make(map[string]bool, len(req.Players))
	players := make([]config.PlayerConfig, 0, len(req.Players))
	for i := range req.Players {
		p := req.Players[i]
		if p.PlayerID == "" {
			return nil, fmt.Errorf("%w: players[%d].player_id is required", ErrInvalidNewGame, i)
		}
		if seenIDs[p.PlayerID] {
			return nil, fmt.Errorf("%w: duplicate player_id %q", ErrInvalidNewGame, p.PlayerID)
		}
		seenIDs[p.PlayerID] = true
		if p.Key == "" {
			return nil, fmt.Errorf("%w: players[%d].key is required", ErrInvalidNewGame, i)
		}
		if seenKeys[p.Key] {
			return nil, fmt.Errorf("%w: duplicate key for player %q", ErrInvalidNewGame, p.PlayerID)
		}
		seenKeys[p.Key] = true
		switch p.Role {
		case "", "admin", "commander", "observer":
		default:
			return nil, fmt.Errorf("%w: players[%d].role must be admin|commander|observer", ErrInvalidNewGame, i)
		}
		switch p.Bot {
		case "", "easy", "normal", "hard":
		default:
			return nil, fmt.Errorf("%w: players[%d].bot must be easy|normal|hard", ErrInvalidNewGame, i)
		}
		pc := config.PlayerConfig{
			PlayerID: p.PlayerID,
			Key:      p.Key,
			Role:     p.Role,
			TeamID:   p.TeamID,
			Bot:      p.Bot,
		}
		if p.Bootstrap != nil {
			pc.Bootstrap = *p.Bootstrap
		}
		players = append(players, pc)
	}
	cfg.Players = players
	return cfg, nil
}

// startSessionLocked 为新对局拉起 tick 循环与 autosave goroutine（需持 resetMu 且 rt.started）。
func (rt *Runtime) startSessionLocked(sess *Session) {
	if sess == nil || sess.Core == nil {
		return
	}
	go sess.Core.Run()
	rt.startAutosaveLocked(sess)
}

func (rt *Runtime) startAutosaveLocked(sess *Session) {
	if !rt.started || sess == nil || sess.Core == nil {
		return
	}
	rt.stopAutosaveLocked()
	interval := time.Duration(rt.serverCfg.AutoSaveIntervalSeconds) * time.Second
	if interval <= 0 {
		return
	}
	rt.autosaveStop, rt.autosaveDone = startAutoSaveLoop(sess.Core, interval)
}

func (rt *Runtime) stopAutosaveLocked() {
	if rt.autosaveStop != nil {
		close(rt.autosaveStop)
		rt.autosaveStop = nil
	}
	if rt.autosaveDone != nil {
		<-rt.autosaveDone
		rt.autosaveDone = nil
	}
}

func randomMapSeed() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("seed-%d", time.Now().UnixNano())
	}
	return "seed-" + hex.EncodeToString(buf)
}
