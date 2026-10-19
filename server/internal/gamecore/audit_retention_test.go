package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/persistence"
	"siliconworld/internal/queue"
)

// 试玩 1016 报告 B3 的回归：审计/命令日志的保留窗口与快照保留窗口解耦。
// 旧行为是「每次存快照就把审计裁到 snapshot_retention_ticks」，于是
// `checkpointbuild -export` 从存档点导出时只剩最后几千 tick 的命令，
// 开局建造段（风机/矿塔/矿机/传送带/分拣器/熔炉）整个丢失。

// auditRetentionCore 造一局：快照保留窗口很短（10 tick），审计保留窗口按参数。
func auditRetentionCore(t *testing.T, auditRetention int64) (*GameCore, *persistence.Store, *queue.CommandQueue) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{MapSeed: "audit-retention-seed", MaxTickRate: 10},
		Players:     []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		Server: config.ServerConfig{
			Port:                   9999,
			SnapshotIntervalTicks:  1,
			SnapshotRetentionCount: 60,
			SnapshotRetentionTicks: 30,
			AuditRetentionTicks:    auditRetention,
		},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 8, ResourceDensity: 4},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	store := persistence.New(persistence.SnapshotPolicy{
		IntervalTicks:  1,
		RetentionTicks: 30,
		RetentionCount: 60,
	})
	q := queue.New()
	core := New(cfg, maps, q, NewEventBus(), store)
	return core, store, q
}

// enqueueTick 下发一条 move 命令并推进一步：命令日志/审计才有的可裁。
func enqueueTick(t *testing.T, core *GameCore, q *queue.CommandQueue, tick int) {
	t.Helper()
	ws := core.World()
	ws.RLock()
	exec := starterMecha(ws, "p1")
	execID := exec.UnitID
	target := findMoveTarget(ws, ws.Units[execID].Position)
	ws.RUnlock()
	if target == nil {
		t.Fatalf("tick %d: no move target", tick)
	}
	if !q.Enqueue(&model.QueuedRequest{
		Request: model.CommandRequest{
			RequestID:  fmt.Sprintf("req-%d", tick),
			IssuerType: "player",
			IssuerID:   "p1",
			Commands: []model.Command{{
				Type:   model.CmdMove,
				Target: model.CommandTarget{EntityID: execID, Position: target},
			}},
		},
		PlayerID: "p1",
	}) {
		t.Fatalf("tick %d: enqueue failed", tick)
	}
	core.processTick()
}

// 默认（audit_retention_ticks = 0）：整局全留——跑 60 tick、期间存了 60 次快照，
// 审计与命令日志仍保留第 1 tick 的命令。
func TestAuditLogKeepsWholeGameByDefault(t *testing.T) {
	core, store, q := auditRetentionCore(t, 0)
	for i := 1; i <= 60; i++ {
		enqueueTick(t, core, q, i)
	}
	if got := len(core.GetCommandLog().All()); got != 60 {
		t.Fatalf("默认应整局保留命令日志，got %d 条（期望 60）", got)
	}
	audit := store.AuditEntries()
	if len(audit) == 0 {
		t.Fatal("审计日志不该被裁空")
	}
	if audit[0].Tick > 1 {
		t.Fatalf("审计日志应保留到第 1 tick，got 最早 tick %d", audit[0].Tick)
	}
}

// 显式给了窗口（20 tick）时按窗口裁：60 tick 之后只剩最后 20 tick 的条目。
func TestAuditLogHonorsExplicitRetentionWindow(t *testing.T) {
	core, store, q := auditRetentionCore(t, 20)
	for i := 1; i <= 60; i++ {
		enqueueTick(t, core, q, i)
	}
	entries := core.GetCommandLog().All()
	if len(entries) == 0 {
		t.Fatal("窗口内的命令日志不该被裁空")
	}
	if entries[0].Tick < 41 {
		t.Fatalf("显式窗口 20 tick：最早应保留 tick 41 起，got %d", entries[0].Tick)
	}
	audit := store.AuditEntries()
	if len(audit) == 0 || audit[0].Tick < 41 {
		t.Fatalf("显式窗口 20 tick：审计最早应保留 tick 41 起，got %+v", audit)
	}
}

// 审计窗口不小于快照窗口时，回滚仍然正常（回滚要重放快照之后的命令）。
// 快照保留窗口 30 tick，回滚到 20：tick 20 的快照与它之后的命令日志都还在。
func TestAuditRetentionKeepsRollbackWorking(t *testing.T) {
	core, _, q := auditRetentionCore(t, 0)
	for i := 1; i <= 40; i++ {
		enqueueTick(t, core, q, i)
	}
	resp, err := core.Rollback(model.RollbackRequest{ToTick: 20})
	if err != nil {
		t.Fatalf("rollback error: %v", err)
	}
	if resp.ToTick != 20 {
		t.Fatalf("rollback to tick 20 failed: %+v", resp)
	}
	if got := core.CurrentTick(); got != 20 {
		t.Fatalf("rollback 后世界 tick = %d，want 20", got)
	}
	// 回滚后命令日志只留到回滚点，但仍保留到第 1 tick（默认不裁）。
	entries := core.GetCommandLog().All()
	if len(entries) == 0 || entries[0].Tick != 1 {
		t.Fatalf("回滚后命令日志应仍从第 1 tick 起，got %d 条，首条 tick=%v", len(entries), entries)
	}
}
