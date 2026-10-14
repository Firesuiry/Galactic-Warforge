package model

// 狂飙模式 / 快进（POST /admin/advance）的线上请求与响应类型。
// 停止条件的零值语义是「未指定」——三项默认全开，显式传 false 才关闭，
// 所以线上结构用 *bool；服务端把它解析成 gamecore 的纯 bool 规格。

// AdvanceStopOn 快进的停止条件开关（三项默认 true）。
type AdvanceStopOn struct {
	GameOver      *bool `json:"game_over,omitempty"`
	UnderAttack   *bool `json:"under_attack,omitempty"`
	CriticalAlert *bool `json:"critical_alert,omitempty"`
}

// AdvanceRequest 一次快进的请求体：to_tick 与 ticks 二选一（都给或都不给 400）。
type AdvanceRequest struct {
	ToTick *int64         `json:"to_tick,omitempty"`
	Ticks  *int64         `json:"ticks,omitempty"`
	StopOn *AdvanceStopOn `json:"stop_on,omitempty"`
}

// AdvanceResponse 快进结束后的结果。
type AdvanceResponse struct {
	StartTick     int64   `json:"start_tick"`
	EndTick       int64   `json:"end_tick"`
	StoppedReason string  `json:"stopped_reason"`
	Detail        string  `json:"detail"`
	ElapsedMS     int64   `json:"elapsed_ms"`
	TicksPerSec   float64 `json:"ticks_per_sec"`
}

// AdvanceCancelResponse POST /admin/advance/cancel 的响应。
type AdvanceCancelResponse struct {
	Cancelled bool `json:"cancelled"`
}

// 快进停止原因（stopped_reason 取值）。
const (
	AdvanceStoppedReached       = "reached"
	AdvanceStoppedGameOver      = "game_over"
	AdvanceStoppedUnderAttack   = "under_attack"
	AdvanceStoppedCriticalAlert = "critical_alert"
	AdvanceStoppedCancelled     = "cancelled"
)
