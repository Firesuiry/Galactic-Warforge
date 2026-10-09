package gamecore

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"siliconworld/internal/model"
)

// BattleRecorder 把一局比赛的**未过滤**事件流与周期性全场状态采样写成 JSONL，
// 用于离线战况回放与解说视频渲染。它运行在服务端 tick 边界（持锁上下文中），
// 因此不受战争迷雾与玩家权限影响，能看到所有玩家的单位与建筑。
//
// 输出格式（每行一个 JSON 对象）：
//
//	{"kind":"meta", ...}                          首行：玩家/队伍/行星信息
//	{"kind":"event","tick":N,...}                 每个游戏事件一行（含 tick_completed 以外的全部事件）
//	{"kind":"state","tick":N,"planets":{...}}     每 interval tick 一次全场单位/建筑采样
//	{"kind":"victory","tick":N,...}               胜负宣判（从事件中提取，便于消费方直接读取）
type BattleRecorder struct {
	mu       sync.Mutex
	f        *os.File
	w        *bufio.Writer
	interval int64
	metaDone bool
	closed   bool
}

// NewBattleRecorder 创建录制器；interval 为状态采样间隔（tick），<=0 时取 10。
func NewBattleRecorder(path string, interval int64) (*BattleRecorder, error) {
	if path == "" {
		return nil, fmt.Errorf("record path is required")
	}
	if interval <= 0 {
		interval = 10
	}
	f, err := os.Create(path)
	if err != nil {
		return nil, fmt.Errorf("create record file: %w", err)
	}
	return &BattleRecorder{
		f:        f,
		w:        bufio.NewWriterSize(f, 64*1024),
		interval: interval,
	}, nil
}

// Close 冲刷缓冲并关闭文件；幂等。
func (r *BattleRecorder) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	if err := r.w.Flush(); err != nil {
		_ = r.f.Close()
		return err
	}
	return r.f.Close()
}

// SetRecorder 挂载录制器；传 nil 解除。
func (gc *GameCore) SetRecorder(r *BattleRecorder) {
	gc.runtimeMu.Lock()
	defer gc.runtimeMu.Unlock()
	gc.recorder = r
}

// recorderStateUnit / recorderStateBuilding 是状态采样行的紧凑表示。
type recorderStateUnit struct {
	ID     string `json:"id"`
	Owner  string `json:"o"`
	Type   string `json:"t"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	HP     int    `json:"hp"`
	MaxHP  int    `json:"mhp"`
	MechaE int    `json:"me,omitempty"` // 机甲剩余能量（仅机甲）
}

type recorderStateBuilding struct {
	ID     string `json:"id"`
	Owner  string `json:"o"`
	Type   string `json:"t"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	HP     int    `json:"hp"`
	MaxHP  int    `json:"mhp"`
	State  string `json:"s,omitempty"`
}

type recorderPlanetState struct {
	Units     []recorderStateUnit     `json:"units,omitempty"`
	Buildings []recorderStateBuilding `json:"buildings,omitempty"`
}

// OnTick 在 tick 结算后、事件已分配 ID 时调用；调用方持有世界锁。
// 每次调用写事件行；每 interval tick 追加一行状态采样。每 tick 冲刷一次，
// 保证服务器崩溃时录像最多损失一个 tick。
func (r *BattleRecorder) OnTick(worlds map[string]*model.WorldState, activePlanetID string, tick int64, events []*model.GameEvent) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}

	if !r.metaDone {
		r.writeMeta(worlds, activePlanetID)
		r.metaDone = true
	}

	for _, evt := range events {
		if evt == nil || evt.EventType == model.EvtTickCompleted {
			continue
		}
		row := map[string]any{
			"kind":       "event",
			"tick":       evt.Tick,
			"event_id":   evt.EventID,
			"event_type": string(evt.EventType),
			"scope":      evt.VisibilityScope,
			"payload":    evt.Payload,
		}
		r.writeRow(row)
		if evt.EventType == model.EvtVictoryDeclared {
			r.writeRow(map[string]any{
				"kind":    "victory",
				"tick":    evt.Tick,
				"payload": evt.Payload,
			})
		}
	}

	if tick%r.interval == 0 {
		r.writeRow(map[string]any{
			"kind":    "state",
			"tick":    tick,
			"planets": snapshotPlanets(worlds),
		})
	}

	// 每 tick  flush：10/s 的写频率开销可忽略，换取崩溃安全。
	_ = r.w.Flush()
}

func (r *BattleRecorder) writeMeta(worlds map[string]*model.WorldState, activePlanetID string) {
	type playerMeta struct {
		PlayerID string `json:"player_id"`
		TeamID   string `json:"team_id"`
		Role     string `json:"role,omitempty"`
	}
	type planetMeta struct {
		PlanetID string `json:"planet_id"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
	}
	playersSeen := make(map[string]bool)
	var players []playerMeta
	var planets []planetMeta
	for pid, ws := range worlds {
		if ws == nil {
			continue
		}
		planets = append(planets, planetMeta{PlanetID: pid, Width: ws.MapWidth, Height: ws.MapHeight})
		for _, ps := range ws.Players {
			if ps == nil || playersSeen[ps.PlayerID] {
				continue
			}
			playersSeen[ps.PlayerID] = true
			players = append(players, playerMeta{PlayerID: ps.PlayerID, TeamID: ps.TeamID, Role: ps.Role})
		}
	}
	r.writeRow(map[string]any{
		"kind":             "meta",
		"tick":             0,
		"active_planet_id": activePlanetID,
		"players":          players,
		"planets":          planets,
		"sample_interval":  r.interval,
	})
}

func (r *BattleRecorder) writeRow(row map[string]any) {
	data, err := json.Marshal(row)
	if err != nil {
		return
	}
	_, _ = r.w.Write(data)
	_ = r.w.WriteByte('\n')
}

func snapshotPlanets(worlds map[string]*model.WorldState) map[string]*recorderPlanetState {
	out := make(map[string]*recorderPlanetState, len(worlds))
	for pid, ws := range worlds {
		if ws == nil {
			continue
		}
		ps := &recorderPlanetState{}
		for _, u := range ws.Units {
			if u == nil {
				continue
			}
			su := recorderStateUnit{
				ID: u.ID, Owner: u.OwnerID, Type: string(u.Type),
				X: u.Position.X, Y: u.Position.Y, HP: u.HP, MaxHP: u.MaxHP,
			}
			if u.Mecha != nil {
				su.MechaE = u.Mecha.Energy
			}
			ps.Units = append(ps.Units, su)
		}
		for _, b := range ws.Buildings {
			if b == nil {
				continue
			}
			ps.Buildings = append(ps.Buildings, recorderStateBuilding{
				ID: b.ID, Owner: b.OwnerID, Type: string(b.Type),
				X: b.Position.X, Y: b.Position.Y, HP: b.HP, MaxHP: b.MaxHP,
				State: string(b.Runtime.State),
			})
		}
		out[pid] = ps
	}
	return out
}
