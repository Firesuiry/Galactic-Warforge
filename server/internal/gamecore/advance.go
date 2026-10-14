package gamecore

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"siliconworld/internal/model"
)

// 狂飙模式 / 快进（POST /admin/advance）：暂停定时节奏，连续执行 processTick
// 直到目标 tick 或命中停止条件，然后恢复原速率。
//
// 与 tick 循环的互斥：定时 tick 走 runScheduledTick（先抢 tickMu），快进整段持有
// tickMu，所以快进期间不会有定时 tick 插进来；time.Ticker 在接收端阻塞时会丢弃
// 错过的节拍，快进结束后自然按原速率继续，不需要重建 ticker。
//
// 确定性：快进只改「什么时候跑 tick」，不改「tick 怎么跑」——每个 tick 照常
// 处理命令队列、发事件、写快照，因此快进前后存读档与回放口径不变。

// AdvanceStopOn 快进的停止条件开关（三项默认全开，显式传 false 关闭）。
type AdvanceStopOn struct {
	GameOver      bool
	UnderAttack   bool
	CriticalAlert bool
}

// DefaultAdvanceStopOn 三项默认全开（未指定 stop_on 时的口径）。
func DefaultAdvanceStopOn() AdvanceStopOn {
	return AdvanceStopOn{GameOver: true, UnderAttack: true, CriticalAlert: true}
}

// AdvanceSpec 一次快进的规格：Ticks 与 ToTick 二选一（ToTick > 0 优先）。
type AdvanceSpec struct {
	Ticks  int64
	ToTick int64
	StopOn AdvanceStopOn
}

// AdvanceResult 快进结果（HTTP 响应同构）。
type AdvanceResult struct {
	StartTick     int64
	EndTick       int64
	StoppedReason string
	Detail        string
	ElapsedMS     int64
	TicksPerSec   float64
}

// 快进期间的事件降采样参数：高频事件（单位移动/伤害/资源变化/告警等）只在
// 每 advanceEventPublishGap tick 发布一次（并只留该 tick 的最后一条），
// tick_completed 更稀（客户端据此刷新 stats）。事件历史仍记全量，
// 断线补拉（/events/snapshot）不受影响。
const (
	advanceEventPublishGap  = 10
	advanceTickCompletedGap = 50
)

// ErrAdvanceInProgress 同时只允许一个快进。
var ErrAdvanceInProgress = errors.New("advance already in progress")

// ErrAdvanceCancelled 快进被 /admin/advance/cancel 取消。
var ErrAdvanceCancelled = errors.New("advance cancelled")

// advanceState 快进的运行态：running 门禁 + 取消标志（cond 广播给等待取消的调用方）。
type advanceState struct {
	mu              sync.Mutex
	cond            *sync.Cond
	running         bool
	cancelRequested bool
}

func (gc *GameCore) advanceState() *advanceState {
	if gc.advanceRun == nil {
		gc.advanceMu.Lock()
		defer gc.advanceMu.Unlock()
		if gc.advanceRun == nil {
			state := &advanceState{}
			state.cond = sync.NewCond(&state.mu)
			gc.advanceRun = state
		}
	}
	return gc.advanceRun
}

// tickMu 串行化定时 tick 与快进（见文件头注释）。
func (gc *GameCore) tickMu() *sync.Mutex {
	if gc.tickMutex == nil {
		gc.advanceMu.Lock()
		defer gc.advanceMu.Unlock()
		if gc.tickMutex == nil {
			gc.tickMutex = &sync.Mutex{}
		}
	}
	return gc.tickMutex
}

// FastForwarding 报告当前是否处于快进中（SSE 降采样与测试用）。
func (gc *GameCore) FastForwarding() bool {
	return gc != nil && gc.fastForwarding.Load()
}

// runScheduledTick 定时节奏的一次 tick：快进期间整体让位（不跑 tick）。
func (gc *GameCore) runScheduledTick() {
	if gc == nil {
		return
	}
	mu := gc.tickMu()
	mu.Lock()
	defer mu.Unlock()
	if gc.fastForwarding.Load() {
		return
	}
	gc.processTick()
}

