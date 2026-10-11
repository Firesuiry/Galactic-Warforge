package model

// BotRuntimeState 是 bot 玩家的跨 tick 运营状态，随存档持久化。
// 人类玩家为 nil（零值语义 = 没发过波）。
type BotRuntimeState struct {
	// LastWaveTick 上一波进攻军团编队出发的 tick（0 = 还没发过）。
	// 波次冷却以它为锚点：一支军团出发后至少隔 waveCooldown tick 才编下一波，
	// 否则 bot 会一波接一波地连推（试玩 1014 P1：首攻后每 300–600 tick 一波，
	// 玩家 8 个步兵被逐波耗光）。读档必须延续，不能从零重算。
	LastWaveTick int64 `json:"last_wave_tick,omitempty"`
}

func (s *BotRuntimeState) Clone() *BotRuntimeState {
	if s == nil {
		return nil
	}
	cp := *s
	return &cp
}