// Advance 执行一次快进（阻塞直到到达目标或命中停止条件）。ownedTargets 是
// 「我方建筑/单位 id」集合（AdvanceOwnedTargets 的产物）：只有这些目标受到伤害
// 才会触发 under_attack。并发调用返回 ErrAdvanceInProgress。
func (gc *GameCore) Advance(spec AdvanceSpec, ownedTargets map[string]struct{}) (*AdvanceResult, error) {
	if gc == nil {
		return nil, fmt.Errorf("game core is nil")
	}
	state := gc.advanceState()
	state.mu.Lock()
	if state.running {
		state.mu.Unlock()
		return nil, ErrAdvanceInProgress
	}
	state.running = true
	state.cancelRequested = false
	state.mu.Unlock()

	// 快进整段持有 tickMu：定时 tick 在这期间被阻塞并丢弃。
	mu := gc.tickMu()
	mu.Lock()
	defer mu.Unlock()

	gc.fastForwarding.Store(true)
	defer func() {
		gc.fastForwarding.Store(false)
		state.mu.Lock()
		state.running = false
		state.cancelRequested = false
		state.mu.Unlock()
	}()

	startTick := gc.CurrentTick()
	target := spec.ToTick
	if target <= 0 {
		target = startTick + spec.Ticks
	}
	start := time.Now()

	result := &AdvanceResult{
		StartTick:     startTick,
		EndTick:       startTick,
		StoppedReason: model.AdvanceStoppedReached,
		Detail:        fmt.Sprintf("已推进到目标 tick %d", target),
	}

	for gc.CurrentTick() < target {
		if gc.advanceCancelled(state) {
			result.StoppedReason = model.AdvanceStoppedCancelled
			result.Detail = "快进被取消"
			break
		}
		_, events := gc.runTick()

		if spec.StopOn.GameOver && gc.Finished() {
			victory := gc.Victory()
			result.StoppedReason = model.AdvanceStoppedGameOver
			result.Detail = fmt.Sprintf("对局结束：胜者 %s（%s）", victory.WinnerID, victory.Reason)
			break
		}
		if spec.StopOn.UnderAttack {
			if detail, hit := advanceUnderAttack(events, ownedTargets); hit {
				result.StoppedReason = model.AdvanceStoppedUnderAttack
				result.Detail = detail
				break
			}
		}
		if spec.StopOn.CriticalAlert {
			if detail, hit := advanceCriticalAlert(events); hit {
				result.StoppedReason = model.AdvanceStoppedCriticalAlert
				result.Detail = detail
				break
			}
		}
	}

	result.EndTick = gc.CurrentTick()
	result.ElapsedMS = time.Since(start).Milliseconds()
	elapsed := time.Since(start).Seconds()
	ticks := result.EndTick - result.StartTick
	if elapsed > 0 {
		result.TicksPerSec = float64(ticks) / elapsed
	}

	// 快进结束事件：客户端据此做一次全量刷新（快进期间的高频事件已被降采样）。
	gc.bus.Publish([]*model.GameEvent{{
		EventID:         fmt.Sprintf("evt-%d-advance-finished", result.EndTick),
		Tick:            result.EndTick,
		EventType:       model.EvtFastForwardFinished,
		VisibilityScope: "all",
		Payload: map[string]any{
			"start_tick":     result.StartTick,
			"end_tick":       result.EndTick,
			"stopped_reason": result.StoppedReason,
			"detail":         result.Detail,
			"elapsed_ms":     result.ElapsedMS,
			"ticks_per_sec":  result.TicksPerSec,
		},
	}})
	log.Printf("[GameCore] fast-forward %d → %d (%s, %.0f tick/s, %dms)",
		result.StartTick, result.EndTick, result.StoppedReason, result.TicksPerSec, result.ElapsedMS)
	return result, nil
}

// CancelAdvance 请求取消当前快进（没有快进时返回 false）。
func (gc *GameCore) CancelAdvance() bool {
	if gc == nil || gc.advanceRun == nil {
		return false
	}
	state := gc.advanceState()
	state.mu.Lock()
	defer state.mu.Unlock()
	if !state.running {
		return false
	}
	state.cancelRequested = true
	state.cond.Broadcast()
	return true
}

// advanceCancelled 报告快进是否应中止（取消请求或进程停止）。
func (gc *GameCore) advanceCancelled(state *advanceState) bool {
	select {
	case <-gc.stopCh:
		return true
	default:
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.cancelRequested
}

// advanceUnderAttack 判定本 tick 的事件里有没有「我方」建筑/单位受到伤害。
// 口径：damage_applied（damage > 0）或 entity_destroyed（owner 属我方）——
// 摧毁事件单独看是因为一发打不死时的 damage_applied 已覆盖，而一次性摧毁
// （如黑雾偷袭、护盾归零）也必须有 stop 的机会。
func advanceUnderAttack(events []*model.GameEvent, victims map[string]struct{}) (string, bool) {
	if len(victims) == 0 {
		return "", false
	}
	for _, evt := range events {
		if evt == nil {
			continue
		}
		switch evt.EventType {
		case model.EvtDamageApplied:
			if !advanceVictimTarget(evt.Payload) {
				continue
			}
			if n, ok := numericPayload(evt.Payload["damage"]); ok && n <= 0 {
				continue
			}
			targetID, _ := evt.Payload["target_id"].(string)
			if advanceTargetOwnedBy(targetID, victims) {
				return fmt.Sprintf("我方目标 %s 在 tick %d 受到伤害", targetID, evt.Tick), true
			}
		case model.EvtEntityDestroyed:
			ownerID, _ := evt.Payload["owner_id"].(string)
			if _, ok := victims[ownerID]; !ok {
				continue
			}
			// 拆除/寿终/自毁不算受袭。
			if reason, _ := evt.Payload["reason"].(string); reason == "demolish" || reason == "lifetime_expired" {
				continue
			}
			entityID, _ := evt.Payload["entity_id"].(string)
			return fmt.Sprintf("我方 %s 在 tick %d 被摧毁", entityID, evt.Tick), true
		}
	}
	return "", false
}

// advanceVictimTarget 只认建筑/单位（敌兵、太阳帆等不算我方受袭）。
func advanceVictimTarget(payload map[string]any) bool {
	if payload == nil {
		return false
	}
	kind, _ := payload["target_type"].(string)
	switch kind {
	case "building", "unit":
		return true
	}
	return false
}

// advanceTargetOwnedBy 在「我方目标 id」集合里查目标归属。目标的归属由调用方
// 预登记（见 AdvanceOwnedTargets），避免在热循环里反复扫世界状态。
func advanceTargetOwnedBy(targetID string, victims map[string]struct{}) bool {
	if targetID == "" {
		return false
	}
	_, ok := victims[targetID]
	return ok
}

// advanceCriticalAlert 判定本 tick 有没有「高价值」产线告警：缺电与产出阻塞。
func advanceCriticalAlert(events []*model.GameEvent) (string, bool) {
	for _, evt := range events {
		if evt == nil || evt.EventType != model.EvtProductionAlert {
			continue
		}
		alert, ok := evt.Payload["alert"].(*model.ProductionAlert)
		if !ok || alert == nil {
			continue
		}
		switch alert.AlertType {
		case model.AlertTypePowerShortage, model.AlertTypeOutputBlocked:
			return fmt.Sprintf("关键警报：%s（%s，tick %d）", alert.Message, alert.AlertType, alert.Tick), true
		}
	}
	return "", false
}

func numericPayload(value any) (float64, bool) {
	switch v := value.(type) {
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case float64:
		return v, true
	case float32:
		return float64(v), true
	}
	return 0, false
}

// AdvanceOwnedTargets 把「我方玩家」展开成「我方建筑/单位 id」集合：快进的受袭
// 判定直接查 id，热循环里不再扫世界。victims 是玩家 id 集合；传空时退回全体
// 人类玩家（admin 无玩家时的口径，由网关决定后传进来）。
func (gc *GameCore) AdvanceOwnedTargets(victims map[string]struct{}) map[string]struct{} {
	targets := make(map[string]struct{}, 64)
	if gc == nil {
		return targets
	}
	for _, ws := range gc.sortedWorlds() {
		if ws == nil {
			continue
		}
		ws.RLock()
		for id, building := range ws.Buildings {
			if building == nil {
				continue
			}
			if _, ok := victims[building.OwnerID]; ok {
				targets[id] = struct{}{}
			}
		}
		for id, unit := range ws.Units {
			if unit == nil {
				continue
			}
			if _, ok := victims[unit.OwnerID]; ok {
				targets[id] = struct{}{}
			}
		}
		ws.RUnlock()
	}
	return targets
}

// downsampleAdvanceEvents 快进期间的事件降采样（只作用于对外发布的那一份；
// 事件历史仍记全量）。规则：高频类型只在 tick%gap==0 的 tick 上发布，
// 且同一 tick 内同类型只留最后一条；tick_completed 更稀。
func downsampleAdvanceEvents(events []*model.GameEvent, tick int64) []*model.GameEvent {
	if len(events) == 0 {
		return events
	}
	if tick%advanceEventPublishGap != 0 {
		// 非发布 tick：整批高频事件丢弃，其余（命令回执/建造完成/宣判等）照发。
		out := make([]*model.GameEvent, 0, len(events))
		for _, evt := range events {
			if evt == nil || advanceThrottledEvent(evt.EventType) {
				continue
			}
			out = append(out, evt)
		}
		return out
	}
	last := make(map[model.EventType]int, 8)
	drop := make(map[int]struct{}, 8)
	keepTickCompleted := tick%advanceTickCompletedGap == 0
	for i, evt := range events {
		if evt == nil || !advanceThrottledEvent(evt.EventType) {
			continue
		}
		if evt.EventType == model.EvtTickCompleted && !keepTickCompleted {
			drop[i] = struct{}{}
			continue
		}
		if prev, ok := last[evt.EventType]; ok {
			drop[prev] = struct{}{}
		}
		last[evt.EventType] = i
	}
	if len(drop) == 0 {
		return events
	}
	out := make([]*model.GameEvent, 0, len(events)-len(drop))
	for i, evt := range events {
		if _, ok := drop[i]; ok {
			continue
		}
		out = append(out, evt)
	}
	return out
}

// advanceThrottledEvent 快进期间需要降采样的高频事件类型。
func advanceThrottledEvent(eventType model.EventType) bool {
	switch eventType {
	case model.EvtEntityMoved,
		model.EvtDamageApplied,
		model.EvtResourceChanged,
		model.EvtMechaStateChanged,
		model.EvtEntityUpdated,
		model.EvtTickCompleted,
		model.EvtProductionAlert,
		model.EvtTrafficMonitorAlert,
		model.EvtPointDefenseIntercept,
		model.EvtMissileSalvoFired:
		return true
	}
	return false
}

// advanceRun/tickMutex/fastForwarding 字段由 GameCore 持有（见 core.go）。
